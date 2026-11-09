"""Parse official AAAI-25 schedule PDFs and join rows to papers.

The schedules' "Paper ID" column is a submission number that the metadata
sources do not carry, so it is kept (schedule_submission_id) but cannot be a
join key. Joins use normalized title plus author confirmation.
"""
from __future__ import annotations

import difflib
import re
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from .ids import normalize_title

TZ = "America/New_York"
_TZ = ZoneInfo(TZ)
_MONTHS = {"february": 2, "march": 3}
_SLOT = re.compile(r"(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\s+(february|march)\s+(\d{1,2}),?\s*"
                   r"(\d{1,2}:\d{2}\s*[ap]m)\s*[-–]\s*(\d{1,2}:\d{2}\s*[ap]m)", re.I)

# Official poster venue/hours (data/raw/poster_sessions.html).
POSTER_ROOM = "Exhibit Hall E"
POSTER_BUILDING = "200 Level, West Building"
POSTER_VENUE = "Pennsylvania Convention Center, Philadelphia"
POSTER_VENUE_URL = "https://aaai.org/conference/aaai/aaai-25/poster-sessions/"
POSTER_DAYS = {(2, 27), (2, 28), (3, 1)}
POSTER_HOURS = ("12:30", "14:30")


@dataclass(eq=False)
class SourceFile:
    key: str               # data/raw file name
    url: str
    fmt: str               # oral | poster
    published: str         # date in file name, for precedence
    authoritative: bool    # False: comparison only, never creates occurrences
    covers_days: set | None = None   # {(month, day)} the file claims to cover fully


@dataclass
class Row:
    source: SourceFile
    page: int
    starts_at: str | None
    ends_at: str | None
    slot_text: str
    submission_id: str | None
    title: str
    authors: list[str]
    session_title: str | None = None
    board: str | None = None
    topics: list[str] = field(default_factory=list)


def _clock(t: str) -> tuple[int, int]:
    m = re.match(r"(\d{1,2}):(\d{2})\s*([ap]m)", t.strip().lower())
    h, mi, ap = int(m.group(1)), int(m.group(2)), m.group(3)
    return (h % 12 + (12 if ap == "pm" else 0), mi)


def parse_slot(text: str) -> tuple[str, str] | None:
    m = _SLOT.search(re.sub(r"\s+", " ", text or ""))
    if not m:
        return None
    month, day = _MONTHS[m.group(2).lower()], int(m.group(3))
    (h1, m1), (h2, m2) = _clock(m.group(4)), _clock(m.group(5))
    s = datetime(2025, month, day, h1, m1, tzinfo=_TZ)
    e = datetime(2025, month, day, h2, m2, tzinfo=_TZ)
    return s.isoformat(), e.isoformat()


def _cell(v) -> str:
    return re.sub(r"\s+", " ", (v or "").replace("\n", " ")).strip()


def _join_wrapped(v) -> str:
    # Wrapped cells: a line-end hyphen in these PDFs is a real hyphen ("Flow-\nbased").
    s = re.sub(r"-\n", "-", v or "")
    return _cell(s)


def split_authors(s: str) -> list[str]:
    parts = re.split(r"[;,]", s or "")
    return [p.strip() for p in parts if p.strip()]


HEADER_ALIASES = {"date/time": "slot", "session name": "session", "paper id": "submission",
                  "paper title": "title", "authors": "authors", "poster id": "board",
                  "topics": "topics", "primary keywords": "primary", "secondary keywords": "secondary"}


def parse_pdf(path: Path, src: SourceFile) -> list[Row]:
    import pdfplumber
    rows: list[Row] = []
    cols: dict[str, int] | None = None
    last_slot, last_session = "", None
    with pdfplumber.open(path) as pdf:
        for pno, page in enumerate(pdf.pages, 1):
            for table in page.extract_tables():
                for raw in table:
                    cells = [c or "" for c in raw]
                    header = {HEADER_ALIASES.get(_cell(c).lower()): i for i, c in enumerate(cells)}
                    header.pop(None, None)
                    if "title" in header and "authors" in header:
                        cols = header
                        continue
                    if cols is None or len(cells) <= max(cols.values()):
                        continue
                    slot_txt = _cell(cells[cols["slot"]]) if "slot" in cols else ""
                    if slot_txt:
                        last_slot = slot_txt
                    if "session" in cols and _cell(cells[cols["session"]]):
                        last_session = _cell(cells[cols["session"]])
                    title = _join_wrapped(cells[cols["title"]])
                    if not title:
                        continue
                    slot = parse_slot(slot_txt or last_slot)
                    topics = [t.strip() for t in (cells[cols["topics"]] if "topics" in cols else "").split("\n") if t.strip()]
                    rows.append(Row(source=src, page=pno, starts_at=slot[0] if slot else None,
                                    ends_at=slot[1] if slot else None, slot_text=slot_txt or last_slot,
                                    submission_id=_cell(cells[cols["submission"]]) if "submission" in cols else None,
                                    title=title, authors=split_authors(_join_wrapped(cells[cols["authors"]])),
                                    session_title=last_session if "session" in cols else None,
                                    board=_cell(cells[cols["board"]]) if "board" in cols else None,
                                    topics=topics))
    return rows


def regroup_topics(lines: list[str]) -> list[str]:
    """PDF cells wrap long topic names; continuation lines lack an 'XX:' prefix."""
    out: list[str] = []
    for ln in lines:
        if re.match(r"^[A-Z]{2,5}: ", ln) or not out:
            out.append(ln)
        else:
            out[-1] = f"{out[-1]} {ln}"
    return out


# ---------------------------------------------------------------- matching

def _surname_tokens(name: str) -> set[str]:
    toks = normalize_title(name).split()
    return {toks[-1]} if toks else set()


def author_confirmation(sched_authors: list[str], paper_authors: list[str]) -> float:
    """Share of schedule authors whose surname appears among the paper's author
    tokens. Schedule cells are often truncated, so missing tail authors are fine."""
    if not sched_authors:
        return 0.0
    paper_tokens = set()
    for a in paper_authors:
        paper_tokens |= set(normalize_title(a).split())
    joined = normalize_title(" ".join(paper_authors)).replace(" ", "")
    hit = 0
    for a in sched_authors:
        sn = _surname_tokens(a)
        if sn & paper_tokens or (sn and next(iter(sn)) in joined and len(next(iter(sn))) >= 4):
            hit += 1
    return hit / len(sched_authors)


AUTHOR_MIN = 0.5
PREFIX_MIN_LEN = 25
FUZZY_MIN, FUZZY_MARGIN = 0.92, 0.04


class Matcher:
    def __init__(self, papers: list[dict]):
        self.papers = papers
        self.by_title: dict[str, list[dict]] = {}
        for p in papers:
            self.by_title.setdefault(normalize_title(p["title"]), []).append(p)
        self.titles = list(self.by_title)

    def _pick(self, cands: list[dict], row: Row) -> list[tuple[float, dict]]:
        return sorted(((author_confirmation(row.authors, [a["name"] for a in c["authors"]]), c) for c in cands),
                      key=lambda x: -x[0])

    def match(self, row: Row) -> dict:
        nt = normalize_title(row.title)
        cands, method, score = self.by_title.get(nt, []), "title_exact", 1.0
        if not cands and len(nt) >= PREFIX_MIN_LEN:
            cands = [p for t, ps in self.by_title.items() if t.startswith(nt) or (len(t) >= PREFIX_MIN_LEN and nt.startswith(t)) for p in ps]
            method = "title_prefix"
        if not cands:
            close = difflib.get_close_matches(nt, self.titles, n=3, cutoff=0.8)
            scored = [(difflib.SequenceMatcher(None, nt, t).ratio(), t) for t in close]
            scored.sort(reverse=True)
            if scored and scored[0][0] >= FUZZY_MIN and (len(scored) == 1 or scored[0][0] - scored[1][0] >= FUZZY_MARGIN):
                cands, method, score = self.by_title[scored[0][1]], "title_fuzzy", round(scored[0][0], 4)
            elif scored:
                return {"status": "ambiguous", "reason": "fuzzy below threshold or not unique",
                        "candidates": [{"title": t, "ratio": round(r, 3)} for r, t in scored]}
            else:
                return {"status": "unmatched"}
        ranked = self._pick(cands, row)
        best_conf, best = ranked[0]
        if best_conf < AUTHOR_MIN:
            return {"status": "ambiguous", "reason": f"{method} but author confirmation {best_conf:.2f} < {AUTHOR_MIN}",
                    "candidates": [{"paper_id": c["paper_id"], "author_confirmation": round(s, 2)} for s, c in ranked[:3]]}
        if len(ranked) > 1 and ranked[1][0] >= AUTHOR_MIN:
            return {"status": "ambiguous", "reason": f"{method} with {len(ranked)} author-confirmed candidates",
                    "candidates": [{"paper_id": c["paper_id"], "author_confirmation": round(s, 2)} for s, c in ranked[:3]]}
        return {"status": "matched", "paper": best, "match_method": f"{method}+author_confirmed",
                "match_score": score, "author_confirmation": round(best_conf, 3)}


def poster_slot_is_official(starts_at: str, ends_at: str) -> bool:
    s, e = datetime.fromisoformat(starts_at), datetime.fromisoformat(ends_at)
    return (s.month, s.day) in POSTER_DAYS and s.strftime("%H:%M") == POSTER_HOURS[0] and e.strftime("%H:%M") == POSTER_HOURS[1]
