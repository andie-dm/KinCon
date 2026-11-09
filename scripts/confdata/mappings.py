"""Explicit index mappings. Versioned by index name suffix (-v1).

Changing a field's type is incompatible: create a -v2 index and reindex
(scripts/setup_indexes.py refuses to do that without --approve-reindex).
Adding a field is compatible and is applied in place with PUT _mapping.
"""
from __future__ import annotations

import os

PAPERS = "conference-papers-2025-v1"
PEOPLE = "conference-people-v1"
GROUPS = "conference-groups-v1"
ACTIONS = "conference-actions-v1"
EVENTS = "conference-events-v1"
MESSAGES = "conference-messages-v1"

DEFAULT_INFERENCE_ID = ".multilingual-e5-small-elasticsearch"


def inference_id() -> str:
    return os.environ.get("ES_INFERENCE_ID", DEFAULT_INFERENCE_ID)


KW = {"type": "keyword"}
DATE = {"type": "date"}
BOOL = {"type": "boolean"}
INT = {"type": "integer"}
TEXT_KW = {"type": "text", "fields": {"keyword": {"type": "keyword", "ignore_above": 512}}}
NOINDEX_TEXT = {"type": "text", "index": False}


def _sem() -> dict:
    return {"type": "semantic_text", "inference_id": inference_id()}


def _obj(props: dict, **kw) -> dict:
    return {"properties": props, **kw}


SOURCE_REF = _obj({"url": KW, "retrieved_at": DATE, "sha256": KW, "role": KW, "ref_id": KW})
MEETING_POINT = _obj({"point_id": KW, "label": TEXT_KW, "source_url": KW})


def papers() -> dict:
    return {"dynamic": "strict", "properties": {
        "paper_id": KW, "conference_id": KW, "doi": KW, "id_basis": KW,
        "source_record_id": KW, "ojs_article_id": KW, "arxiv_id": KW,
        "volume": INT, "issue": INT, "issue_label": KW, "pages": KW,
        "main_track": BOOL, "classification_status": KW, "classification_basis": KW,
        "title": TEXT_KW, "abstract": {"type": "text"},
        "paper_url": KW, "pdf_url": KW,
        "authors": {"type": "nested", "properties": {
            "name": TEXT_KW, "position": INT, "author_id": KW, "author_id_scheme": KW,
            "identity_status": KW}},
        "author_names": TEXT_KW,
        "author_count": INT,
        "tags": KW, "tag_provenance": KW, "official_topics": KW,
        "research_text": _sem(),
        "occurrences": {"type": "nested", "properties": {
            "occurrence_id": KW, "session_id": KW, "session_title": TEXT_KW,
            "format": KW, "starts_at": DATE, "ends_at": DATE, "time_zone": KW,
            "room": KW, "building": KW, "venue": KW, "board": KW,
            "location_status": KW, "time_status": KW,
            "schedule_submission_id": KW,
            "source_url": KW, "source_urls": KW,
            "match_method": KW, "match_score": {"type": "float"},
            "verification_status": KW, "verified_at": DATE}},
        "occurrence_count": INT,
        "schedule_status": KW, "schedule_hash": KW,
        "metadata_provenance": _obj({"dataset": KW, "dataset_revision": KW, "dataset_url": KW,
                                     "record_url": KW, "retrieved_at": DATE, "attribution": NOINDEX_TEXT,
                                     "proceedings_toc_url": KW, "proceedings_retrieved_at": DATE}),
        "schedule_provenance": {"type": "nested", "properties": SOURCE_REF["properties"]},
        "content_hash": KW,
        "ingested_at": DATE, "updated_at": DATE, "verified_at": DATE, "schedule_joined_at": DATE,
    }}


def people() -> dict:
    return {"dynamic": "strict", "properties": {
        "profile_id": KW, "event_id": KW, "display_name": TEXT_KW, "is_fictional": BOOL,
        "discovery_opt_in": BOOL, "opted_in_at": DATE,
        "availability_status": KW, "intent": KW,
        "stage": KW, "stage_band": KW, "stage_label": TEXT_KW,
        "conversation_preference": KW, "peers_only": BOOL,
        "offers": TEXT_KW, "asks": TEXT_KW, "research_interests": TEXT_KW,
        "tags": KW, "bio": {"type": "text"}, "affiliation_label": TEXT_KW,
        "evidence": {"type": "nested", "properties": {
            "evidence_id": KW, "kind": KW, "paper_id": KW, "title": TEXT_KW,
            "url": KW, "note": NOINDEX_TEXT, "verified": BOOL}},
        "shared_poster_interests": {"type": "nested", "properties": {
            "paper_id": KW, "occurrence_id": KW, "shared_at": DATE}},
        "available_windows": {"type": "nested", "properties": {"starts_at": DATE, "ends_at": DATE}},
        "meeting_point": MEETING_POINT,
        # Revealed only to reciprocal matches; never part of expertise_text.
        "public_links": _obj({"kind": KW, "label": KW, "url": KW}, enabled=False),
        "expertise_text": _sem(),
        "created_at": DATE, "updated_at": DATE,
    }}


def groups() -> dict:
    return {"dynamic": "strict", "properties": {
        "group_id": KW, "event_id": KW, "host_profile_id": KW, "is_fictional": BOOL,
        "title": TEXT_KW, "description": {"type": "text"}, "topic": TEXT_KW, "tags": KW,
        "conversation_style": KW, "intended_audience": TEXT_KW,
        "audience_specified": BOOL, "stage_restrictions": KW,
        "starts_at": DATE, "ends_at": DATE, "time_zone": KW,
        "meeting_point": MEETING_POINT, "location_status": KW,
        "status": KW, "capacity": INT,
        "source_type": KW, "source_url": KW,
        "about": _sem(),
        "created_at": DATE, "updated_at": DATE,
    }}


def actions() -> dict:
    return {"dynamic": "strict", "properties": {
        "action_id": KW, "event_id": KW, "actor_profile_id": KW,
        "action_kind": KW, "target_type": KW, "target_id": KW,
        "direction": KW, "active": BOOL,
        "effective_at": DATE,          # advances only when the logical state changes
        "revision": INT,
        "created_at": DATE, "updated_at": DATE,
        "context_paper_id": KW, "context_occurrence_id": KW,
        "target_tags": KW,             # server-derived snapshot at the effective write
        "opener": NOINDEX_TEXT,        # private draft: stored, not searchable
        "opener_edited_at": DATE,
        "response": KW,                # respond actions: accepted | rejected
    }}


def events() -> dict:
    return {"dynamic": "strict", "properties": {
        "event_id": KW, "conference_id": KW, "display_name": KW,
        "replay_mode": KW, "demo_clock": DATE, "time_zone": KW,
        "topic_vocabulary": {"type": "nested", "properties": {
            "tag": KW, "label": KW, "aliases": KW, "official_topics": KW}},
        "meeting_points": {"type": "nested", "properties": {
            "point_id": KW, "label": TEXT_KW, "description": NOINDEX_TEXT, "source_url": KW}},
        "source_references": {"type": "nested", "properties": {
            "ref_id": KW, "title": KW, "url": KW, "retrieved_at": DATE}},
        "created_at": DATE, "updated_at": DATE,
    }}


def messages() -> dict:
    # Private chat between two connected attendees. The body is stored, never
    # searchable, and never part of any semantic field.
    return {"dynamic": "strict", "properties": {
        "message_id": KW, "event_id": KW, "conversation_id": KW,
        "sender_profile_id": KW, "recipient_profile_id": KW,
        "body": NOINDEX_TEXT, "client_message_id": KW, "created_at": DATE,
    }}


ALL = {PAPERS: papers, PEOPLE: people, GROUPS: groups, ACTIONS: actions, EVENTS: events, MESSAGES: messages}
SETTINGS = {"number_of_shards": 1, "number_of_replicas": 0}
