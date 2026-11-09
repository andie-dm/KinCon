# Data, search and social-action layer

What is real and what is not:

| Data | Status | Source |
|---|---|---|
| Papers: titles, abstracts, every credited author in byline order, DOIs, URLs | **Real.** 3,028 main-track papers, verified one by one against the official proceedings tables of contents | [ai-conferences/AAAI2025](https://huggingface.co/datasets/ai-conferences/AAAI2025) (rev `d00f1b70`), [AAAI-25 proceedings](https://aaai.org/proceeding/aaai-39-2025/), [OJS issues 1-28](https://ojs.aaai.org/index.php/AAAI/issue/archive) |
| Other AAAI-25 programs (issues 26-28) | Real titles and authors, no abstracts. Indexed with `main_track=false` and never shown in Research feeds | OJS tables of contents |
| Oral and poster times, poster venue | **Real, published schedules.** Each occurrence carries its own `verification_status` | [Main-track schedules page](https://aaai.org/conference/aaai/aaai-25/main-technical-track/), [poster venue/hours](https://aaai.org/conference/aaai/aaai-25/poster-sessions/) |
| 12 attendees, 3 meetups, their likes/joins | **Fictional demo fixtures** (`is_fictional: true`). No real person is credited, contacted or opted in | `fixtures/*.json` |

A schedule listing says where a paper is scheduled. It never claims that a named author will be there.

## Setup

```bash
pip install -r requirements.txt
export ELASTICSEARCH_URL=...        # e.g. http://localhost:9200 or your Elastic Cloud endpoint
export ELASTICSEARCH_API_KEY=...    # omit for an unsecured local node (ELASTIC_API_KEY also accepted)
export ES_INFERENCE_ID=.elser-2-elastic   # hosted (EIS); local default is .multilingual-e5-small-elasticsearch

python3 scripts/fetch_sources.py            # cache sources in data/raw (git-ignored), write manifest.json
python3 scripts/setup_indexes.py --preflight  # version, license, inference endpoint probe
python3 scripts/setup_indexes.py            # create missing indexes / add compatible fields (never deletes)
python3 scripts/import_conference_papers.py --conference AAAI-25 --limit 100   # smoke (always includes the 2 demo papers)
python3 scripts/import_conference_papers.py --conference AAAI-25 --limit 0     # full import (~25 min on CPU E5)
python3 scripts/import_schedules.py         # join oral + poster schedules (~2 min of PDF parsing)
python3 scripts/seed_social_fixtures.py     # event doc + fictional people/groups/actions
python3 -m pytest tests                     # unit tests; live tests run when ELASTICSEARCH_URL is set
(cd app && node --test test/)               # ranking unit tests + live API tests
```

To rehearse the request-and-chat demo again, run `python3 scripts/seed_social_fixtures.py --reset-demo-actions`. It deletes only the actions of the two fictional demo identities (Riley, Jules) and restores their profiles from the fixtures.

**Local Elasticsearch used for this build:** a single-node `docker.elastic.co/elasticsearch/elasticsearch:9.1.0` container with a self-generated **trial** license (`semantic_text`, the RRF retriever and ML inference all need one) and security disabled, bound to 127.0.0.1:9200:

```bash
docker run -d --name aaai-es -p 127.0.0.1:9200:9200 -e discovery.type=single-node -e xpack.security.enabled=false -e xpack.license.self_generated.type=trial -e "ES_JAVA_OPTS=-Xms2g -Xmx2g" -m 6g -v aaai-es-data:/usr/share/elasticsearch/data docker.elastic.co/elasticsearch/elasticsearch:9.1.0
```

For a hosted deployment, set `ELASTICSEARCH_URL` and `ELASTICSEARCH_API_KEY` and rerun the same commands. In the cluster, the app reads both from the Secret `app-credentials` (keys `elasticsearch-url`, `elasticsearch-api-key`, optionally `demo-session-tokens` as `riley=<token>,jules=<token>`). Create that Secret through Radar's resource editor, never in git.

### Source access

aaai.org's robots.txt sets `Crawl-delay: 43200`. `fetch_sources.py` therefore fetches each aaai.org file **once** and never refetches a cached copy. ojs.aaai.org (no crawl delay; `/cache/` disallowed) is fetched with a 2 s pause between requests. `data/raw/manifest.json` records URL, retrieval time, status and SHA-256 for every file. The Hugging Face dataset card declares no license, so raw downloads are kept out of git and only referenced.

## Identity

| ID | Scope | Formula |
|---|---|---|
| `conference_id` | bibliographic venue | `aaai-25` (owns papers) |
| `event_id` | social replay | `aaai-25-replay` (owns profiles, groups, actions) |
| `paper_id` | paper | `doi_` + normalized DOI with `/` → `_`, e.g. `doi_10.1609_aaai.v39i14.33617`. If there's no DOI: `ojs_aaai_{article}`. If neither: `title_{sha1(norm title\|norm first author)[:16]}` with `-2`, `-3`… on collision. `id_basis` records which was used |
| `doi` | lookup | lower-cased, `https://doi.org/`, `dx.doi.org`, `doi:` and trailing punctuation stripped |
| `occurrence_id` | one appearance | `occ_` + sha1(`paper_id\|format\|starts_at\|ends_at`)[:16]. The same slot listed in several schedule versions is one occurrence with several `source_urls` |
| `profile_id` / `group_id` | event | `aaai-25-replay.{slug}` / `aaai-25-replay.g.{slug}` |
| `action_id` | event action | `act_` + sha256(`event\|actor\|kind\|target_type\|target_id`)[:32]. Same formula in `scripts/confdata/ids.py` and `app/lib/config.js` |

**ID preservation.** Before writing, the importer looks up each DOI in the index. If a document already exists for that DOI under another ID (for example from an earlier importer), it updates that document in place and keeps its ID. It never creates a second document for the same DOI.

**Authors.** Every credited author is kept with `position` (1-based byline order). No source provides a reliable author identifier, so `author_id` is null and `identity_status` is `unresolved_name_only`. Equal names are never merged, and authors never become People profiles.

## Main-track classification

`--conference AAAI-25` selects the venue only. Each record is classified **before** indexing from the OJS tables of contents: `main_track = (volume == 39 and 1 <= issue <= 25)`, using the issue the *proceedings* list for that OJS article id. When the dataset's issue disagrees, the proceedings win (`classification_status: resolved_conflict_by_proceedings`). A record missing from the proceedings is never assumed main-track (`unverified_not_in_proceedings`). Proceedings entries missing from the dataset are backfilled from the TOC (`backfilled_from_proceedings`).

Reruns are resumable and safe. Writes are bulk `update` + `doc_as_upsert` by stable ID, and a record whose `content_hash` matches the indexed one is skipped. A document written by an older create-only importer has no matching hash, so it gets the classification fields on the next run (tested in `test_live_existing_ids_receive_classification`). Bulk item failures are split into retryable (408/429/5xx: retried 3× with backoff) and permanent (validation, e.g. `strict_dynamic_mapping_exception`). Both are listed in the report, and the process exits non-zero.

## Indexes and migration

Mappings live in `scripts/confdata/mappings.py`, all with `dynamic: strict`. `setup_indexes.py` creates missing indexes and adds new fields in place (`PUT _mapping`). A changed field type or `inference_id` is reported as **INCOMPATIBLE** along with a reindex plan (new `-v2` index → `_reindex` → verify counts → switch readers, keeping v1). The script stops there and never drops or recreates an index. Running that plan needs explicit approval.

| Index | Notes |
|---|---|
| `conference-papers-2025-v1` | `authors` and `occurrences` are `nested`. `research_text` (title + abstract) is `semantic_text`. `occurrences` are owned by `import_schedules.py` and the importer never touches them |
| `conference-people-v1` | `expertise_text` = name + offers + research interests + bio + evidence titles. It **excludes** asks, contact links, actions and drafts. `public_links` has `enabled: false` (not searchable) and appears only to connected pairs. `evidence.kind` ∈ `verified_authorship`, `participant_confirmed_link`, `public_contextual_reference`, `self_declared` (fixtures use only the last two) |
| `conference-groups-v1` | No membership array. Joins are actions. `about` = title, topic, purpose, conversation style, audience |
| `conference-actions-v1` | One document per (event, actor, kind, target). `opener` is stored with `index: false` |
| `conference-events-v1` | Demo clock `2025-03-01T12:00:00-05:00` (historical replay time), kept separate from real `created_at` / `updated_at` write times. Holds the 20-tag vocabulary, sourced meeting points and source references |

## Schedules

`import_schedules.py` parses four official PDFs. Their "Paper ID" column is a submission number that no metadata source carries, so the join uses **normalized title + author confirmation** (at least half of the listed surnames must appear in the paper's byline). The order is: exact title, then title prefix (the oral PDF truncates titles), then fuzzy (ratio ≥ 0.92 and unique by ≥ 0.04). Anything else is reported as ambiguous and **not stored**.

| `verification_status` | Meaning |
|---|---|
| `verified` | Poster slot in the newest official schedule covering that day, title+authors confirmed, inside the official 12:30-2:30 pm Exhibit Hall E hours |
| `time_verified_room_unconfirmed` | Oral slot from the 2.22 oral schedule, which publishes no rooms (`room: null`) |
| `unverified_superseded_source_only` | Listed only in the superseded 2025-01-22 Saturday file. `room: null`, `location_status: unconfirmed` |
| `conflict_*` | Newer and older official files disagree. Reported, never shown as verified |

Use one `nested` clause whenever conditions must hold for the same occurrence. `test_live_nested_occurrence_filter` shows that two separate nested clauses would wrongly match FlowPolicy for "Exhibit Hall E at 9:30 am" by combining its poster room with its oral time.

## Semantic search

Checked on the deployment (`setup_indexes.py --preflight`): Elasticsearch 9.1.0, trial license, preconfigured endpoints `.elser-2-elasticsearch`, `.multilingual-e5-small-elasticsearch` and `.rerank-v1-elasticsearch`. ELSER failed to deploy locally ("no ML nodes with sufficient capacity": the 6 GB container's default ML memory share is too small). E5-small deployed and is the default (`ES_INFERENCE_ID`). E5 runs on the node's own ML allocation, at no extra cost locally. On Elastic Cloud, ML node capacity is billed by size; check the deployment's ML autoscaling limits before switching to ELSER. Changing the inference id on an existing index is an incompatible mapping change (reindex).

Retrieval uses the `rrf` retriever (`rank_window_size` 50, `rank_constant` 60) over a `multi_match` branch and a `semantic` branch. **Both branches receive the identical eligibility filter.** Each request returns at most 30 candidates.

## Ranking

1. The RRF order is converted to a percentile: `1 - i/(n-1)`. A single candidate gets 1.
2. Topic affinity comes from the viewer's latest 20 distinct swipes (one document per target, ordered by `effective_at`): right +1, left −0.25 per tag, each clamped to [−2, +3].
3. `score = percentile + 0.12 × mean(affinity of the card's tags)`. A card with no tags, or only unseen tags, adds 0. Tags are the server-stored card tags, never client input.
4. Intent: *broaden* reserves every 4th slot for an adjacent card (shares ≥1 familiar tag and adds ≥1 new one). *Peers at my stage* is a soft preference (same `stage_band` first). *Peers only* is a hard filter in both directions.

## Social actions (`app/lib/service.js`)

| Behaviour | Implementation |
|---|---|
| Actor | Bearer token or `demo_session` HttpOnly cookie. With `DEMO_SESSION_TOKENS` set, only a configured token maps to Riley or Jules; without it (open demo mode) the cookie names one of the two fictional identities. Never read from the body or path |
| Swipe idempotency | Painless `_update`: same direction → `noop`, so `effective_at`, `revision` and the tag snapshot don't move. Affinity and recency count it once |
| Changed swipe | Direction flips: `revision+1`, `effective_at` advances, tag snapshot refreshed. A flip to left clears the private opener |
| Near-real-time | Action writes use `refresh=wait_for`, so an immediate reload sees the swipe. Reciprocity uses real-time `GET` of the reverse action's deterministic ID |
| Chat requests | **Interested on a person is a visible chat request** (team decision, replacing the earlier private-until-reciprocal like). The recipient sees the sender's public card in `GET /api/me/notifications` and answers with `PUT /api/requests/{senderId} {"decision":"accepted"\|"rejected"}`. The answer is a `respond` action with a deterministic ID; the first answer is final. Two people who are both interested are connected without an answer. A declined sender only sees `not_accepted`, never a reason. The private opener draft stays private |
| Chat | Only connected pairs can read or post (`GET`/`POST /api/chats/{profileId}/messages`); anyone else gets the same 403, so it never reveals whether a request exists. Messages live in `conference-messages-v1` (body `index: false`, never in a semantic field), one conversation per pair (`conv_` + sha256 of event + sorted ids). A `clientMessageId` makes a retried send a no-op. Writes use `refresh=wait_for`; the UI polls |
| Privacy | Responses are allowlisted card objects (`app/lib/cards.js`); contact links appear only to connected pairs |
| Saved / joined | Saved papers and groups = right swipes. Joined = `join` actions. Saving a group never joins it |
| Poster buddy | `PUT /api/papers/{id}/buddy` requires a prior save and a verified poster occurrence. It writes a `buddy` action and adds the paper to `shared_poster_interests`, which only this action populates. The People feed with `paperId` requires the viewer's own buddy opt-in, the same occurrence and an overlapping declared availability window (or none declared) |
| Eligibility | People: event, `discovery_opt_in`, `availability_status=available`, not self, not swiped. Groups: event, scheduled, not past the demo clock, not hosted by self, host stage restriction only when `audience_specified`. Research: `conference_id`, `main_track=true`, format/time/room in one nested clause, not swiped |

## API (see PLAN.md for the agreed contract)

`POST /api/demo/session {"identity":"riley"|"jules"}` · `GET/PUT /api/me` · `GET /api/feed?deck=research|people|groups[&paperId][&format=oral|poster][&from&to&room]` · `PUT /api/swipes/{paper|person|group}/{id} {"direction":"left|right"}` · `PUT /api/papers/{id}/buddy` · `PUT /api/groups/{id}/join` · `PUT /api/matches/{profileId}/opener` · `GET /api/me/saved` · `GET /api/me/notifications` · `PUT /api/requests/{senderId}` · `GET`/`POST /api/chats/{profileId}/messages` · `GET /api/event` · `GET /api/health` (Elasticsearch status; `/healthz` and `/readyz` stay local so an ES outage never takes the UI out of the Service)

## Example queries

Research deck, posters only (both RRF branches filtered):

```json
POST conference-papers-2025-v1/_search
{"size": 30, "retriever": {"rrf": {"rank_window_size": 50, "retrievers": [
  {"standard": {"query": {"bool": {"must": [{"multi_match": {"query": "flow matching; imitation learning", "fields": ["title^3","abstract","author_names","tags^2"]}}],
    "filter": [{"term": {"conference_id": "aaai-25"}}, {"term": {"main_track": true}},
               {"nested": {"path": "occurrences", "query": {"bool": {"filter": [{"term": {"occurrences.format": "poster"}}]}}}}],
    "must_not": [{"ids": {"values": ["<already swiped>"]}}]}}}},
  {"standard": {"query": {"bool": {"must": [{"semantic": {"field": "research_text", "query": "flow matching; imitation learning"}}],
    "filter": "<same filter>", "must_not": "<same>"}}}}]}}}
```

People deck in poster-buddy mode (same filter in both branches):

```json
"filter": [{"term": {"event_id": "aaai-25-replay"}}, {"term": {"discovery_opt_in": true}}, {"term": {"availability_status": "available"}},
  {"nested": {"path": "shared_poster_interests", "query": {"bool": {"filter": [
     {"term": {"shared_poster_interests.paper_id": "doi_10.1609_aaai.v39i14.33617"}},
     {"term": {"shared_poster_interests.occurrence_id": "occ_4e3ce7c082457798"}}]}}}}],
"must_not": [{"ids": {"values": ["aaai-25-replay.riley"]}}]
```

Groups deck: `{"term":{"event_id":"aaai-25-replay"}}`, `{"term":{"status":"scheduled"}}`, `{"range":{"ends_at":{"gte":"2025-03-01T12:00:00-05:00"}}}`, plus `audience_specified:false OR stage_restrictions:<viewer band>`, with `about` as the semantic field.

## If you use another engine

OpenSearch is **not** a drop-in replacement. It has no `semantic_text` type (you would need its neural plugin with an ingest pipeline and `knn_vector`), and no `rrf` retriever (its hybrid query uses a search pipeline with normalization processors, which is score normalization, not reciprocal rank fusion). Its `nested` filtering works, but Painless `ctx.op = 'noop'` and `refresh=wait_for` semantics must be re-verified. Neither engine is a transactional store: an action write is durable once acknowledged, but searches see it only after a refresh. That is why writes use `wait_for` and reciprocity reads use real-time GET.
