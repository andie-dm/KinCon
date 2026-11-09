#!/usr/bin/env python3
"""Import AAAI-25 papers into conference-papers-2025-v1.

    python3 scripts/import_conference_papers.py --conference AAAI-25 --limit 100
    python3 scripts/import_conference_papers.py --conference AAAI-25 --limit 0   # full

--conference selects the venue only. Main-track membership is decided per record
from authoritative proceedings evidence: volume 39, issues 1-25 of the OJS
tables of contents (issues 26-28 are other programs).

Safe to repeat and resumable: documents are written with bulk `update` +
`doc_as_upsert` by stable ID, and records whose content hash already matches
the indexed document are skipped. Schedule fields (occurrences) are owned by
scripts/import_schedules.py and are never touched here.

Needs ELASTICSEARCH_URL (+ ELASTIC_API_KEY) and the cached sources from
scripts/fetch_sources.py. --dry-run classifies and reports without writing.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
import time
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from confdata import mappings as M  # noqa: E402
from confdata.ids import CONFERENCE_ID, doi_article_id, doi_issue, normalize_doi, normalize_title, paper_id_for  # noqa: E402
from confdata.proceedings import RAW, load_proceedings  # noqa: E402
from confdata.tags import tag_paper  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
# CONF_REPORTS_DIR lets tests write reports elsewhere; committed reports come from full runs.
REPORTS = Path(os.environ.get("CONF_REPORTS_DIR") or ROOT / "reports")
HF_DATASET = "ai-conferences/AAAI2025"
HF_URL = "https://huggingface.co/datasets/ai-conferences/AAAI2025"
MAIN_VOLUME, MAIN_ISSUES = 39, range(1, 26)
DEMO_TITLES = ("flowpolicy", "self correcting robot manipulation via gaussian splatted foresight")
CONFERENCES = {"AAAI-25": CONFERENCE_ID}
BATCH = 100


def is_main_track(volume: int | None, issue: int | None) -> bool:
    return volume == MAIN_VOLUME and issue in MAIN_ISSUES


def _int(v) -> int | None:
    try:
        return int(str(v).strip())
    except (TypeError, ValueError):
        return None


def load_hf_rows() -> list[dict]:
    import pyarrow.parquet as pq
    return pq.read_table(RAW / "hf_aaai2025_train.parquet").to_pylist()


def manifest() -> dict:
    p = RAW / "manifest.json"
    return json.loads(p.read_text("utf-8")) if p.exists() else {}


def classify(row: dict, proc: dict[str, dict]) -> dict:
    """Decide volume/issue/main_track for one dataset row from proceedings evidence."""
    doi = normalize_doi(row.get("doi") or row.get("paper_id"))
    art = doi_article_id(doi) or (re.search(r"/article/view/(\d+)", row.get("paper_url") or "") or [None, None])[1]
    ds_vol, ds_issue = _int(row.get("volume")), _int(row.get("issue"))
    doi_vi = doi_issue(doi)
    p = proc.get(art) if art else None
    notes = []
    if doi_vi and (doi_vi[0], doi_vi[1]) != (ds_vol, ds_issue):
        notes.append(f"dataset issue {ds_vol}/{ds_issue} != DOI {doi_vi[0]}/{doi_vi[1]}")
    if p:
        vol, issue = p["volume"], p["issue"]
        if (ds_vol, ds_issue) != (vol, issue):
            notes.append(f"dataset issue {ds_vol}/{ds_issue} != proceedings {vol}/{issue}")
            status = "resolved_conflict_by_proceedings"
        else:
            status = "verified_by_proceedings"
        basis = f"ojs_toc:{p['toc_url']}"
    else:
        vol, issue, basis = ds_vol, ds_issue, "dataset_only"
        status = "unverified_not_in_proceedings"
        notes.append("OJS article id not found in volume 39 tables of contents")
    main = bool(p) and is_main_track(vol, issue)
    return {"doi": doi, "ojs_article_id": art, "volume": vol, "issue": issue, "main_track": main,
            "classification_status": status, "classification_basis": basis, "notes": notes, "proc": p}


def build_doc(row: dict, cls: dict, man: dict, taken: set[str]) -> dict:
    authors = list(row.get("authors") or [])
    pid, basis = paper_id_for(cls["doi"], cls["ojs_article_id"], row["title"], authors[0] if authors else "", taken)
    taken.add(pid)
    tags, prov = tag_paper(row["title"], row.get("abstract") or "")
    p = cls["proc"]
    hf_m = man.get("hf_aaai2025_train.parquet", {})
    toc_key = f"ojs/issue_{p['toc_url'].rsplit('/', 1)[1]}.html" if p else None
    doc = {
        "paper_id": pid, "conference_id": CONFERENCE_ID, "doi": cls["doi"], "id_basis": basis,
        "source_record_id": row.get("paper_id"), "ojs_article_id": cls["ojs_article_id"],
        "arxiv_id": row.get("arxiv_id") or None,
        "volume": cls["volume"], "issue": cls["issue"], "issue_label": p["issue_label"] if p else None,
        "pages": row.get("pages") or (p or {}).get("pages"),
        "main_track": cls["main_track"], "classification_status": cls["classification_status"],
        "classification_basis": cls["classification_basis"],
        "title": row["title"].strip(), "abstract": (row.get("abstract") or "").strip() or None,
        "paper_url": row.get("paper_url"), "pdf_url": row.get("pdf_url"),
        "authors": [{"name": a, "position": i + 1, "author_id": None, "author_id_scheme": None,
                     "identity_status": "unresolved_name_only"} for i, a in enumerate(authors)],
        "author_names": authors, "author_count": len(authors),
        "tags": tags, "tag_provenance": prov,
        "research_text": row["title"].strip() + ("\n\n" + row["abstract"].strip() if row.get("abstract") else ""),
        "metadata_provenance": {
            "dataset": row.get("_dataset", HF_DATASET), "dataset_revision": row.get("_revision"),
            "dataset_url": row.get("_dataset_url", HF_URL), "record_url": row.get("paper_url"),
            "retrieved_at": row.get("_retrieved_at") or hf_m.get("retrieved_at"),
            "attribution": row.get("_attribution", "Metadata: ai-conferences/AAAI2025 (Hugging Face); "
                           "bibliographic record: Proceedings of the AAAI Conference on Artificial Intelligence 39."),
            "proceedings_toc_url": p["toc_url"] if p else None,
            "proceedings_retrieved_at": man.get(toc_key, {}).get("retrieved_at") if toc_key else None,
        },
    }
    doc["content_hash"] = hashlib.sha256(json.dumps(doc, sort_keys=True, default=str).encode()).hexdigest()
    return doc


def backfill_rows(proc: dict[str, dict], seen_articles: set[str], man: dict) -> list[dict]:
    """Proceedings entries absent from the dataset. Title/authors/pages come from
    the OJS TOC; there is no abstract. The DOI follows AAAI's registered pattern
    10.1609/aaai.v{vol}i{issue}.{article}, which every dataset record matches."""
    rows = []
    for art, p in sorted(proc.items(), key=lambda kv: (kv[1]["issue"], int(kv[0]))):
        if art in seen_articles:
            continue
        rows.append({"paper_id": None, "doi": f"10.1609/aaai.v{p['volume']}i{p['issue']}.{art}",
                     "title": p["title"], "authors": p["authors"], "abstract": None,
                     "paper_url": p["url"], "pdf_url": None, "volume": p["volume"], "issue": p["issue"],
                     "pages": p["pages"], "_dataset": "ojs_toc_backfill", "_dataset_url": p["toc_url"],
                     "_attribution": "Bibliographic record from the AAAI OJS table of contents "
                                     "(DOI derived from AAAI's DOI pattern; no abstract in source).",
                     "_retrieved_at": man.get(f"ojs/issue_{p['toc_url'].rsplit('/', 1)[1]}.html", {}).get("retrieved_at")})
    return rows


def existing_ids_by_doi(es, dois: list[str], index: str = M.PAPERS) -> dict[str, dict]:
    """Preserve any document ID already used for a DOI (e.g. by an earlier importer)."""
    if not es.exists(index) or not dois:
        return {}
    r = es.search(index, {"size": len(dois) * 2, "query": {"terms": {"doi": dois}},
                             "_source": ["doi", "content_hash", "official_topics"]})
    return {h["_source"]["doi"]: {"_id": h["_id"], "content_hash": h["_source"].get("content_hash"),
                                  "scheduled_tags": bool(h["_source"].get("official_topics"))}
            for h in r["hits"]["hits"]}


def write_batch(es, docs: list[dict], force: bool, stats: Counter, failures: dict, index: str = M.PAPERS) -> None:
    from confdata.es import split_bulk_failures
    existing = existing_ids_by_doi(es, [d["doi"] for d in docs if d["doi"]], index)
    lines, now = [], datetime.now(timezone.utc).isoformat()
    for d in docs:
        ex = existing.get(d["doi"]) if d["doi"] else None
        _id = ex["_id"] if ex else d["paper_id"]
        if ex and _id != d["paper_id"]:
            d = {**d, "paper_id": _id}
            stats["preserved_existing_id"] += 1
        if ex and ex.get("content_hash") == d["content_hash"] and not force:
            stats["skipped_unchanged"] += 1
            continue
        # New docs use `create`: on ES 9.5 a bulk update that creates a doc from a
        # separate `upsert` body skips semantic_text inference. Existing docs get a
        # partial `doc` update, which keeps occurrences and re-embeds changed text.
        if ex:
            # Tags derived from official session topics belong to import_schedules.py.
            # Changed paper content also invalidates schedule_hash, so the next
            # schedule run recomputes those tags from the new title/abstract.
            doc = {k: v for k, v in d.items() if not (ex.get("scheduled_tags") and k in ("tags", "tag_provenance"))}
            lines.append({"update": {"_index": index, "_id": _id, "retry_on_conflict": 3}})
            lines.append({"doc": {**doc, "schedule_hash": None, "updated_at": now}})
        else:
            lines.append({"create": {"_index": index, "_id": _id}})
            lines.append({**d, "ingested_at": now, "updated_at": now, "schedule_status": "unscheduled", "occurrence_count": 0})
    if not lines:
        return
    pending = lines
    for attempt in range(4):
        resp = es.bulk(pending)
        retry, perm = split_bulk_failures(resp)
        for it in resp["items"]:
            op = next(iter(it.values()))
            if op.get("status", 500) < 300:
                stats["created" if op.get("result") == "created" else op.get("result", "updated")] += 1
        for f in perm:
            failures["permanent"].append(f)
        if not retry:
            break
        ids = {f["_id"] for f in retry}
        pending = [l for i in range(0, len(pending), 2) if next(iter(pending[i].values()))["_id"] in ids
                   for l in pending[i:i + 2]]
        if attempt == 3:
            failures["retryable_exhausted"].extend(retry)
        else:
            stats["retried"] += len(retry)
            time.sleep(2 ** attempt)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--conference", required=True, choices=sorted(CONFERENCES))
    ap.add_argument("--limit", type=int, default=0, help="records to write; 0 = full import")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--force", action="store_true", help="rewrite even if content hash is unchanged")
    ap.add_argument("--index", default=M.PAPERS, help="target index (default %(default)s; tests use a scratch index)")
    ap.add_argument("--no-other-programs", action="store_true",
                    help="skip issues 26-28 (indexed with main_track=false by default)")
    args = ap.parse_args()

    man = manifest()
    rows = load_hf_rows()
    api = RAW / "hf_api.json"
    rev = json.loads(api.read_text("utf-8")).get("sha") if api.exists() else None
    for r in rows:
        r["_revision"] = rev
    proc = load_proceedings()
    proc_main = {a for a, p in proc.items() if is_main_track(p["volume"], p["issue"])}

    # --- classify raw rows before indexing
    classified, taken = [], set()
    dup_doi, dup_title = Counter(), defaultdict(list)
    for r in rows:
        c = classify(r, proc)
        classified.append((r, c))
        dup_doi[c["doi"]] += 1
        dup_title[normalize_title(r["title"])].append(c["doi"])
    seen_articles = {c["ojs_article_id"] for _, c in classified if c["ojs_article_id"]}
    backfill = backfill_rows(proc, seen_articles, man)
    for r in backfill:
        c = classify(r, proc)
        c["classification_status"] = "backfilled_from_proceedings"
        classified.append((r, c))
    if args.no_other_programs:
        classified = [(r, c) for r, c in classified if c["main_track"] or c["proc"] is None]

    docs = [build_doc(r, c, man, taken) for r, c in classified]
    by_id = {d["paper_id"]: (d, c) for d, (_, c) in zip(docs, classified)}

    # --- selection (deterministic). Demo papers are always included in limited runs.
    order = sorted(docs, key=lambda d: (not d["main_track"], d["issue"] or 99, d["ojs_article_id"] or "", d["paper_id"]))
    if args.limit:
        demo = [d for d in order if normalize_title(d["title"]).startswith(DEMO_TITLES)]
        rest = [d for d in order if d not in demo]
        order = demo + rest[: max(0, args.limit - len(demo))]

    stats, failures = Counter(), {"permanent": [], "retryable_exhausted": []}
    es = None
    if not args.dry_run:
        from confdata.es import ES
        es = ES()
        if not es.exists(args.index):
            print(f"{args.index} does not exist; run scripts/setup_indexes.py first", file=sys.stderr)
            return 2
        for i in range(0, len(order), BATCH):
            write_batch(es, order[i:i + BATCH], args.force, stats, failures, args.index)
            print(f"  {min(i + BATCH, len(order))}/{len(order)} {dict(stats)}", flush=True)
        es.refresh(args.index)

    # --- coverage report
    imported_main_dois = set()
    indexed_count = None
    if es:
        r = es.search(args.index, {"size": 0, "track_total_hits": True, "query": {"bool": {"filter": [
            {"term": {"conference_id": CONFERENCE_ID}}, {"term": {"main_track": True}}]}},
            "aggs": {"status": {"terms": {"field": "classification_status"}}}})
        indexed_count = r["hits"]["total"]["value"]
        scroll = es.search(args.index, {"size": 5000, "_source": ["doi"], "query": {"term": {"main_track": True}}})
        imported_main_dois = {h["_source"]["doi"] for h in scroll["hits"]["hits"]}
    auth_main_dois = {d["doi"] for d in docs if d["main_track"] and d["ojs_article_id"] in proc_main}
    missing = sorted(auth_main_dois - imported_main_dois) if es else None
    ambiguous = [{"paper_id": d["paper_id"], "status": c["classification_status"], "notes": c["notes"]}
                 for d, c in by_id.values() if c["notes"]]
    author_mismatch = []
    for d, c in by_id.values():
        p = c["proc"]
        if p and [normalize_title(a) for a in p["authors"]] != [normalize_title(a["name"]) for a in d["authors"]]:
            author_mismatch.append({"paper_id": d["paper_id"], "dataset_authors": len(d["authors"]),
                                    "toc_authors": len(p["authors"])})
    report = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "conference_id": CONFERENCE_ID, "run": {"limit": args.limit, "dry_run": args.dry_run,
                                                "selected": len(order), "write_stats": dict(stats)},
        "source_collection_count": len(rows),
        "source_collection_note": "ai-conferences/AAAI2025 train split; the dataset's own track/issue labels are not trusted for membership.",
        "proceedings_entries_volume_39": len(proc),
        "proceedings_entries_by_issue": dict(sorted(Counter(p["issue"] for p in proc.values()).items())),
        "authoritative_main_track_count": len(proc_main),
        "dataset_records_matched_to_main_track_toc": sum(1 for _, c in classified if c["ojs_article_id"] in proc_main and c["classification_status"] != "backfilled_from_proceedings"),
        "backfilled_from_proceedings": {"main_track": sum(1 for r in backfill if is_main_track(r["volume"], r["issue"])),
                                        "other_programs": sum(1 for r in backfill if not is_main_track(r["volume"], r["issue"]))},
        "dataset_records_not_in_proceedings": [d["paper_id"] for d, c in by_id.values() if c["proc"] is None],
        "verified_imported_main_track_count": indexed_count,
        "missing_main_track_dois_in_index": missing if missing is None or len(missing) <= 200 else missing[:200] + [f"... {len(missing) - 200} more"],
        "missing_main_track_count": None if missing is None else len(missing),
        "ambiguous_classifications": ambiguous,
        "duplicate_doi_findings": [{"doi": k, "count": v} for k, v in dup_doi.items() if v > 1],
        "duplicate_normalized_titles": [{"title": k, "dois": v} for k, v in dup_title.items() if len(v) > 1],
        "author_list_discrepancies_vs_toc": {"count": len(author_mismatch), "examples": author_mismatch[:25]},
        "bulk_failures": failures,
        "unresolved_source_discrepancies": [],
        "abstract_missing": sum(1 for d in docs if not d["abstract"]),
    }
    REPORTS.mkdir(parents=True, exist_ok=True)
    out = REPORTS / ("paper_coverage.dry_run.json" if args.dry_run else "paper_coverage.json" if args.index == M.PAPERS
                     else f"paper_coverage.{args.index}.json")
    out.write_text(json.dumps(report, indent=2), "utf-8")
    print(json.dumps({k: report[k] for k in ("source_collection_count", "authoritative_main_track_count",
                                               "dataset_records_matched_to_main_track_toc", "backfilled_from_proceedings",
                                               "verified_imported_main_track_count", "missing_main_track_count")}, indent=1))
    print(f"ambiguous={len(ambiguous)} dup_doi={len(report['duplicate_doi_findings'])} "
          f"author_discrepancies={len(author_mismatch)} permanent_failures={len(failures['permanent'])} "
          f"retryable_exhausted={len(failures['retryable_exhausted'])} -> {out}")
    return 1 if failures["permanent"] or failures["retryable_exhausted"] else 0


if __name__ == "__main__":
    sys.exit(main())
