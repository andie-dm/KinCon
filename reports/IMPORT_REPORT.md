# AAAI-25 import report

Run 2026-11-09 against two clusters, with identical results:

- **Hosted Elastic Cloud** (GCP us-central1): Elasticsearch 9.5.6, Enterprise license, inference endpoint `.elser-2-elastic` (Elastic Inference Service, billed per token; `.elser-2-elasticsearch` cannot start because the deployment has no ML nodes).
- **Local** single-node Elasticsearch 9.1.0 (Docker, trial license, `.multilingual-e5-small-elasticsearch`), used during development.

Machine-readable details: `paper_coverage.json`, `schedule_coverage.json`.

**Hosted incident (fixed).** The first hosted import stored all 3,486 papers without embeddings, so semantic retrieval on papers returned nothing while the keyword branch of RRF still answered. Cause: on ES 9.5, a bulk `update` that *creates* a document from a separate `upsert` body skips `semantic_text` inference (verified on a scratch index; `index`, `create` and `doc_as_upsert` all embed). The importer and seeder now write new documents with `create` and existing ones with a partial `doc` update. A forced re-import re-embedded every paper and kept the schedule occurrences: `exists research_text` = 3,486/3,486, and 30/30 sampled papers are semantically retrievable by their own title. `test_live_index_counts` now fails if any paper lacks embeddings.

## Bibliographic coverage

| Measure | Value | Evidence |
|---|---|---|
| Source collection (HF `ai-conferences/AAAI2025`, rev `d00f1b70`) | **3,028** records | All labelled `track=main`, vol 39, issues 1-25. Labels not trusted on their own |
| Proceedings entries, vol 39 (OJS TOCs, issues 1-28) | 3,486 | `data/raw/ojs/*.html` |
| **Authoritative main-track count** (issues 1-25) | **3,028** | Per-issue counts identical to the dataset's (e.g. no. 1 = 139, no. 14 = 83, no. 28 = 247) |
| Dataset records matched to a main-track TOC entry by OJS article id | 3,028 / 3,028 | DOI issue = dataset issue = TOC issue for every record |
| Main-track papers backfilled from proceedings | 0 | Nothing missing |
| Other-program entries (issues 26-28) indexed with `main_track=false` | 458 | Titles and authors only, no abstracts |
| **Verified imported main-track count** (query on the index) | **3,028** | `main_track=true` count in `conference-papers-2025-v1` |
| Missing main-track DOIs in the index | 0 | Normalized DOI set compared with authoritative set |
| Ambiguous classifications | 0 | |
| Duplicate DOIs | 0 | Exact check: 3,486 unique DOIs over 3,486 docs, no `terms` bucket with ≥ 2 |
| Author lists differing from the TOC | 0 | Normalized name sequence compared per paper |
| Bulk failures | 0 permanent, 0 retryable | |

Import runs: the smoke run (`--limit 100`, 43 s) created 100 docs. The full run (`--limit 0`) created 3,386 and skipped the 100 unchanged ones. A repeat full run skipped all **3,486** as unchanged, and the document count stayed the same.

## Schedule coverage (separate from bibliographic coverage)

| Source (official) | Rows | Matched | Exact | Prefix | Fuzzy | Ambiguous (not stored) | Unmatched |
|---|---|---|---|---|---|---|---|
| Main Track Oral Talks 2.22 | 600 | 583 | 255 | 323 | 5 | 4 | 13 |
| Saturday Poster Schedule 2.27.25 | 666 | 652 | 634 | 2 | 16 | 5 | 9 |
| Main Track Poster Schedule 2.21 | 1,939 | 1,904 | 1,840 | 7 | 57 | 16 | 19 |
| Saturday Poster Schedule 2025-01-22 (superseded; comparison only) | 1,009 | 1,008 | 1,006 | 0 | 2 | 0 | 1 |

Every accepted match also passed author confirmation. Ambiguous rows are mostly titles that changed between schedule and proceedings, e.g. schedule "LLM-Powered *Efficient* User Simulator for Recommender…" vs published "LLM-Powered User Simulator for Recommender System". Unmatched rows are mostly oral titles truncated below the 25-character prefix minimum, or containing LaTeX.

| Occurrences stored | Count |
|---|---|
| Poster, `verified` (time + Exhibit Hall E venue from official sources) | 1,909 |
| Oral, `time_verified_room_unconfirmed` (the oral schedule publishes no rooms) | 583 |
| Poster, `unverified_superseded_source_only` | 361 |

- Main-track papers with ≥1 occurrence: **2,264 / 3,028**. With a verified time: **1,905**. With more than one appearance: **581**.
- 764 main-track papers have no schedule occurrence and show "Time or room unconfirmed".
- 8 other-program papers matched the all-tracks Saturday file.

## Demo papers

| Paper | Result |
|---|---|
| *FlowPolicy* (`doi_10.1609_aaai.v39i14.33617`, issue 14) | **Verified.** Poster Sat Mar 1, 12:30-2:30 pm ET, Exhibit Hall E (200 Level, West Building), board 746. Listed in the 2.27, 2.21 and 01-22 schedules, venue confirmed by the poster-sessions page. Also a separate oral occurrence: Sat Mar 1, 9:30-10:45 am, "Robotics" session, room not published |
| *Self-Correcting Robot Manipulation via Gaussian-Splatted Foresight* (`doi_10.1609_aaai.v39i25.34866`, issue 25) | **Not verified. Discrepancy with PLAN.md.** Listed for the Mar 1 12:30-2:30 block only in the superseded 2025-01-22 Saturday file. It is absent from the 2.21 main-track poster schedule, the 2.27 Saturday schedule and the oral schedule. Stored as `unverified_superseded_source_only`, room null, location "unconfirmed" |

The 12:30-2:30 pm Exhibit Hall E block itself is confirmed by the official poster-sessions page (Thu Feb 27 - Sat Mar 1). The fictional demo's poster-buddy fixtures use FlowPolicy and *Topology-Aware 3D Gaussian Splatting* (`doi_10.1609_aaai.v39i7.32732`), both verified Saturday posters.

## Unresolved source discrepancies

1. The schedule PDF linked from the brief (2025-01-22, Saturday-only) is superseded by the 2.23 and 2.27.25 versions linked from the official pages. Using the 2.27.25 file as authoritative for Saturday:
   - **361** papers are listed only in the 01-22 file. These are flagged, not verified.
   - **20** papers were rescheduled to another day. The stale slot is not stored.
2. The newer Thursday/Friday all-tracks poster files (2.26/2.27) were **not** fetched (crawl-delay courtesy). Thu/Fri main-track posters rely on the 2.21 main-track file.
3. The oral schedule publishes no rooms, so all 583 oral occurrences have `room: null`.
4. The schedules' "Paper ID" is a submission number absent from every metadata source, so it cannot serve as a join key. It is retained as `schedule_submission_id`.
5. The HF dataset card declares no license. Raw files are cached locally (git-ignored), and the records keep source URLs and attribution.

## Live checks run (all passing on both clusters)

- `python -m pytest tests`: **28 passed** against hosted Elastic Cloud and against local ES. Covers classification boundary and conflicts, DOI normalization, fallback IDs, every author surviving, unmerged equal names, distinct multiple appearances, the nested same-occurrence filter, repeat-import no-op, legacy-ID classification migration on a scratch index, fixture resolution, and unconfirmed locations.
- `node --test test/`: **13 passed** (6 ranking units, 7 live API scenarios through the real HTTP server). Covers RRF engine provenance and main-track-only feeds, a swipe retry being a `noop` with unchanged affinity, a pass staying excluded after reload, a changed swipe being revision 2, a save not enabling buddy visibility, a one-sided like staying private, reciprocity unlocking only Riley and Jules, a nonparticipant author never appearing, a save not joining, and the actor being session-derived.

## Remaining

- Hosted data is loaded and verified. To deploy the app against it, create Secret `app-credentials` (keys `elasticsearch-url`, `elasticsearch-api-key`, optionally `demo-session-tokens` as `riley=<token>,jules=<token>`) through Radar's resource editor and restart the app. The importer used `ES_INFERENCE_ID=.elser-2-elastic`.
- The API key used for the import was shared in a chat transcript; rotate it and put the new key in the Secret.
