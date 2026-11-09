"""Canonical topic tags shared by papers, people and groups.

A paper gets a tag when (a) one of its official session topics matches the
tag's official_topics prefix, or (b) an alias occurs in the title, or (c) an
alias occurs at least twice in the abstract. At most MAX_TAGS tags, ordered by
evidence strength. Provenance is kept as "<tag>:<basis>" strings.
"""
from __future__ import annotations

import json
import re
from functools import lru_cache
from pathlib import Path

EVENT_FIXTURE = Path(__file__).resolve().parents[2] / "fixtures" / "event.json"
MAX_TAGS = 5


@lru_cache(maxsize=1)
def vocabulary() -> list[dict]:
    return json.loads(EVENT_FIXTURE.read_text("utf-8"))["topic_vocabulary"]


def canonical_tags() -> set[str]:
    return {v["tag"] for v in vocabulary()}


def _alias_re(alias: str) -> re.Pattern:
    return re.compile(r"(?<![a-z0-9])" + re.escape(alias.lower()) + r"(?![a-z0-9])")


@lru_cache(maxsize=1)
def _compiled() -> list[tuple[str, list[str], list[re.Pattern]]]:
    return [(v["tag"], v["official_topics"], [_alias_re(a) for a in v["aliases"]]) for v in vocabulary()]


def tag_paper(title: str, abstract: str, official_topics: list[str] | None = None) -> tuple[list[str], list[str]]:
    title_l, abs_l = (title or "").lower(), (abstract or "").lower()
    topics = [t.lower() for t in (official_topics or [])]
    scored: list[tuple[int, str, str]] = []
    for tag, prefixes, pats in _compiled():
        if any(t.startswith(p.lower()) for p in prefixes for t in topics):
            scored.append((3, tag, "official_topic"))
        elif any(p.search(title_l) for p in pats):
            scored.append((2, tag, "dictionary_title"))
        elif sum(len(p.findall(abs_l)) for p in pats) >= 2:
            scored.append((1, tag, "dictionary_abstract"))
    scored.sort(key=lambda x: -x[0])
    kept = scored[:MAX_TAGS]
    return [t for _, t, _ in kept], [f"{t}:{b}" for _, t, b in kept]


def validate_tags(tags: list[str]) -> list[str]:
    unknown = sorted(set(tags) - canonical_tags())
    if unknown:
        raise ValueError(f"non-canonical tags: {unknown}")
    return tags
