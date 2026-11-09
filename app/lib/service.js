'use strict';
// Feed retrieval, idempotent social actions and derived saved/match state.
// The actor is always the session's profile id; it is never read from input.
const { EVENT_ID, CONFERENCE_ID, INDEX, DECK_TARGET, STAGE_BAND, actionId } = require('./config');
const { topicAffinity, rerank, reserveAdjacent } = require('./ranking');
const cards = require('./cards');

const CANDIDATES = 30;
const WINDOW = 50;

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function createService(es) {
  if (!es) throw new Error('ELASTICSEARCH_URL is not configured');
  let eventCache = null;

  async function event() {
    if (!eventCache) {
      const r = await es.get(INDEX.events, EVENT_ID);
      if (!r) throw new HttpError(503, 'event document missing; run scripts/seed_social_fixtures.py');
      eventCache = r._source;
    }
    return eventCache;
  }

  async function profile(profileId) {
    const r = await es.get(INDEX.people, profileId); // real-time GET
    if (!r) throw new HttpError(404, 'profile not found');
    return r._source;
  }

  async function mySwipes(actor, targetType) {
    const filter = [{ term: { event_id: EVENT_ID } }, { term: { actor_profile_id: actor } }, { term: { action_kind: 'swipe' } }];
    if (targetType) filter.push({ term: { target_type: targetType } });
    const r = await es.search(INDEX.actions, {
      size: 1000, query: { bool: { filter } }, sort: [{ effective_at: 'desc' }],
      _source: ['target_type', 'target_id', 'direction', 'effective_at', 'target_tags'],
    });
    return r.hits.hits.map((h) => h._source);
  }

  async function myActions(actor, kind) {
    const r = await es.search(INDEX.actions, {
      size: 1000,
      query: { bool: { filter: [{ term: { event_id: EVENT_ID } }, { term: { actor_profile_id: actor } }, { term: { action_kind: kind } }, { term: { active: true } }] } },
      sort: [{ effective_at: 'desc' }],
    });
    return r.hits.hits.map((h) => h._source);
  }

  // ------------------------------------------------------------------ retrieval
  // Both RRF branches receive the same eligibility filter, so an ineligible
  // document can never be fused in by either branch.
  async function hybrid(index, { text, keywordFields, semanticField, filter, mustNot }) {
    const bool = (must) => ({ bool: { must, filter, must_not: mustNot } });
    const body = {
      size: CANDIDATES,
      _source: { excludes: ['research_text', 'expertise_text', 'about', 'public_links'] },
      retriever: {
        rrf: {
          rank_window_size: WINDOW,
          rank_constant: 60,
          retrievers: [
            { standard: { query: bool([{ multi_match: { query: text, fields: keywordFields } }]) } },
            { standard: { query: bool([{ semantic: { field: semanticField, query: text } }]) } },
          ],
        },
      },
    };
    const r = await es.search(index, body);
    if (r.hits.hits.length || !text) return { hits: r.hits.hits, engine: 'elasticsearch_rrf' };
    // No lexical/semantic hit at all: fall back to the filtered set, still in ES.
    const f = await es.search(index, { size: CANDIDATES, query: bool([{ match_all: {} }]), _source: body._source });
    return { hits: f.hits.hits, engine: 'elasticsearch_filter_only' };
  }

  function tagLabels(ev, tags) {
    const map = Object.fromEntries(ev.topic_vocabulary.map((v) => [v.tag, v.label]));
    return tags.map((t) => map[t] || t);
  }

  async function feed(actor, { deck, paperId, format, from, to, room } = {}) {
    const targetType = DECK_TARGET[deck];
    if (!targetType) throw new HttpError(400, 'deck must be research, people or groups');
    const [ev, me, swipes, allSwipes] = await Promise.all([event(), profile(actor), mySwipes(actor, targetType), mySwipes(actor)]);
    const seen = swipes.map((s) => s.target_id);
    const aff = topicAffinity(allSwipes);
    const interests = [...(me.asks || []), ...(me.research_interests || [])].join('; ') || tagLabels(ev, me.tags || []).join('; ');
    let ranked;
    let engine;

    if (deck === 'research') {
      const filter = [{ term: { conference_id: CONFERENCE_ID } }, { term: { main_track: true } }];
      const occ = [];
      if (format === 'oral' || format === 'poster') occ.push({ term: { 'occurrences.format': format } });
      if (from || to) occ.push({ range: { 'occurrences.starts_at': { gte: from, lte: to } } });
      if (room) occ.push({ term: { 'occurrences.room': room } });
      // One nested clause: format, time and room must hold for the SAME occurrence.
      if (occ.length) filter.push({ nested: { path: 'occurrences', query: { bool: { filter: occ } } } });
      const r = await hybrid(INDEX.papers, {
        text: interests, keywordFields: ['title^3', 'abstract', 'author_names', 'tags^2'], semanticField: 'research_text',
        filter, mustNot: [{ ids: { values: seen } }],
      });
      engine = r.engine;
      ranked = rerank(r.hits.map((h) => ({ src: h._source, tags: h._source.tags || [] })), aff);
      if (me.intent === 'broaden_research') ranked = reserveAdjacent(ranked, me.tags);
      return {
        deck, engine, affinity: aff,
        cards: ranked.map((c) => cards.paperCard(c.src, paperReason(ev, me, c), c.rank)),
      };
    }

    if (deck === 'people') {
      const filter = [
        { term: { event_id: EVENT_ID } },
        { term: { discovery_opt_in: true } },
        { term: { availability_status: 'available' } },
      ];
      const mustNot = [{ ids: { values: [actor, ...seen] } }];
      // Explicit peers-only is a hard filter in both directions.
      if (me.peers_only) filter.push({ term: { stage_band: me.stage_band } });
      mustNot.push({ bool: { filter: [{ term: { peers_only: true } }], must_not: [{ term: { stage_band: me.stage_band } }] } });
      let text = [...(me.asks || []), ...(me.research_interests || [])].join('; ');
      let sharedPoster = null;
      if (paperId) {
        const mine = (me.shared_poster_interests || []).find((s) => s.paper_id === paperId);
        if (!mine) throw new HttpError(409, 'open buddy discovery for this poster first (PUT /api/papers/{id}/buddy)');
        const paper = await es.get(INDEX.papers, paperId);
        const occ = (paper._source.occurrences || []).find((o) => o.occurrence_id === mine.occurrence_id);
        sharedPoster = { paper_id: paperId, title: paper._source.title, occurrence: occ ? cards.occurrenceCard(occ) : null };
        text = paper._source.title;
        filter.push({ nested: { path: 'shared_poster_interests', query: { bool: { filter: [
          { term: { 'shared_poster_interests.paper_id': paperId } },
          { term: { 'shared_poster_interests.occurrence_id': mine.occurrence_id } }] } } } });
        // Respect declared availability: no windows declared, or a window overlapping the poster slot.
        if (occ && occ.starts_at) {
          filter.push({ bool: { should: [
            { bool: { must_not: [{ nested: { path: 'available_windows', query: { exists: { field: 'available_windows.starts_at' } } } }] } },
            { nested: { path: 'available_windows', query: { bool: { filter: [
              { range: { 'available_windows.starts_at': { lt: occ.ends_at } } },
              { range: { 'available_windows.ends_at': { gt: occ.starts_at } } }] } } } },
          ], minimum_should_match: 1 } });
        }
      }
      const r = await hybrid(INDEX.people, {
        text: text || interests, keywordFields: ['offers^3', 'research_interests^2', 'bio', 'tags^2'], semanticField: 'expertise_text',
        filter, mustNot,
      });
      engine = r.engine;
      ranked = rerank(r.hits.map((h) => ({ src: h._source, tags: h._source.tags || [] })), aff);
      // Prefer peers when requested (soft): stable-partition same-band first.
      if (me.conversation_preference === 'peers_at_my_stage' && !me.peers_only) {
        ranked = [...ranked.filter((c) => c.src.stage_band === me.stage_band), ...ranked.filter((c) => c.src.stage_band !== me.stage_band)];
      }
      if (me.intent === 'broaden_research') ranked = reserveAdjacent(ranked, me.tags);
      return {
        deck, engine, affinity: aff, context: sharedPoster,
        cards: ranked.map((c) => cards.personCard(c.src, personReason(ev, me, c, sharedPoster), c.rank, { sharedPoster })),
      };
    }

    // groups
    const filter = [
      { term: { event_id: EVENT_ID } },
      { term: { status: 'scheduled' } },
      { range: { ends_at: { gte: ev.demo_clock } } },
      // Stage restriction applies only when the host specified an audience.
      { bool: { should: [{ term: { audience_specified: false } }, { term: { stage_restrictions: me.stage_band } }], minimum_should_match: 1 } },
    ];
    const r = await hybrid(INDEX.groups, {
      text: interests, keywordFields: ['title^2', 'topic^2', 'description', 'tags^2'], semanticField: 'about',
      filter, mustNot: [{ ids: { values: seen } }, { term: { host_profile_id: actor } }],
    });
    engine = r.engine;
    ranked = rerank(r.hits.map((h) => ({ src: h._source, tags: h._source.tags || [] })), aff);
    const hosts = await es.mget(INDEX.people, [...new Set(ranked.map((c) => c.src.host_profile_id))], ['display_name']);
    const hostName = Object.fromEntries(hosts.docs.filter((d) => d.found).map((d) => [d._id, d._source.display_name]));
    return {
      deck, engine, affinity: aff,
      cards: ranked.map((c) => cards.groupCard(c.src, groupReason(ev, me, c), c.rank, hostName[c.src.host_profile_id])),
    };
  }

  function sharedTags(me, c) { return (c.tags || []).filter((t) => (me.tags || []).includes(t)); }

  function paperReason(ev, me, c) {
    const shared = tagLabels(ev, sharedTags(me, c));
    const poster = (c.src.occurrences || []).find((o) => o.format === 'poster' && o.verification_status === 'verified');
    const where = poster ? ` Poster scheduled ${cards.occurrenceCard(poster).when_label} in ${poster.room}.` : '';
    if (c.adjacent) return `Adjacent field: shares ${shared[0] || 'a topic'} with your interests and adds ${tagLabels(ev, c.tags.filter((t) => !(me.tags || []).includes(t)))[0]}.${where}`;
    if (shared.length && me.asks && me.asks.length) return `You want to learn ${me.asks[0]}. This paper covers ${shared.join(' and ')}.${where}`;
    if (shared.length) return `Matches your interest in ${shared.join(' and ')}.${where}`;
    return `Related to what you described in onboarding.${where}`;
  }

  function personReason(ev, me, c, sharedPoster) {
    if (sharedPoster) return `You both opted into finding a buddy for this poster: ${sharedPoster.title}.`;
    const offers = c.src.offers || [];
    const ask = (me.asks || []).find((a) => offers.some((o) => o.toLowerCase().includes(a.toLowerCase()) || a.toLowerCase().includes(o.toLowerCase())));
    if (ask) return `You want to learn ${ask}; ${c.src.display_name} can help with ${offers.find((o) => o.toLowerCase().includes(ask.toLowerCase()) || ask.toLowerCase().includes(o.toLowerCase()))}.`;
    const shared = tagLabels(ev, sharedTags(me, c));
    if (c.adjacent) return `Adjacent field: ${c.src.display_name} works on ${tagLabels(ev, c.tags)[0]} and shares ${shared[0] || 'a topic'} with you.`;
    if (shared.length) return `You share an interest in ${shared.join(' and ')}.`;
    return `${c.src.display_name} can help with ${offers[0] || 'their listed topics'}.`;
  }

  function groupReason(ev, me, c) {
    const shared = tagLabels(ev, sharedTags(me, c));
    return `Hosted meetup on ${c.src.topic}${shared.length ? `; matches your interest in ${shared.join(' and ')}` : ''}.`;
  }

  // ------------------------------------------------------------------ targets
  async function resolveTarget(type, id) {
    const index = { paper: INDEX.papers, person: INDEX.people, group: INDEX.groups }[type];
    if (!index) throw new HttpError(400, 'type must be paper, person or group');
    const r = await es.get(index, id);
    if (!r) throw new HttpError(404, `${type} not found`);
    const s = r._source;
    if (type === 'paper' && !(s.conference_id === CONFERENCE_ID && s.main_track)) throw new HttpError(404, 'paper not in the AAAI-25 main track');
    if (type === 'person' && !(s.event_id === EVENT_ID && s.discovery_opt_in)) throw new HttpError(404, 'person not found');
    if (type === 'group' && s.event_id !== EVENT_ID) throw new HttpError(404, 'group not found');
    return s;
  }

  // ------------------------------------------------------------------ actions
  // One document per (event, actor, kind, target). An identical retry is a
  // `noop`: effective_at, revision and the tag snapshot do not move, so the
  // swipe counts once in affinity and recency. A genuine change (left->right
  // or right->left) updates direction, bumps revision, advances effective_at
  // and refreshes the server-derived tag snapshot.
  const SWIPE_SCRIPT = `
    if (ctx._source.direction == params.direction) { ctx.op = 'noop'; return; }
    ctx._source.direction = params.direction;
    ctx._source.effective_at = params.now;
    ctx._source.updated_at = params.now;
    ctx._source.revision = (ctx._source.revision == null ? 1 : ctx._source.revision) + 1;
    ctx._source.target_tags = params.tags;
    if (params.direction == 'left') { ctx._source.opener = null; }
    else if (ctx._source.opener == null) { ctx._source.opener = params.opener; }`;

  async function writeAction(actor, kind, targetType, targetId, fields, script) {
    const id = actionId(EVENT_ID, actor, kind, targetType, targetId);
    const now = new Date().toISOString();
    const doc = {
      action_id: id, event_id: EVENT_ID, actor_profile_id: actor, action_kind: kind, target_type: targetType, target_id: targetId,
      active: true, effective_at: now, revision: 1, created_at: now, updated_at: now, ...fields,
    };
    const body = script
      ? { script: { source: script, lang: 'painless', params: { ...fields, now } }, upsert: doc }
      : { script: { source: "if (ctx._source.active == true) { ctx.op = 'noop'; } else { ctx._source.active = true; ctx._source.effective_at = params.now; ctx._source.updated_at = params.now; ctx._source.revision += 1; }", lang: 'painless', params: { now } }, upsert: doc };
    // wait_for: the next feed search (an immediate reload) already sees this write.
    const r = await es.update(INDEX.actions, id, body, { refresh: 'wait_for', retry_on_conflict: '3' });
    return { id, result: r.result }; // created | updated | noop
  }

  function draftOpener(me, target, context) {
    const first = target.display_name.split(' ')[0];
    const offer = (me.offers || [])[0];
    const theirs = (target.offers || [])[0];
    const poster = context && context.title ? `I'm also heading to the ${context.title.split(':')[0]} poster. ` : '';
    return `Hey ${first}, ${poster}${offer ? `I've worked on ${offer}` : "I'm new to this area"}${theirs ? ` and would love to hear how you've approached ${theirs}` : ''}. Want to check it out together?`;
  }

  async function swipe(actor, type, id, direction, { paperId, occurrenceId } = {}) {
    if (!['left', 'right'].includes(direction)) throw new HttpError(400, "direction must be 'left' or 'right'");
    if (type === 'person' && id === actor) throw new HttpError(400, 'cannot swipe on yourself');
    const target = await resolveTarget(type, id);
    const me = await profile(actor);
    let opener = null;
    if (type === 'person' && direction === 'right') {
      const ctx = paperId ? (await es.get(INDEX.papers, paperId))?._source : null;
      opener = draftOpener(me, target, ctx);
    }
    const fields = { direction, tags: target.tags || [], opener };
    const upsertExtra = { direction, target_tags: target.tags || [], opener, context_paper_id: paperId || null, context_occurrence_id: occurrenceId || null };
    const id_ = actionId(EVENT_ID, actor, 'swipe', type, id);
    const now = new Date().toISOString();
    const r = await es.update(INDEX.actions, id_, {
      script: { source: SWIPE_SCRIPT, lang: 'painless', params: { ...fields, now } },
      upsert: { action_id: id_, event_id: EVENT_ID, actor_profile_id: actor, action_kind: 'swipe', target_type: type, target_id: id,
        active: true, effective_at: now, revision: 1, created_at: now, updated_at: now, ...upsertExtra },
    }, { refresh: 'wait_for', retry_on_conflict: '3' });
    const out = { target_type: type, target_id: id, direction, effect: r.result, saved: direction === 'right' && type !== 'person' };
    if (type === 'person') out.matched = direction === 'right' && (await isReciprocal(actor, id));
    return out;
  }

  // Real-time GET of the reverse action by its deterministic ID: never misses a
  // like written a moment ago, and never exposes it unless both sides liked.
  async function isReciprocal(a, b) {
    const [ab, ba] = await Promise.all([
      es.get(INDEX.actions, actionId(EVENT_ID, a, 'swipe', 'person', b)),
      es.get(INDEX.actions, actionId(EVENT_ID, b, 'swipe', 'person', a)),
    ]);
    return !!(ab && ba && ab._source.direction === 'right' && ba._source.direction === 'right'
      && ab._source.event_id === EVENT_ID && ba._source.event_id === EVENT_ID);
  }

  async function buddy(actor, paperId, occurrenceId) {
    const paper = await resolveTarget('paper', paperId);
    const saved = await es.get(INDEX.actions, actionId(EVENT_ID, actor, 'swipe', 'paper', paperId));
    if (!saved || saved._source.direction !== 'right') throw new HttpError(409, 'save the poster before opening buddy discovery');
    const posters = (paper.occurrences || []).filter((o) => o.format === 'poster' && o.verification_status === 'verified');
    const occ = occurrenceId ? posters.find((o) => o.occurrence_id === occurrenceId) : posters[0];
    if (!occ) throw new HttpError(409, 'no verified poster occurrence for this paper');
    const r = await writeAction(actor, 'buddy', 'paper', paperId, { context_paper_id: paperId, context_occurrence_id: occ.occurrence_id });
    // Project the explicit opt-in onto the profile (idempotent add).
    const now = new Date().toISOString();
    await es.update(INDEX.people, actor, { script: { lang: 'painless', params: { p: paperId, o: occ.occurrence_id, now }, source: `
      if (ctx._source.shared_poster_interests == null) { ctx._source.shared_poster_interests = []; }
      for (def s : ctx._source.shared_poster_interests) { if (s.paper_id == params.p && s.occurrence_id == params.o) { ctx.op = 'noop'; return; } }
      ctx._source.shared_poster_interests.add(['paper_id': params.p, 'occurrence_id': params.o, 'shared_at': params.now]);
      ctx._source.updated_at = params.now;` } }, { refresh: 'wait_for', retry_on_conflict: '3' });
    return { paper_id: paperId, occurrence: cards.occurrenceCard(occ), effect: r.result, buddy_visible: true };
  }

  async function join(actor, groupId) {
    const g = await resolveTarget('group', groupId);
    const me = await profile(actor);
    if (g.audience_specified && (g.stage_restrictions || []).length && !g.stage_restrictions.includes(me.stage_band)) {
      throw new HttpError(403, 'this meetup is restricted by its host to a different audience');
    }
    const r = await writeAction(actor, 'join', 'group', groupId, {});
    return { group_id: groupId, joined: true, effect: r.result };
  }

  async function editOpener(actor, profileId, opener) {
    if (typeof opener !== 'string' || opener.length > 1000) throw new HttpError(400, 'opener must be a string up to 1000 chars');
    const id = actionId(EVENT_ID, actor, 'swipe', 'person', profileId);
    const a = await es.get(INDEX.actions, id);
    if (!a || a._source.direction !== 'right') throw new HttpError(404, 'no like to attach an opener to');
    await es.update(INDEX.actions, id, { doc: { opener, opener_edited_at: new Date().toISOString() } }, { refresh: 'wait_for' });
    return { profile_id: profileId, opener };
  }

  async function saved(actor) {
    const [ev, swipes, joins, buddies, me] = await Promise.all([event(), mySwipes(actor), myActions(actor, 'join'), myActions(actor, 'buddy'), profile(actor)]);
    const rights = swipes.filter((s) => s.direction === 'right');
    const ids = (t) => rights.filter((s) => s.target_type === t).map((s) => s.target_id);
    const joinedIds = new Set(joins.map((j) => j.target_id));
    const buddyByPaper = Object.fromEntries(buddies.map((b) => [b.target_id, b.context_occurrence_id]));
    const pIds = ids('paper');
    const gIds = [...new Set([...ids('group'), ...joinedIds])];
    const [pd, gd] = await Promise.all([
      pIds.length ? es.mget(INDEX.papers, pIds) : { docs: [] },
      gIds.length ? es.mget(INDEX.groups, gIds) : { docs: [] },
    ]);
    const research = pd.docs.filter((d) => d.found).map((d) => ({ ...cards.paperCard(d._source, 'Saved', null), buddy_open: !!buddyByPaper[d._id], buddy_occurrence_id: buddyByPaper[d._id] || null }));
    const groups = gd.docs.filter((d) => d.found).map((d) => ({ ...cards.groupCard(d._source, joinedIds.has(d._id) ? 'Joined' : 'Saved', null), saved: ids('group').includes(d._id), joined: joinedIds.has(d._id) }));

    // Matches: my right swipes on people where the reverse right swipe exists.
    const liked = rights.filter((s) => s.target_type === 'person').map((s) => s.target_id);
    const matches = [];
    for (const other of liked) {
      if (!(await isReciprocal(actor, other))) continue;
      const [p, mine] = await Promise.all([profile(other), es.get(INDEX.actions, actionId(EVENT_ID, actor, 'swipe', 'person', other))]);
      matches.push({
        ...cards.personCard(p, 'Mutual interest', null),
        contact_links: (p.public_links || []).map((l) => ({ kind: l.kind, label: l.label, url: l.url })),
        opener: mine._source.opener || null,
        meetup_suggestion: await suggestion(ev, me, p),
      });
    }
    return { research, groups, matches };
  }

  async function suggestion(ev, me, other) {
    const mine = me.shared_poster_interests || [];
    const both = (other.shared_poster_interests || []).find((s) => mine.some((m) => m.occurrence_id === s.occurrence_id));
    if (both) {
      const paper = await es.get(INDEX.papers, both.paper_id);
      const occ = (paper._source.occurrences || []).find((o) => o.occurrence_id === both.occurrence_id);
      if (occ) return { kind: 'shared_poster', label: cards.locationLabel(occ), paper_title: paper._source.title, occurrence: cards.occurrenceCard(occ) };
    }
    if (other.meeting_point) return { kind: 'participant_meeting_point', label: `${other.display_name.split(' ')[0]} shared this meeting point: ${other.meeting_point.label}`, source_url: other.meeting_point.source_url };
    const mp = ev.meeting_points[0];
    return { kind: 'suggested_meeting_point', label: `Suggested meeting point: ${mp.label}`, source_url: mp.source_url };
  }

  // ------------------------------------------------------------------ onboarding
  const EDITABLE = ['intent', 'offers', 'asks', 'research_interests', 'tags', 'conversation_preference', 'peers_only', 'stage',
    'stage_label', 'bio', 'availability_status', 'discovery_opt_in', 'available_windows', 'meeting_point_id', 'public_links'];

  async function updateMe(actor, input) {
    const ev = await event();
    const me = await profile(actor);
    const patch = {};
    for (const k of Object.keys(input || {})) {
      if (!EDITABLE.includes(k)) throw new HttpError(400, `field ${k} is not editable`);
    }
    const vocab = new Set(ev.topic_vocabulary.map((v) => v.tag));
    for (const k of EDITABLE) if (input[k] !== undefined) patch[k] = input[k];
    if (patch.tags && !patch.tags.every((t) => vocab.has(t))) throw new HttpError(400, 'tags must come from the event vocabulary');
    if (patch.stage) {
      if (!STAGE_BAND[patch.stage]) throw new HttpError(400, 'unknown stage');
      patch.stage_band = STAGE_BAND[patch.stage];
    }
    if (patch.conversation_preference === 'peers_only') patch.peers_only = true;
    if (patch.meeting_point_id !== undefined) {
      const mp = ev.meeting_points.find((m) => m.point_id === patch.meeting_point_id);
      if (patch.meeting_point_id && !mp) throw new HttpError(400, 'meeting point must be a sourced public point');
      patch.meeting_point = mp ? { point_id: mp.point_id, label: mp.label, source_url: mp.source_url } : null;
      delete patch.meeting_point_id;
    }
    if (patch.discovery_opt_in === true && !me.discovery_opt_in) patch.opted_in_at = new Date().toISOString();
    const next = { ...me, ...patch };
    patch.expertise_text = expertiseText(next);
    patch.updated_at = new Date().toISOString();
    await es.update(INDEX.people, actor, { doc: patch }, { refresh: 'wait_for' });
    return publicSelf(await profile(actor));
  }

  // Same recipe as scripts/seed_social_fixtures.py: offers, interests, bio and
  // evidence titles. Never asks, links, actions or drafts.
  function expertiseText(p) {
    const parts = [p.display_name + '.'];
    if ((p.offers || []).length) parts.push('Can help with: ' + p.offers.join('; ') + '.');
    if ((p.research_interests || []).length) parts.push('Research interests: ' + p.research_interests.join('; ') + '.');
    if (p.bio) parts.push(p.bio);
    const titles = (p.evidence || []).map((e) => e.title).filter(Boolean);
    if (titles.length) parts.push('Projects and papers of interest: ' + titles.join('; ') + '.');
    return parts.join(' ');
  }

  function publicSelf(p) {
    const c = cards.personCard(p, null, null);
    return { ...c, intent: p.intent, stage: p.stage, peers_only: p.peers_only, research_interests: p.research_interests,
      availability_status: p.availability_status, discovery_opt_in: p.discovery_opt_in, bio: p.bio,
      shared_poster_interests: p.shared_poster_interests || [], public_links: p.public_links || [] };
  }

  async function me(actor) { return publicSelf(await profile(actor)); }

  return { feed, swipe, buddy, join, editOpener, saved, updateMe, me, event, HttpError, expertiseText };
}

module.exports = { createService, HttpError };
