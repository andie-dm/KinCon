# Conference networking by swipe

**What we’re building.** An attendee finds a poster they want to see, a peer they would feel comfortable approaching, and a small group they can actually walk up to. The demo should answer one question in under 90 seconds: *“I’m new here. Who would enjoy going to this poster with me, what could I say to them, and where could we meet?”*

**Build target.** Three developers, four hours to a rehearsable build. Use AAAI‑25 in Philadelphia as a historical replay. Use real main-track papers, credited authors and published sessions. Label the demo attendees and meetups as fictional. The public submission deadline is **5:30 p.m. Mountain on November 9**. Aim to submit by 5:10. [Hackathon schedule](https://www.wemakedevs.org/hackathons/cnh/schedule)

## Start here

| Owner | First 20 minutes | Owns through the demo |
|---|---|---|
| A · Data and search | Copy the existing paper importer into the repo. Identify a real poster session and seed enough records to search. | Main-track coverage, author evidence, schedule joins, Elastic retrieval and ranking. |
| B · Product and UI | Build one mobile card with a swipe gesture **and** visible Pass and Save buttons. Use the response fields below as fixtures. | Onboarding, three decks, saved items, mutual-match screen, intro draft and meetup detail. |
| C · Backend and deployment | Create the public repo from the Radar starter, install Gitar, deploy the starter, and agree on IDs and API shapes with A and B. | Demo sessions, swipe persistence, mutual matching, group joins, deployed app and submission evidence. |

Work in parallel. **First integration checkpoint, 45 minutes in:** open the deployed URL, select a demo profile, retrieve one real paper from Elastic, swipe it, reload, and see it in Saved. Then add People and Groups to the same flow.

## Product decisions

### Local UI implementation

**Stack: React + Vite + plain CSS, served by the starter Node process.** React
keeps the three decks, saved cards and dialogs composable; Vite provides fast
local development and produces static assets. Custom CSS supplies the visual
system without a component-library or animation dependency. No Next.js, separate
frontend service, external images, API keys or database is needed for this slice.
The production image builds the frontend once and keeps `$PORT`, `/healthz`,
`/readyz` and the existing starter API.

**Design:** warm paper background, ink typography, coral primary actions, mint
match accents and original vector illustrations. Desktop has a discovery rail,
one central card and a small conference-context panel. Mobile collapses to a
single-column deck and bottom navigation. Visible Pass/Save actions accompany
horizontal touch gestures and left/right arrow keys. Reduced-motion preferences,
dialog focus handling and labeled controls are part of the baseline.

**Local slice, in order:**
1. Establish tokens, navigation, responsive card layouts and a labeled AAAI-25
   replay clock.
2. Supply all three decks with fictional fixtures: research examples, 12 opted-in
   attendees (including one unavailable attendee) and three hosted meetups.
   These are not verified proceedings, live attendance or Elasticsearch results.
3. Add editable intent/offers/asks/conversation preferences, format filtering,
   persistent passes/saves, explicit poster-buddy sharing and separate group joins.
4. Support Alex/Jules demo identities, private one-sided likes, reciprocal matches
   and editable/copyable introduction drafts. Browser storage is only a local demo
   adapter, not an authentication, privacy or multi-user backend.
5. Check the interaction model with focused tests and desktop/mobile browser
   checks. Run with `npm --prefix app install` and `npm --prefix app run dev`.

**Integration boundary:** fixtures and demo-state functions stay outside visual
components. Replace that local adapter with the API contract below once the
backend lands; the server must own sessions, reciprocity, authorization, ranking
and idempotency. Live ranking, real bibliographic metadata, schedule verification
and cross-device persistence are deliberately not claimed by this prototype.
Build with `npm --prefix app run build`; `npm --prefix app start` serves the
production bundle and probes from the same port. Local-only work does not change
team configuration, commit, push or deploy.

**Onboarding takes three choices.** Pick an intent (*connect around a problem*, *meet like-minded people*, *broaden my research*, or *find a poster buddy*). Enter a few topics under **I can help with** and **I want to learn**. Choose a conversation preference such as **peers at my stage**, **open to mentoring**, or **any stage**. Let attendees self-describe their stage and what kind of conversation they welcome. An undergraduate can seek a fellow newcomer, and an experienced engineer can seek another specialist. Make research interests and conversation preferences independently editable.

| Deck | What the card shows | What a right swipe does |
|---|---|---|
| **Research** | Paper title, credited authors, one-line reason, source, and verified oral/poster times and places. Filters for All, Orals and Posters. A paper can have multiple scheduled appearances. | Saves the paper. **Find a poster buddy** opens People with this paper and session as context. |
| **People** | An opted-in attendee, self-described stage, what they offer and seek, and one specific reason to meet. Show the supporting project, paper or self-declared interest. | Privately expresses interest and prepares an editable opener. Reciprocal interest unlocks the match and contact action on both profiles. |
| **Groups** | A small, hosted meetup with a topic, conversation style, intended audience, time and public meeting point. | Saves the group. A separate **Join meetup** action confirms attendance and shows the meeting details in Saved. |

Left means **Pass** in every deck. Show one card at a time, the reason it appeared, and an empty state when eligible cards run out. Support keyboard and touch. Put an explicit **Open to a buddy for this poster** action on saved posters. Only that action makes the shared poster interest visible to another attendee.

## Data and Elasticsearch

1. **Cover the full AAAI‑25 main technical track.** Use the downloadable metadata for titles, abstracts, author lists, paper URLs and DOIs. The dataset has 3,028 records across its AAAI‑25 collection. The authoritative main-track boundary is volume 39, issues **1–25**. Issues 26–28 contain other programs. Compare the imported DOI set against the technical-track proceedings, backfill missing papers and report verified, missing and ambiguous counts. Let the full import run while the team demos a smaller verified session. [AAAI proceedings](https://aaai.org/proceeding/aaai-39-2025/) · [Dataset and schema](https://huggingface.co/datasets/ai-conferences/AAAI2025)
2. **Adapt the existing importer in the first data PR.** It already writes `conference-papers-2025-v1`, keeps the authors, and embeds the title and abstract in `research_text`. Its `--conference AAAI-25` flag selects the venue only. Add `volume`, numeric `issue`, and a `main_track` boolean; classify the raw rows before indexing. For existing documents, add mappings and bulk-update the classification by the current document ID. The current importer's create-only writes skip existing IDs on reruns. Filter every AAAI research feed by `main_track=true`.
3. **Attach the sessions separately.** Join the official oral and poster schedules by an identifier when both sources share it. Otherwise use normalized title plus author confirmation; flag ambiguous matches. Store each appearance with format, start, end, room, time zone and source URL. Missing schedule data can show **Time or room unconfirmed**. For the demo, verify *FlowPolicy* and *Self-Correcting Robot Manipulation via Gaussian-Splatted Foresight* in the March 1 poster block, **12:30–2:30 p.m., Exhibit Hall E, Philadelphia time**. Label the screen **AAAI‑25 replay** and use a fixed demo clock. [Main-track schedules](https://aaai.org/conference/aaai/aaai-25/main-technical-track/) · [Saturday program](https://aaai.org/wp-content/uploads/2025/01/AAAI-25-Poster-Schedule_2025-01-22_Saturday-Only.pdf) · [Venue and poster hours](https://aaai.org/conference/aaai/aaai-25/poster-sessions/)
4. **Use all authors as research evidence.** Associate every credited author with the semantic representation of their paper. Retain the byline and paper ID, so a search for a method can retrieve everyone credited on relevant papers. For an opted-in person, embed an expertise profile from their offers, bio and confirmed works. Use an author identifier or a participant-confirmed publication link to group works; a name collision stays unresolved. A People card requires an opted-in event profile; publication credit alone establishes authorship.
5. **Seed the social side.** Create 12 fictional attendees at several stages, including practitioners without publications, and three hosted groups. Include two newcomers with overlapping poster interests, two senior specialists, one cross-field match and one unavailable person. For real opt-in onboarding, accept a short bio, chosen public project or publication titles, and optional LinkedIn/Scholar links. A Scholar CSV export is a convenient input. For the public demo, use fictional profiles and public bibliographic evidence. [Scholar export instructions](https://scholar.google.com/intl/en-US/scholar/citations.html) · [Event data rules](https://www.wemakedevs.org/hackathons/cnh/rules)

After the main-track change, set `ELASTICSEARCH_URL` and `ELASTIC_API_KEY` on the backend or in the importing terminal. Use these commands for a smoke run and then the background import:

```bash
python3 scripts/import_conference_papers.py --conference AAAI-25 --limit 100
python3 scripts/import_conference_papers.py --conference AAAI-25 --limit 0
```

| Elasticsearch data | Minimum fields and use |
|---|---|
| Existing papers index | Stable paper ID, conference, main-track flag, title, authors, abstract, paper URL, canonical topic tags, `research_text: semantic_text`, and an array of session occurrences. Use a nested mapping if filtering time and room together. |
| `conference-people-v1` | Event-scoped ID, discovery opt-in, self-declared stage and conversation preferences, offers, asks, tags, evidence links, shared poster interests, optional available windows and chosen meeting point. Embed offers, research and project evidence in `expertise_text: semantic_text`. |
| `conference-groups-v1` | Event-scoped ID, host, topic, tags, audience, public meetup time/place and `about: semantic_text`. A host or demo fixture supplies each group. |
| `conference-actions-v1` | Event, actor, action, target type, target ID, timestamp. Use stable IDs for swipe, join and buddy actions so retries have one effect. Read another person's private like only on the backend to determine reciprocity. |

## Ranking that visibly learns

- **Retrieve.** Search the active deck only. Blend keyword and semantic search in Elasticsearch using reciprocal rank fusion. Apply event scope, discovery visibility, self-exclusion, selected format, and any explicit time or stage restrictions to both retrieval branches. Exclude cards already swiped by this viewer. Apply stage to People, and to Groups only when the host specifies an audience. Research cards use topic, format and session filters. Start with 30 candidates. [Elastic rank fusion](https://www.elastic.co/docs/reference/elasticsearch/rest-apis/reciprocal-rank-fusion)
- **Respect intent.** For *like-minded*, use shared interests and preferred conversation depth. For *connect around a problem*, match my ask against the other person's offer and give a small boost when my offer also matches their ask. For *broaden*, reserve one in four cards for an adjacent topic that shares at least one familiar concept. For *poster buddy*, prioritize explicitly shared poster interest and compatible availability. Prefer peers when requested and apply a strict stage filter only when the attendee chooses **peers only**.
- **Learn from both directions.** Start with about 20 shared tags. Use the official session topics when available, then match a small dictionary of method names and aliases against paper titles and abstracts. Give people and groups tags from that same list. Hand-check the demo cards. An implementable first pass adds 1 per right swipe and subtracts 0.25 per pass for the card's topic tags, capped from −2 to +3 per tag. Recompute from the viewer's latest 20 distinct swipes. Convert Elastic rank to a 0–1 rank percentile, then add 0.12 times the card's mean topic affinity. Treat these weights as demo defaults. A retry counts once. Refresh the upcoming cards after the swipe and preserve the card currently under the user's finger.
- **Explain each card.** Return a reason from actual inputs, such as *“You want to learn flow matching. This paper applies it to robot manipulation”* or *“You both opted into finding a buddy for this poster.”* A template is enough. An Elastic-hosted LLM can polish one sentence if time allows; the backend owns ranking, mutual interest, and location facts.

## Interaction and API contract

| Endpoint | Team agreement |
|---|---|
| `PUT /api/me` | Save onboarding choices for the current demo session. Provide two independent browser sessions or demo identities for the reciprocal-like test. |
| `GET /api/feed?deck=people&paperId=…` | Return cards with `id, type, title, subtitle, reason, tags, evidence[], occurrences[]`. People and Groups can additionally expose the meeting information the participant or host chose to share. |
| `PUT /api/swipes/{type}/{id}` | Accept `left` or `right`; derive the actor from the session. Persist once per viewer/card and return saved/matched state plus the refreshed feed. |
| `PUT /api/papers/{id}/buddy` · `PUT /api/groups/{id}/join` | Explicitly share interest in that poster or join that meetup. Repeated taps are idempotent. |
| `GET /api/me/saved` | Return saved research, groups, and reciprocal people matches. A match includes the editable draft, participant-provided contact link if available, and a sourced public meetup suggestion. |

**Message and location.** Generate a private draft as soon as someone likes a person. On a mutual match, offer **Edit**, **Copy intro**, and **Open LinkedIn/profile** where a link was supplied. The user chooses when to send. Example: *“Hey Jules, I’m also heading to the FlowPolicy poster. I’ve used imitation learning and would love to hear how you’ve approached flow matching. Want to check it out together?”* Show **Poster scheduled in Exhibit Hall E** for a paper, **Suggested meeting point** for a published session, or **Jules shared this meeting time** for an opt-in plan. Never turn a poster listing into a claim that a named author is physically there.

## Build clock and proof for the judges

| Elapsed | Deliverable |
|---|---|
| 0:00–0:45 | Public starter deployed, Gitar on the first PRs, fixture contract agreed, real paper swipe working end to end. Start the full import. |
| 0:45–2:00 | All three decks usable. Session joins for the demo posters, people and groups in Elastic, intent and stage controls wired. |
| 2:00–3:00 | Swipe learning changes upcoming cards. Two browsers can make a mutual match, copy an intro and save or join a group. |
| 3:00–4:00 | Verify data coverage and the demo clock. Rehearse on a phone, capture one Gitar review/fix and a real Radar investigation, and finish the README with setup, sources and AI-use disclosure. Submit ahead of the deadline. |

**Sponsor implementation.** Deploy the UI and API as one app using the Radar starter's `$PORT`, `/healthz` and `/readyz`. GitHub Actions builds the image; Argo CD deploys changes from `main`. Keep Elastic credentials in a Kubernetes Secret. Put a project-specific instruction in `.gitar/review/` to check opt-in, reciprocal likes, event scope and idempotent swipes. Show a real PR and its CI result. If Dash0 is already connected, trace `feed.search` and `swipe.write`, investigate a measured issue and retain the trace. Give the core social demo and Elastic retrieval first claim on engineering time. [Radar starter](https://github.com/skyhook-io/cnh-starter) · [Sponsor setup](https://www.wemakedevs.org/hackathons/cnh/resources) · [Judging criteria](https://www.wemakedevs.org/hackathons/cnh)

## Demo and acceptance

1. Start as a first-time grad attendee. Choose **peers at my stage**, robotics and **find a poster buddy**. Save a real poster and explicitly open buddy discovery.
2. Find Jules, a fictional grad attendee who shared interest in the same poster. Swipe right. Switch to Jules's browser and reciprocate. Return to the first browser, open the match, edit the intro and see the published poster venue.
3. Join a small hosted meetup. Switch to **broaden my research** and show an adjacent-field card with a concrete reason. In a repeatable fixture, two right swipes on a topic must move a previously lower-ranked eligible card up in the next feed.
4. Before submitting, verify that a passed card stays hidden after reload, a repeated swipe changes affinity once, a one-sided like stays private, a nonparticipant author has no People card, and a meetup with missing location says so. Confirm the deployed app returns actual Elastic results and that the README distinguishes verified corpus coverage, real scheduled sessions and fictional demo data.

**If time gets tight:** keep all three decks and the reciprocal-match demo. Use three seeded groups, one verified session and template-generated openers. Put live social-profile imports, automatic group formation and additional conferences after submission.
