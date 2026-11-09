#!/usr/bin/env python3
"""Seed the event document and the FICTIONAL social fixtures.

    python3 scripts/seed_social_fixtures.py                     # upsert event, people, groups, actions
    python3 scripts/seed_social_fixtures.py --reset-demo-actions  # also delete actions BY the two demo
                                                                # identities (riley, jules) so the
                                                                # reciprocal demo can be rehearsed again

Every reference must resolve: paper IDs and occurrence IDs against the papers
index, meeting points against fixtures/event.json, hosts/targets against the
profile fixtures. A failed reference aborts before anything is written.
Requires papers + schedules to be imported first.
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from confdata import mappings as M  # noqa: E402
from confdata.es import ES, split_bulk_failures  # noqa: E402
from confdata.ids import EVENT_ID, action_id, occurrence_id  # noqa: E402
from confdata.tags import validate_tags  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
FIX = ROOT / "fixtures"
STAGE_BAND = {"undergrad": "undergrad", "masters": "grad", "phd": "grad", "postdoc": "early_career",
              "industry_engineer": "early_career", "industry_data_scientist": "early_career",
              "faculty": "senior", "senior_industry": "senior"}


def pid(slug: str) -> str:
    return f"{EVENT_ID}.{slug}"


def gid(slug: str) -> str:
    return f"{EVENT_ID}.g.{slug}"


def expertise_text(p: dict, evidence: list[dict]) -> str:
    """Same recipe as app/lib/profiles.js. Excludes asks, links, actions and drafts."""
    parts = [p["display_name"] + "."]
    if p.get("offers"):
        parts.append("Can help with: " + "; ".join(p["offers"]) + ".")
    if p.get("research_interests"):
        parts.append("Research interests: " + "; ".join(p["research_interests"]) + ".")
    if p.get("bio"):
        parts.append(p["bio"])
    titles = [e["title"] for e in evidence if e.get("title")]
    if titles:
        parts.append("Projects and papers of interest: " + "; ".join(titles) + ".")
    return " ".join(parts)


class RefError(Exception):
    pass


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--reset-demo-actions", action="store_true")
    args = ap.parse_args()
    es = ES()
    now = datetime.now(timezone.utc).isoformat()
    event = json.loads((FIX / "event.json").read_text("utf-8"))
    people = json.loads((FIX / "people.json").read_text("utf-8"))
    groups = json.loads((FIX / "groups.json").read_text("utf-8"))["groups"]
    actions = json.loads((FIX / "actions.json").read_text("utf-8"))["actions"]
    manifest = json.loads((ROOT / "data" / "raw" / "manifest.json").read_text("utf-8"))
    points = {m["point_id"]: m for m in event["meeting_points"]}
    slugs = {p["slug"] for p in people["profiles"]}
    errors: list[str] = []

    if len(people["profiles"]) != 12:
        errors.append(f"expected exactly 12 fictional attendees, found {len(people['profiles'])}")
    if len(groups) != 3:
        errors.append(f"expected exactly 3 groups, found {len(groups)}")

    # ---- resolve referenced papers
    paper_ids = sorted({e["paper_id"] for p in people["profiles"] for e in p["evidence"] if e.get("paper_id")} |
                       {a["target_id"] for a in actions if a["target_type"] == "paper"})
    papers = {d["_id"]: d["_source"] for d in es.mget(M.PAPERS, paper_ids,
              source=["paper_id", "title", "paper_url", "tags", "main_track", "occurrences"])["docs"] if d.get("found")}
    for p_id in paper_ids:
        if p_id not in papers:
            errors.append(f"paper {p_id} not in {M.PAPERS}")
        elif not papers[p_id]["main_track"]:
            errors.append(f"paper {p_id} is not main_track")

    # ---- event document
    src_refs = []
    for r in event["source_references"]:
        r = dict(r)
        k = r.pop("manifest_key", None)
        if k not in manifest:
            errors.append(f"source reference {r['ref_id']}: {k} not in data/raw/manifest.json")
        src_refs.append({**r, "retrieved_at": manifest.get(k, {}).get("retrieved_at")})
    event_doc = {k: event[k] for k in ("event_id", "conference_id", "display_name", "replay_mode", "demo_clock", "time_zone")}
    event_doc.update(topic_vocabulary=event["topic_vocabulary"], meeting_points=event["meeting_points"],
                     source_references=src_refs, updated_at=now)

    # ---- buddy projections (only explicit buddy actions)
    buddies: dict[str, list[dict]] = {}
    action_docs = []
    for a in actions:
        if a["actor"] not in slugs:
            errors.append(f"action actor {a['actor']} unknown")
            continue
        tt, tid = a["target_type"], a["target_id"]
        if tt == "person":
            if tid not in slugs:
                errors.append(f"action target person {tid} unknown")
                continue
            tid = pid(tid)
        elif tt == "group":
            if tid not in {g["slug"] for g in groups}:
                errors.append(f"action target group {tid} unknown")
                continue
            tid = gid(tid)
        doc = {"action_id": action_id(EVENT_ID, pid(a["actor"]), a["kind"], tt, tid), "event_id": EVENT_ID,
               "actor_profile_id": pid(a["actor"]), "action_kind": a["kind"], "target_type": tt, "target_id": tid,
               "active": True, "effective_at": now, "revision": 1, "updated_at": now}
        if a["kind"] == "swipe":
            doc["direction"] = a["direction"]
            if tt == "paper":
                doc["target_tags"] = papers.get(tid, {}).get("tags", [])
            elif tt == "person":
                doc["target_tags"] = next(p["tags"] for p in people["profiles"] if pid(p["slug"]) == tid)
        if a["kind"] == "buddy":
            o = a["occurrence"]
            oid = occurrence_id(tid, o["format"], o["starts_at"], o["ends_at"])
            occ = next((x for x in papers.get(tid, {}).get("occurrences", []) if x["occurrence_id"] == oid), None)
            if not occ:
                errors.append(f"buddy occurrence {oid} not found on {tid}")
            elif occ["verification_status"] != "verified":
                errors.append(f"buddy occurrence {oid} on {tid} is {occ['verification_status']}, not verified")
            doc.update(context_paper_id=tid, context_occurrence_id=oid)
            buddies.setdefault(pid(a["actor"]), []).append({"paper_id": tid, "occurrence_id": oid, "shared_at": now})
        action_docs.append(doc)

    # ---- profiles
    profile_docs = []
    for p in people["profiles"]:
        try:
            validate_tags(p["tags"])
        except ValueError as e:
            errors.append(f"{p['slug']}: {e}")
        if p["stage"] not in STAGE_BAND:
            errors.append(f"{p['slug']}: unknown stage {p['stage']}")
        mp = p.get("meeting_point_id")
        if mp and mp not in points:
            errors.append(f"{p['slug']}: meeting point {mp} not sourced")
        ev = []
        for i, e in enumerate(p["evidence"], 1):
            e2 = {"evidence_id": f"{pid(p['slug'])}.ev{i}", "kind": e["kind"], "paper_id": e.get("paper_id"),
                  "title": e.get("title"), "url": e.get("url"), "note": e.get("note"),
                  "verified": e["kind"] in ("verified_authorship", "participant_confirmed_link")}
            if e["kind"] == "verified_authorship":
                errors.append(f"{p['slug']}: fictional attendees cannot hold verified_authorship evidence")
            if e.get("paper_id") and e["paper_id"] in papers:
                e2["title"] = papers[e["paper_id"]]["title"]
                e2["url"] = papers[e["paper_id"]]["paper_url"]
            ev.append(e2)
        doc = {"profile_id": pid(p["slug"]), "event_id": EVENT_ID, "display_name": p["display_name"], "is_fictional": True,
               "discovery_opt_in": p["discovery_opt_in"], "opted_in_at": now if p["discovery_opt_in"] else None,
               "availability_status": p["availability_status"], "intent": p["intent"],
               "stage": p["stage"], "stage_band": STAGE_BAND.get(p["stage"]), "stage_label": p["stage_label"],
               "conversation_preference": p["conversation_preference"], "peers_only": p["peers_only"],
               "offers": p["offers"], "asks": p["asks"], "research_interests": p["research_interests"],
               "tags": p["tags"], "bio": p["bio"], "affiliation_label": "Fictional demo attendee",
               "evidence": ev, "shared_poster_interests": buddies.get(pid(p["slug"]), []),
               "available_windows": p["available_windows"],
               "meeting_point": {k: points[mp][k] for k in ("point_id", "label", "source_url")} if mp in points else None,
               "public_links": p["public_links"], "updated_at": now}
        doc["expertise_text"] = expertise_text(p, ev)
        profile_docs.append(doc)

    # ---- groups
    group_docs = []
    for g in groups:
        if g["host"] not in slugs:
            errors.append(f"group {g['slug']}: host {g['host']} unknown")
        mp = g.get("meeting_point_id")
        if mp and mp not in points:
            errors.append(f"group {g['slug']}: meeting point {mp} not sourced")
        try:
            validate_tags(g["tags"])
        except ValueError as e:
            errors.append(f"group {g['slug']}: {e}")
        about = (f"{g['title']}. Topic: {g['topic']}. {g['description']} Conversation style: "
                 f"{g['conversation_style'].replace('_', ' ')}. Intended audience: {g['intended_audience']}.")
        group_docs.append({"group_id": gid(g["slug"]), "event_id": EVENT_ID, "host_profile_id": pid(g["host"]),
                           "is_fictional": True, "title": g["title"], "description": g["description"], "topic": g["topic"],
                           "tags": g["tags"], "conversation_style": g["conversation_style"],
                           "intended_audience": g["intended_audience"], "audience_specified": g["audience_specified"],
                           "stage_restrictions": g["stage_restrictions"], "starts_at": g["starts_at"], "ends_at": g["ends_at"],
                           "time_zone": event["time_zone"],
                           "meeting_point": {k: points[mp][k] for k in ("point_id", "label", "source_url")} if mp in points else None,
                           "location_status": "public_point_confirmed" if mp in points else "unconfirmed",
                           "status": "scheduled", "capacity": g.get("capacity"),
                           "source_type": "demo_fixture", "source_url": None, "about": about, "updated_at": now})

    if errors:
        print("Fixture references failed to resolve; nothing written:\n  " + "\n  ".join(errors), file=sys.stderr)
        return 2

    if args.reset_demo_actions:
        demo = list(people["demo_sessions"][k] for k in ("riley", "jules"))
        r = es.request("POST", f"/{M.ACTIONS}/_delete_by_query", {"query": {"bool": {"filter": [
            {"term": {"event_id": EVENT_ID}}, {"terms": {"actor_profile_id": demo}}]}}}, params={"refresh": "true"})
        print(f"reset demo actions: deleted {r.get('deleted')} actions by {demo}")

    lines = []
    def up(index, _id, doc):
        lines.extend([{"update": {"_index": index, "_id": _id}},
                      {"doc": doc, "upsert": {**doc, "created_at": now}}])
    up(M.EVENTS, EVENT_ID, event_doc)
    for d in profile_docs:
        up(M.PEOPLE, d["profile_id"], d)
    for d in group_docs:
        up(M.GROUPS, d["group_id"], d)
    for d in action_docs:
        # Seeded actions are created once; re-seeding never advances their recency.
        lines.extend([{"create": {"_index": M.ACTIONS, "_id": d["action_id"]}}, {**d, "created_at": now}])
    resp = es.bulk(lines, refresh="wait_for")
    retry, perm = split_bulk_failures(resp)
    perm = [f for f in perm if f["status"] != 409]   # 409 = seeded action already exists
    counts = {}
    for it in resp["items"]:
        op, body = next(iter(it.items()))
        counts[f"{body['_index']}:{body.get('result', body.get('status'))}"] = counts.get(f"{body['_index']}:{body.get('result', body.get('status'))}", 0) + 1
    print(json.dumps(counts, indent=1))
    if retry or perm:
        print(json.dumps({"retryable": retry, "permanent": perm}, indent=1), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
