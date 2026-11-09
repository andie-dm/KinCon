"""Parse cached OJS issue tables of contents (authoritative proceedings evidence)."""
from __future__ import annotations

import html
import re
from pathlib import Path

RAW = Path(__file__).resolve().parents[2] / "data" / "raw"
OJS_ARTICLE_URL = "https://ojs.aaai.org/index.php/AAAI/article/view/{}"

_ISSUE_LINK = re.compile(r'href="https://ojs\.aaai\.org/index\.php/AAAI/issue/view/(\d+)"[^>]*>\s*No\.\s*(\d+):\s*([^<]+)<')
_ARTICLE = re.compile(
    r'<div class="obj_article_summary">.*?<a id="article-(\d+)"[^>]*>\s*(.*?)\s*</a>'
    r'(?:.*?<div class="authors">\s*(.*?)\s*</div>)?(?:.*?<div class="pages">\s*(.*?)\s*</div>)?',
    re.S)


def issue_index(path: Path = RAW / "proceeding_index.html") -> dict[int, dict]:
    """{issue_number: {"ojs_issue_id": 624, "label": "AAAI-25 Technical Tracks 1"}}"""
    out = {}
    for ojs_id, num, label in _ISSUE_LINK.findall(path.read_text("utf-8", errors="replace")):
        out[int(num)] = {"ojs_issue_id": int(ojs_id), "label": html.unescape(label).strip()}
    return out


def _clean(s: str | None) -> str:
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", s or ""))).strip()


def parse_issue(path: Path) -> list[dict]:
    text = path.read_text("utf-8", errors="replace")
    # Split per summary block so an optional field cannot bleed into the next article.
    blocks = text.split('<div class="obj_article_summary">')[1:]
    out = []
    for b in blocks:
        m = _ARTICLE.search('<div class="obj_article_summary">' + b)
        if not m:
            continue
        art, title, authors, pages = m.groups()
        out.append({"ojs_article_id": art, "title": _clean(title),
                    "authors": [a.strip() for a in _clean(authors).split(",") if a.strip()],
                    "pages": _clean(pages) or None, "url": OJS_ARTICLE_URL.format(art)})
    return out


def load_proceedings(volume: int = 39) -> dict[str, dict]:
    """{ojs_article_id: record with issue + main_track_by_issue}. Issue numbers come
    from the proceedings index page, not from the dataset."""
    idx = issue_index()
    records = {}
    for num, meta in sorted(idx.items()):
        p = RAW / "ojs" / f"issue_{meta['ojs_issue_id']}.html"
        if not p.exists():
            continue
        for rec in parse_issue(p):
            rec.update(volume=volume, issue=num, issue_label=meta["label"],
                       toc_url=f"https://ojs.aaai.org/index.php/AAAI/issue/view/{meta['ojs_issue_id']}")
            if rec["ojs_article_id"] in records:
                rec["duplicate_of_issue"] = records[rec["ojs_article_id"]]["issue"]
            records.setdefault(rec["ojs_article_id"], rec)
    return records
