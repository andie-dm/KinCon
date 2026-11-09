"""Ingestion tests. Unit tests need only the cached sources in data/raw
(scripts/fetch_sources.py). Tests marked `live` also need ELASTICSEARCH_URL
and a completed import; they are skipped otherwise."""
from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

import import_conference_papers as IP  # noqa: E402
import import_schedules as IS  # noqa: E402
from confdata import mappings as M  # noqa: E402
from confdata.ids import normalize_doi, occurrence_id, paper_id_for  # noqa: E402
from confdata.schedules import Matcher, Row, SourceFile, author_confirmation, parse_slot  # noqa: E402

live = pytest.mark.skipif(not os.environ.get("ELASTICSEARCH_URL"), reason="ELASTICSEARCH_URL not set")
FLOWPOLICY = "doi_10.1609_aaai.v39i14.33617"


@pytest.fixture(scope="module")
def proc():
    return IP.load_proceedings()


@pytest.fixture(scope="module")
def papers():
    return IS.build_papers()


# 1. Main-track classification: volume 39, issues 1-25.
@pytest.mark.parametrize("vol,issue,want", [(39, 1, True), (39, 25, True), (39, 26, False), (39, 28, False),
                                            (39, 0, False), (38, 5, False), (39, None, False)])
def test_main_track_boundary(vol, issue, want):
    assert IP.is_main_track(vol, issue) is want


def test_conflicting_issue_resolved_by_proceedings(proc):
    # A dataset row that claims issue 5 for an article the TOC places in issue 27.
    art, p = next((a, p) for a, p in proc.items() if p["issue"] == 27)
    row = {"doi": f"10.1609/aaai.v39i5.{art}", "volume": "39", "issue": "5", "title": p["title"],
           "authors": p["authors"], "paper_url": p["url"]}
    c = IP.classify(row, proc)
    assert c["issue"] == 27 and c["main_track"] is False
    assert c["classification_status"] == "resolved_conflict_by_proceedings" and c["notes"]


def test_absent_issue_not_assumed_main_track(proc):
    row = {"doi": "10.1609/aaai.v39i3.99999999", "volume": "39", "issue": None, "title": "Not in proceedings",
           "authors": ["A. Person"], "paper_url": "https://ojs.aaai.org/index.php/AAAI/article/view/99999999"}
    c = IP.classify(row, proc)
    assert c["main_track"] is False and c["classification_status"] == "unverified_not_in_proceedings"


def test_full_classification_counts(papers):
    main = [p for p in papers if p["main_track"]]
    assert len(main) == 3028
    assert all(p["volume"] == 39 and 1 <= p["issue"] <= 25 for p in main)
    assert all(not (1 <= p["issue"] <= 25) for p in papers if not p["main_track"])


@pytest.mark.parametrize("raw", ["10.1609/aaai.v39i14.33617", "https://doi.org/10.1609/AAAI.V39I14.33617",
                                 "doi:10.1609/aaai.v39i14.33617 ", "http://dx.doi.org/10.1609/aaai.v39i14.33617."])
def test_doi_normalization(raw):
    assert normalize_doi(raw) == "10.1609/aaai.v39i14.33617"


def test_fallback_ids_are_deterministic_and_collision_safe():
    a, basis = paper_id_for(None, None, "Same Title", "First Author", set())
    assert basis == "title_hash" and a == paper_id_for(None, None, "Same Title", "First Author", set())[0]
    b, _ = paper_id_for(None, None, "Same Title", "First Author", {a})
    assert b == a + "-2"
    assert paper_id_for(None, "123", "x", "y")[0] == "ojs_aaai_123"


# 4. Every credited author survives, in byline order.
def test_every_author_survives(papers):
    rows = {r["paper_id"]: r for r in IP.load_hf_rows()}
    for p in papers:
        src = rows.get(p["source_record_id"])
        if not src:
            continue
        assert [a["name"] for a in p["authors"]] == list(src["authors"])
        assert [a["position"] for a in p["authors"]] == list(range(1, len(src["authors"]) + 1))
        assert p["author_count"] == len(src["authors"])


# 5. Equal names never merge into one identity.
def test_equal_names_do_not_merge(papers):
    from collections import Counter
    names = Counter(a["name"] for p in papers for a in p["authors"])
    shared = next(n for n, c in names.items() if c > 1)
    hits = [a for p in papers for a in p["authors"] if a["name"] == shared]
    assert len(hits) > 1
    assert all(a["author_id"] is None and a["identity_status"] == "unresolved_name_only" for a in hits)


def _row(src, title, authors, start="2025-03-01T12:30:00-05:00", end="2025-03-01T14:30:00-05:00"):
    return Row(source=src, page=1, starts_at=start, ends_at=end, slot_text="", submission_id="1",
               title=title, authors=authors)


# 6. Multiple appearances stay distinct; one appearance in many files stays one.
def test_multiple_appearances_distinct(papers):
    fp = next(p for p in papers if p["paper_id"] == FLOWPOLICY)
    names = [a["name"] for a in fp["authors"]]
    m = Matcher(papers)
    rows = [_row(IS.ORAL, fp["title"], names[:3], "2025-03-01T09:30:00-05:00", "2025-03-01T10:45:00-05:00"),
            _row(IS.POSTER_SAT, fp["title"], names), _row(IS.POSTER_MAIN, fp["title"], names),
            _row(IS.POSTER_JAN, fp["title"], names)]
    matched = [(r, m.match(r)) for r in rows]
    assert all(x["status"] == "matched" for _, x in matched)
    occs, _ = IS.build_occurrences(fp, matched, {}, "2026-01-01T00:00:00+00:00")
    assert sorted(o["format"] for o in occs) == ["oral", "poster"]
    assert len({o["occurrence_id"] for o in occs}) == 2
    poster = next(o for o in occs if o["format"] == "poster")
    assert poster["verification_status"] == "verified" and poster["room"] == "Exhibit Hall E"
    assert len(poster["source_urls"]) == 4


def test_ambiguous_fuzzy_is_not_accepted(papers):
    m = Matcher(papers)
    fp = next(p for p in papers if p["paper_id"] == FLOWPOLICY)
    r = m.match(_row(IS.POSTER_SAT, fp["title"], ["Nobody Here", "Someone Else"]))
    assert r["status"] == "ambiguous"  # exact title but authors do not confirm


def test_author_confirmation_handles_truncation():
    assert author_confirmation(["Qinglun Zhang", "Zhen Liu", "Haoqiang"], ["Qinglun Zhang", "Zhen Liu", "Haoqiang Fan"]) >= 2 / 3


def test_slot_parsing_timezone():
    assert parse_slot("Saturday March 1, 12:30pm-2:30pm") == ("2025-03-01T12:30:00-05:00", "2025-03-01T14:30:00-05:00")


# 16. Missing schedule/location stays explicitly unconfirmed.
def test_superseded_only_listing_is_unconfirmed(papers):
    gs = next(p for p in papers if p["title"].startswith("Self-Correcting Robot Manipulation"))
    r = _row(IS.POSTER_JAN, gs["title"], [a["name"] for a in gs["authors"]])
    occs, disc = IS.build_occurrences(gs, [(r, Matcher(papers).match(r))], {}, "2026-01-01T00:00:00+00:00")
    assert occs[0]["verification_status"] == "unverified_superseded_source_only"
    assert occs[0]["room"] is None and occs[0]["location_status"] == "unconfirmed" and disc


def test_occurrence_ids_deterministic():
    a = occurrence_id(FLOWPOLICY, "poster", "2025-03-01T12:30:00-05:00", "2025-03-01T14:30:00-05:00")
    assert a == occurrence_id(FLOWPOLICY, "poster", "2025-03-01T12:30:00-05:00", "2025-03-01T14:30:00-05:00")
    assert a != occurrence_id(FLOWPOLICY, "oral", "2025-03-01T12:30:00-05:00", "2025-03-01T14:30:00-05:00")


# ------------------------------------------------------------------ live

_REPORT_DIR = None


def _run(*args):
    # Live tests must never overwrite the committed full-run reports in reports/.
    global _REPORT_DIR
    if _REPORT_DIR is None:
        import tempfile
        _REPORT_DIR = tempfile.mkdtemp(prefix="conf-reports-")
    env = {**os.environ, "CONF_REPORTS_DIR": _REPORT_DIR}
    return subprocess.run([sys.executable, *args], cwd=ROOT, capture_output=True, text=True, timeout=1800, env=env)


@pytest.fixture(scope="module")
def es():
    from confdata.es import ES
    return ES()


@live
def test_live_index_counts(es):
    r = es.search(M.PAPERS, {"size": 0, "track_total_hits": True,
                             "aggs": {"m": {"terms": {"field": "main_track"}}, "doi": {"cardinality": {"field": "doi", "precision_threshold": 40000}},
                                      "dups": {"terms": {"field": "doi", "min_doc_count": 2}}}})
    by = {b["key_as_string"]: b["doc_count"] for b in r["aggregations"]["m"]["buckets"]}
    assert by["true"] == 3028
    assert r["aggregations"]["doi"]["value"] == r["hits"]["total"]["value"]  # one doc per DOI
    assert r["aggregations"]["dups"]["buckets"] == []
    # Every paper carries embeddings (a bulk upsert body silently skips inference on ES 9.5).
    assert es.request("POST", f"/{M.PAPERS}/_count", {"query": {"exists": {"field": "research_text"}}})["count"] == r["hits"]["total"]["value"]
    hit = es.search(M.PAPERS, {"size": 1, "_source": False, "query": {"semantic": {"field": "research_text",
                    "query": "consistency flow matching 3D robot manipulation policy"}}})["hits"]["hits"]
    assert hit and hit[0]["_id"] == FLOWPOLICY


# 8. Repeated imports do not duplicate papers or occurrences.
@live
def test_live_runs_do_not_touch_committed_reports(es):
    committed = (ROOT / "reports" / "paper_coverage.json").read_bytes()
    r = _run("scripts/import_conference_papers.py", "--conference", "AAAI-25", "--limit", "3")
    assert r.returncode == 0, r.stderr[-2000:]
    assert (ROOT / "reports" / "paper_coverage.json").read_bytes() == committed
    assert (Path(_REPORT_DIR) / "paper_coverage.json").exists()


@live
def test_live_repeat_import_is_noop(es):
    before = es.request("GET", f"/{M.PAPERS}/_count")["count"]
    occ_before = es.search(M.PAPERS, {"size": 0, "aggs": {"o": {"sum": {"field": "occurrence_count"}}}})["aggregations"]["o"]["value"]
    r = _run("scripts/import_conference_papers.py", "--conference", "AAAI-25", "--limit", "0")
    assert r.returncode == 0, r.stderr[-2000:]
    assert "'skipped_unchanged': 3486" in r.stdout
    s = _run("scripts/import_schedules.py")
    assert s.returncode == 0, s.stderr[-2000:]
    write = s.stdout.split('"write"')[1].split("}")[0]
    assert '"updated"' not in write and '"skipped_unchanged": 2272' in write, write
    es.refresh(M.PAPERS)
    assert es.request("GET", f"/{M.PAPERS}/_count")["count"] == before
    assert es.search(M.PAPERS, {"size": 0, "aggs": {"o": {"sum": {"field": "occurrence_count"}}}})["aggregations"]["o"]["value"] == occ_before


# Schedule-owned tags survive a paper re-import; the stale hash forces the next join to rewrite.
@live
def test_live_reimport_keeps_schedule_tags(es):
    before = es.get(M.PAPERS, FLOWPOLICY)["_source"]
    assert before["official_topics"] and before["schedule_hash"]
    r = _run("scripts/import_conference_papers.py", "--conference", "AAAI-25", "--limit", "3", "--force")
    assert r.returncode == 0, r.stderr[-2000:]
    mid = es.get(M.PAPERS, FLOWPOLICY)["_source"]
    assert mid["tags"] == before["tags"] and mid["tag_provenance"] == before["tag_provenance"]
    assert mid["schedule_hash"] is None and mid["occurrences"] == before["occurrences"]
    s = _run("scripts/import_schedules.py")
    assert s.returncode == 0, s.stderr[-2000:]
    after = es.get(M.PAPERS, FLOWPOLICY)["_source"]
    assert after["schedule_hash"] == before["schedule_hash"] and after["tags"] == before["tags"]


# 3. Documents written earlier under another ID scheme receive classification updates in place.
@live
def test_live_existing_ids_receive_classification(es):
    scratch = "test-conference-papers-migration"
    if es.exists(scratch):
        es.request("DELETE", f"/{scratch}")
    es.request("PUT", f"/{scratch}", {"mappings": M.papers()})
    legacy = {"paper_id": "legacy-33617", "conference_id": "aaai-25", "doi": "10.1609/aaai.v39i14.33617",
              "title": "FlowPolicy (legacy create-only record)"}
    es.request("PUT", f"/{scratch}/_create/legacy-33617", legacy, params={"refresh": "true"})
    try:
        r = _run("scripts/import_conference_papers.py", "--conference", "AAAI-25", "--limit", "3", "--index", scratch)
        assert r.returncode == 0, r.stderr[-2000:]
        es.refresh(scratch)
        doc = es.get(scratch, "legacy-33617")["_source"]
        assert doc["main_track"] is True and doc["classification_status"] == "verified_by_proceedings"
        assert doc["issue"] == 14 and doc["paper_id"] == "legacy-33617"
        dupes = es.search(scratch, {"size": 5, "query": {"term": {"doi": "10.1609/aaai.v39i14.33617"}}})["hits"]["hits"]
        assert [h["_id"] for h in dupes] == ["legacy-33617"]
    finally:
        es.request("DELETE", f"/{scratch}")


# 7. Nested filters cannot combine one occurrence's room with another's time.
@live
def test_live_nested_occurrence_filter(es):
    room = {"term": {"occurrences.room": "Exhibit Hall E"}}
    oral_time = {"range": {"occurrences.starts_at": {"gte": "2025-03-01T09:00:00-05:00", "lte": "2025-03-01T10:00:00-05:00"}}}
    same = {"nested": {"path": "occurrences", "query": {"bool": {"filter": [room, oral_time]}}}}
    split = {"bool": {"filter": [{"nested": {"path": "occurrences", "query": room}},
                                 {"nested": {"path": "occurrences", "query": oral_time}}]}}
    ids = lambda q: {h["_id"] for h in es.search(M.PAPERS, {"size": 100, "_source": False,
                                                            "query": {"bool": {"filter": [q, {"ids": {"values": [FLOWPOLICY]}}]}}})["hits"]["hits"]}
    assert ids(split) == {FLOWPOLICY}  # cross-occurrence combination would match
    assert ids(same) == set()          # same-occurrence nested query correctly does not


# 17. Fixture IDs and source references resolve.
@live
def test_live_fixtures_resolve(es):
    r = _run("scripts/seed_social_fixtures.py")
    assert r.returncode == 0, r.stderr
    ev = es.get(M.EVENTS, "aaai-25-replay")["_source"]
    assert ev["time_zone"] == "America/New_York" and ev["demo_clock"].endswith("-05:00")
    assert len(ev["topic_vocabulary"]) == 20
    assert all(s["retrieved_at"] for s in ev["source_references"]), ev["source_references"]
    people = es.search(M.PEOPLE, {"size": 50, "query": {"term": {"event_id": "aaai-25-replay"}}})["hits"]["hits"]
    assert len(people) == 12 and all(h["_source"]["is_fictional"] for h in people)
    assert not any(e["kind"] == "verified_authorship" for h in people for e in h["_source"]["evidence"])
    groups = es.search(M.GROUPS, {"size": 10, "query": {"term": {"event_id": "aaai-25-replay"}}})["hits"]["hits"]
    assert len(groups) == 3 and all(g["_source"]["is_fictional"] for g in groups)
