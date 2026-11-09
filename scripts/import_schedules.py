#!/usr/bin/env python3
"""Join official AAAI-25 oral and poster schedules onto indexed papers.

    python3 scripts/import_schedules.py            # parse, join, write occurrences
    python3 scripts/import_schedules.py --dry-run  # parse + join + report only

Run after import_conference_papers.py. Each matched paper's `occurrences`
array is rebuilt deterministically and replaced, so reruns are no-ops.

Source precedence (newest official file wins for the days it covers):
  orals   : Main Track Oral Talks 2.22 (no rooms published -> room unknown)
  posters : Saturday 2.27.25 (Mar 1)  >  Main Track Poster 2.21 (Feb 27-Mar 1)
  2025-01-22 Saturday file: superseded. Used for official topic labels and a
  discrepancy check. A paper listed ONLY there gets an occurrence marked
  verification_status=unverified_superseded_source_only.
Poster room/venue comes from the official poster-sessions page, which places
every Feb 27-Mar 1 poster session in Exhibit Hall E, 12:30-2:30 pm.
A listing says where a poster is scheduled, never who will be present.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import import_conference_papers as IP  # noqa: E402
from confdata import mappings as M  # noqa: E402
from confdata.ids import normalize_title, occurrence_id  # noqa: E402
from confdata.proceedings import RAW  # noqa: E402
from confdata.schedules import (POSTER_BUILDING, POSTER_ROOM, POSTER_VENUE, POSTER_VENUE_URL, TZ, Matcher,  # noqa: E402
                                SourceFile, parse_pdf, poster_slot_is_official, regroup_topics)
from confdata.tags import tag_paper  # noqa: E402

ORAL = SourceFile("oral_main_track_2025-02-22.pdf", "https://aaai.org/wp-content/uploads/2025/02/AAAI-25-Main-Track-Oral-Talks-Schedule-2.22.pdf",
                  "oral", "2025-02-22", True)
POSTER_SAT = SourceFile("poster_saturday_2025-02-27.pdf", "https://aaai.org/wp-content/uploads/2025/02/AAAI-25-Saturday-Poster-Schedule-2.27.25.pdf",
                        "poster", "2025-02-27", True, {(3, 1)})
POSTER_MAIN = SourceFile("poster_main_track_2025-02-21.pdf", "https://aaai.org/wp-content/uploads/2025/02/AAAI-25-Main-Track-Poster-Schedule-2.21.pdf",
                         "poster", "2025-02-21", True, {(2, 27), (2, 28), (3, 1)})
POSTER_JAN = SourceFile("poster_saturday.pdf", "https://aaai.org/wp-content/uploads/2025/01/AAAI-25-Poster-Schedule_2025-01-22_Saturday-Only.pdf",
                        "poster", "2025-01-22", False, {(3, 1)})
SOURCES = [ORAL, POSTER_SAT, POSTER_MAIN, POSTER_JAN]


def build_papers() -> list[dict]:
    """Same records and IDs as the paper importer (no ES needed)."""
    man = IP.manifest()
    rows = IP.load_hf_rows()
    proc = IP.load_proceedings()
    classified = [(r, IP.classify(r, proc)) for r in rows]
    seen = {c["ojs_article_id"] for _, c in classified if c["ojs_article_id"]}
    classified += [(r, IP.classify(r, proc)) for r in IP.backfill_rows(proc, seen, man)]
    taken: set[str] = set()
    return [IP.build_doc(r, c, man, taken) for r, c in classified]


def _day(iso: str) -> tuple[int, int]:
    d = datetime.fromisoformat(iso)
    return d.month, d.day


def build_occurrences(paper: dict, rows: list, man: dict, now: str) -> tuple[list[dict], list[dict]]:
    """Return (occurrences, discrepancies) for one paper's matched schedule rows."""
    pid = paper["paper_id"]
    disc = []
    slots: dict[tuple, list] = defaultdict(list)
    for r, m in rows:
        slots[(r.source.fmt, r.starts_at, r.ends_at)].append((r, m))
    auth_poster_days = {_day(s[1]) for s, rs in slots.items() if s[0] == "poster" and s[1]
                        and any(r.source.authoritative for r, _ in rs)}
    sat_listed = any(r.source is POSTER_SAT for rs in slots.values() for r, _ in rs)
    occs = []
    for (fmt, start, end), rs in sorted(slots.items(), key=lambda kv: (kv[0][1] or "", kv[0][0])):
        srcs = sorted({r.source for r, _ in rs}, key=lambda s: s.published, reverse=True)
        best_r, best_m = next(((r, m) for r, m in rs if r.source is srcs[0]))
        occ = {"occurrence_id": occurrence_id(pid, fmt, start, end), "session_id": None,
               "session_title": best_r.session_title, "format": fmt, "starts_at": start, "ends_at": end,
               "time_zone": TZ, "room": None, "building": None, "venue": None,
               "board": next((r.board for r, _ in rs if r.board), None),
               "schedule_submission_id": best_r.submission_id,
               "source_url": srcs[0].url, "source_urls": [s.url for s in srcs],
               "match_method": best_m["match_method"], "match_score": best_m["match_score"],
               "time_status": "published" if start else "unconfirmed", "verified_at": None}
        if fmt == "oral":
            occ.update(location_status="room_not_published", verification_status="time_verified_room_unconfirmed",
                       verified_at=now)
        elif not any(s.authoritative for s in srcs) and auth_poster_days:
            disc.append({"paper_id": pid, "title": paper["title"], "issue": "rescheduled: 2025-01-22 file lists "
                         f"{start}; newer official schedules list another poster slot (stale slot not stored)"})
            continue
        elif not any(s.authoritative for s in srcs):
            occ.update(location_status="unconfirmed", time_status="superseded_source_only",
                       verification_status="unverified_superseded_source_only")
            disc.append({"paper_id": pid, "title": paper["title"], "issue": "listed only in superseded 2025-01-22 "
                         "Saturday schedule; absent from 2.21 main-track and 2.27 Saturday poster schedules",
                         "slot": start})
        else:
            official = start and end and poster_slot_is_official(start, end)
            occ.update(room=POSTER_ROOM, building=POSTER_BUILDING, venue=POSTER_VENUE,
                       source_urls=occ["source_urls"] + [POSTER_VENUE_URL])
            if not official:
                occ.update(location_status="unconfirmed", verification_status="time_outside_official_poster_hours")
                disc.append({"paper_id": pid, "issue": "poster slot outside official 12:30-2:30 pm hours", "slot": start})
            elif _day(start) == (3, 1) and not sat_listed:
                occ.update(location_status="venue_published", verification_status="conflict_absent_from_newer_schedule")
                disc.append({"paper_id": pid, "title": paper["title"],
                             "issue": "Saturday slot in 2.21 main-track schedule but absent from 2.27 Saturday schedule",
                             "slot": start})
            elif _day(start) != (3, 1) and sat_listed:
                occ.update(location_status="venue_published", verification_status="conflict_newer_schedule_differs")
                disc.append({"paper_id": pid, "title": paper["title"],
                             "issue": "2.21 schedule lists a different day than the newer 2.27 Saturday schedule",
                             "slot": start})
            else:
                occ.update(location_status="venue_published", verification_status="verified", verified_at=now)
        occs.append(occ)
    if len(auth_poster_days) > 1:
        disc.append({"paper_id": pid, "issue": f"authoritative poster listings on {len(auth_poster_days)} different days"})
    return occs, disc


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    now = datetime.now(timezone.utc).isoformat()
    man = IP.manifest()
    papers = build_papers()
    matcher = Matcher(papers)
    by_paper: dict[str, list] = defaultdict(list)
    topics: dict[str, list[str]] = {}
    per_source, ambiguous, unmatched = {}, [], []
    for src in SOURCES:
        rows = parse_pdf(RAW / src.key, src)
        c = Counter()
        for r in rows:
            m = matcher.match(r)
            c[m["status"]] += 1
            if m["status"] == "matched":
                c[m["match_method"]] += 1
                by_paper[m["paper"]["paper_id"]].append((r, m))
                if r.topics:
                    topics.setdefault(m["paper"]["paper_id"], regroup_topics(r.topics))
            elif m["status"] == "ambiguous":
                ambiguous.append({"source": src.key, "page": r.page, "title": r.title, "authors": r.authors[:4],
                                  "reason": m["reason"], "candidates": m.get("candidates")})
            else:
                unmatched.append({"source": src.key, "page": r.page, "title": r.title})
        c["rows_without_parsed_slot"] = sum(1 for r in rows if not r.starts_at)
        per_source[src.key] = {"url": src.url, "published": src.published, "authoritative": src.authoritative,
                               "retrieved_at": man.get(src.key, {}).get("retrieved_at"), "rows": len(rows), **c}
        print(f"{src.key}: {per_source[src.key]}", flush=True)

    pmap = {p["paper_id"]: p for p in papers}
    updates, discrepancies, vstat = {}, [], Counter()
    for pid, rows in by_paper.items():
        occs, disc = build_occurrences(pmap[pid], rows, man, now)
        discrepancies += disc
        for o in occs:
            vstat[(o["format"], o["verification_status"])] += 1
        p = pmap[pid]
        off = topics.get(pid, [])
        tags, prov = tag_paper(p["title"], p["abstract"] or "", off)
        used = sorted({r.source.key for r, _ in rows})
        updates[pid] = {"occurrences": occs, "occurrence_count": len(occs),
                        "schedule_status": "scheduled" if any(o["verification_status"] in ("verified", "time_verified_room_unconfirmed") for o in occs) else "unconfirmed",
                        "schedule_provenance": [{"url": per_source[k]["url"], "retrieved_at": per_source[k]["retrieved_at"],
                                                 "role": "schedule"} for k in used] +
                                               [{"url": POSTER_VENUE_URL, "retrieved_at": man.get("poster_sessions.html", {}).get("retrieved_at"),
                                                 "role": "venue"}],
                        "schedule_joined_at": now, "official_topics": off, "tags": tags, "tag_provenance": prov}
        if any(o["verification_status"] == "verified" for o in occs):
            updates[pid]["verified_at"] = now
        # Hash everything except run timestamps so an unchanged join is skipped.
        stable = {k: v for k, v in updates[pid].items() if k not in ("schedule_joined_at", "verified_at")}
        stable["occurrences"] = [{k: v for k, v in o.items() if k != "verified_at"} for o in occs]
        stable["schedule_provenance"] = [{k: v for k, v in sp.items()} for sp in updates[pid]["schedule_provenance"]]
        updates[pid]["schedule_hash"] = hashlib.sha256(json.dumps(stable, sort_keys=True).encode()).hexdigest()

    write = Counter()
    failures = {"permanent": [], "retryable": []}
    if not args.dry_run:
        from confdata.es import ES, split_bulk_failures
        es = ES()
        ids = list(updates)
        existing = {}
        for i in range(0, len(ids), 500):
            for d in es.mget(M.PAPERS, ids[i:i + 500], source=["schedule_hash"])["docs"]:
                existing[d["_id"]] = d["_source"].get("schedule_hash") or True if d.get("found") else False
        missing = [i for i in ids if not existing.get(i)]
        write["paper_not_indexed"] = len(missing)
        lines = []
        for pid in ids:
            if existing.get(pid) == updates[pid]["schedule_hash"]:
                write["skipped_unchanged"] += 1
            elif existing.get(pid):
                lines += [{"update": {"_index": M.PAPERS, "_id": pid, "retry_on_conflict": 3}},
                          {"doc": {**updates[pid], "updated_at": now}, "detect_noop": True}]
        # Clear stale occurrences on papers no longer matched by any schedule.
        stale = es.search(M.PAPERS, {"size": 5000, "_source": False, "query": {"bool": {
            "filter": [{"range": {"occurrence_count": {"gt": 0}}}], "must_not": [{"ids": {"values": ids}}]}}})
        for h in stale["hits"]["hits"]:
            # Reset every schedule-owned field, including the hash, so a later
            # rematch is written instead of skipped; tags fall back to title/abstract.
            clear = {"occurrences": [], "occurrence_count": 0, "schedule_status": "unscheduled",
                     "schedule_hash": None, "schedule_provenance": [], "official_topics": [], "updated_at": now}
            p = pmap.get(h["_id"])
            if p:
                clear["tags"], clear["tag_provenance"] = p["tags"], p["tag_provenance"]
            lines += [{"update": {"_index": M.PAPERS, "_id": h["_id"], "retry_on_conflict": 3}}, {"doc": clear}]
            write["cleared_stale"] += 1
        for i in range(0, len(lines), 1000):
            resp = es.bulk(lines[i:i + 1000])
            for it in resp["items"]:
                write[it["update"].get("result", "error")] += 1
            r, p = split_bulk_failures(resp)
            failures["retryable"] += r
            failures["permanent"] += p
        es.refresh(M.PAPERS)

    main_ids = {p["paper_id"] for p in papers if p["main_track"]}
    main_sched = [pid for pid in updates if pid in main_ids]
    demo = {}
    for p in papers:
        if normalize_title(p["title"]).startswith(IP.DEMO_TITLES):
            demo[p["title"]] = {"paper_id": p["paper_id"], "occurrences": updates.get(p["paper_id"], {}).get("occurrences", [])}
    report = {
        "generated_at": now,
        "note": "Schedule coverage is reported separately from bibliographic coverage (reports/paper_coverage.json).",
        "sources": per_source,
        "main_track_papers": len(main_ids),
        "main_track_papers_with_any_occurrence": len(main_sched),
        "main_track_papers_with_verified_occurrence": sum(1 for pid in main_sched if any(
            o["verification_status"] in ("verified", "time_verified_room_unconfirmed") for o in updates[pid]["occurrences"])),
        "main_track_papers_with_multiple_occurrences": sum(1 for pid in main_sched if updates[pid]["occurrence_count"] > 1),
        "other_program_papers_with_occurrence": len(updates) - len(main_sched),
        "occurrences_by_format_and_status": {f"{k[0]}:{k[1]}": v for k, v in sorted(vstat.items())},
        "ambiguous_matches_not_stored": len(ambiguous), "ambiguous_examples": ambiguous[:40],
        "unmatched_rows": len(unmatched), "unmatched_examples": unmatched[:40],
        "discrepancies": len(discrepancies),
        "discrepancy_counts": dict(Counter(d["issue"].split(":")[0].split(";")[0] for d in discrepancies)),
        "discrepancy_examples": discrepancies[:60],
        "demo_papers": demo,
        "write": dict(write), "bulk_failures": failures,
    }
    out = Path(IP.REPORTS) / ("schedule_coverage.dry_run.json" if args.dry_run else "schedule_coverage.json")
    out.write_text(json.dumps(report, indent=2), "utf-8")
    print(json.dumps({k: v for k, v in report.items() if k not in ("sources", "ambiguous_examples", "unmatched_examples",
                                                                      "discrepancy_examples", "demo_papers")}, indent=1))
    print(json.dumps(demo, indent=1))
    return 1 if failures["permanent"] else 0


if __name__ == "__main__":
    sys.exit(main())
