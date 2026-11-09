"""Stable identifiers. The contract is documented in docs/DATA.md; changing any
function here changes document IDs and requires a migration."""
from __future__ import annotations

import hashlib
import re
import unicodedata

CONFERENCE_ID = "aaai-25"          # bibliographic venue: owns papers
EVENT_ID = "aaai-25-replay"        # social replay event: owns profiles, groups, actions

_DOI_PREFIXES = re.compile(r"^(?:https?://)?(?:dx\.)?(?:doi\.org/)|^doi:\s*", re.I)


def normalize_doi(raw: str | None) -> str | None:
    """'https://doi.org/10.1609/AAAI.V39I14.33617 ' -> '10.1609/aaai.v39i14.33617'.

    DOIs are case-insensitive (DOI Handbook 2.4), so lower-case is canonical here.
    Returns None for anything that does not look like a DOI.
    """
    if not raw:
        return None
    s = unicodedata.normalize("NFKC", str(raw)).strip()
    s = _DOI_PREFIXES.sub("", s).strip().rstrip(".").lower()
    s = re.sub(r"\s+", "", s)
    return s if re.match(r"^10\.\d{4,9}/\S+$", s) else None


def doi_issue(doi: str | None) -> tuple[int, int] | None:
    """AAAI DOIs encode volume and issue: 10.1609/aaai.v39i14.33617 -> (39, 14)."""
    m = re.match(r"^10\.1609/aaai\.v(\d+)i(\d+)\.(\d+)$", doi or "")
    return (int(m.group(1)), int(m.group(2))) if m else None


def doi_article_id(doi: str | None) -> str | None:
    m = re.match(r"^10\.1609/aaai\.v\d+i\d+\.(\d+)$", doi or "")
    return m.group(1) if m else None


def normalize_title(title: str | None) -> str:
    s = unicodedata.normalize("NFKD", title or "")
    s = "".join(c for c in s if not unicodedata.combining(c)).lower()
    s = re.sub(r"\$[^$]*\$", lambda m: m.group(0).strip("$"), s)
    s = re.sub(r"[^a-z0-9]+", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def paper_id_for(doi: str | None, ojs_article_id: str | None, title: str, first_author: str,
                 taken: set[str] | None = None) -> tuple[str, str]:
    """Return (paper_id, id_basis).

    1. DOI-backed:  doi_10.1609_aaai.v39i14.33617   (URL-safe; doi field keeps the DOI)
    2. OJS-backed:  ojs_aaai_33617                 (no DOI but an OJS article id)
    3. Title hash:  title_<16 hex of sha1(norm title|norm first author)>, with -2, -3...
       appended on collision with a different record.
    """
    if doi:
        return "doi_" + doi.replace("/", "_"), "doi"
    if ojs_article_id:
        return f"ojs_aaai_{ojs_article_id}", "ojs_article_id"
    base = "title_" + hashlib.sha1(f"{normalize_title(title)}|{normalize_title(first_author)}".encode()).hexdigest()[:16]
    pid, n = base, 1
    while taken is not None and pid in taken:
        n += 1
        pid = f"{base}-{n}"
    return pid, "title_hash"


def occurrence_id(paper_id: str, fmt: str, starts_at: str | None, ends_at: str | None) -> str:
    """One logical appearance = paper + format + time slot, however many schedule
    files list it. Slot-less appearances hash 'unknown'."""
    key = f"{paper_id}|{fmt}|{starts_at or 'unknown'}|{ends_at or 'unknown'}"
    return "occ_" + hashlib.sha1(key.encode()).hexdigest()[:16]


def action_id(event_id: str, actor: str, kind: str, target_type: str, target_id: str) -> str:
    """Same formula as app/lib/ids.js. One document per (event, actor, kind, target)."""
    key = f"{event_id}|{actor}|{kind}|{target_type}|{target_id}"
    return "act_" + hashlib.sha256(key.encode()).hexdigest()[:32]
