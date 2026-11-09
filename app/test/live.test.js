'use strict';
// Live end-to-end checks against the configured Elasticsearch through the real
// HTTP server. Skipped unless ELASTICSEARCH_URL is set. Resets only the two
// fictional demo identities' actions (scripts/seed_social_fixtures.py --reset-demo-actions).
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const path = require('node:path');
const { client } = require('../lib/es');
const { INDEX, EVENT_ID, actionId } = require('../lib/config');

const ES_URL = process.env.ELASTICSEARCH_URL;
const ROOT = path.resolve(__dirname, '..', '..');
const PORT = 18000 + Math.floor(Math.random() * 1000);
const BASE = `http://127.0.0.1:${PORT}`;
const FLOWPOLICY = 'doi_10.1609_aaai.v39i14.33617';
const RILEY = `${EVENT_ID}.riley`;
const JULES = `${EVENT_ID}.jules`;
const PRIVATE_KEYS = ['opener', 'public_links', 'actor_profile_id', 'contact_links', 'expertise_text', 'opted_in_at'];

const opts = { skip: !ES_URL && 'ELASTICSEARCH_URL not set', concurrency: false };
let server;
const es = ES_URL ? client() : null;

async function as(identity) {
  const r = await fetch(`${BASE}/api/demo/session`, { method: 'POST', body: JSON.stringify({ identity }) });
  const cookie = r.headers.get('set-cookie').split(';')[0];
  return async (method, p, body) => {
    const res = await fetch(BASE + p, { method, headers: { cookie, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, body: await res.json() };
  };
}

function keysDeep(obj, out = new Set()) {
  if (Array.isArray(obj)) obj.forEach((x) => keysDeep(x, out));
  else if (obj && typeof obj === 'object') for (const [k, v] of Object.entries(obj)) { out.add(k); keysDeep(v, out); }
  return out;
}

test.describe('live API against Elasticsearch', opts, () => {
  let riley; let jules;

  test.before(async () => {
    const py = process.platform === 'win32' ? 'python' : 'python3';
    const seed = spawnSync(py, ['scripts/seed_social_fixtures.py', '--reset-demo-actions'], { cwd: ROOT, encoding: 'utf8', env: process.env });
    assert.equal(seed.status, 0, seed.stderr);
    server = spawn(process.execPath, ['server.js'], { cwd: path.join(ROOT, 'app'), env: { ...process.env, PORT: String(PORT) } });
    for (let i = 0; i < 50; i++) {
      try { if ((await fetch(`${BASE}/readyz`)).status === 200) break; } catch { /* starting */ }
      await new Promise((r) => setTimeout(r, 100));
    }
    riley = await as('riley');
    jules = await as('jules');
  });
  test.after(() => server && server.kill());

  // 19 + 2: results come from Elasticsearch RRF and only main-track papers.
  test('research feed is Elasticsearch RRF over main-track papers only', async () => {
    const r = await riley('GET', '/api/feed?deck=research');
    assert.equal(r.status, 200);
    assert.equal(r.body.engine, 'elasticsearch_rrf');
    assert.ok(r.body.cards.length > 0 && r.body.cards.length <= 30);
    const ids = r.body.cards.map((c) => c.id);
    const docs = await es.mget(INDEX.papers, ids, ['main_track', 'conference_id']);
    assert.ok(docs.docs.every((d) => d.found && d._source.main_track === true && d._source.conference_id === 'aaai-25'));
    const other = await es.search(INDEX.papers, { size: 1, query: { term: { main_track: false } } });
    assert.ok(other.hits.total.value > 0, 'non-main-track papers exist in the index');
    const posters = await riley('GET', '/api/feed?deck=research&format=poster');
    assert.ok(posters.body.cards.every((c) => c.occurrences.some((o) => o.format === 'poster')));
  });

  // 9 + 10: idempotent swipes; passes stay hidden after reload.
  test('repeated identical swipe counts once; a pass stays excluded', async () => {
    const feed = await riley('GET', '/api/feed?deck=research');
    const [a, b] = feed.body.cards;
    const first = await riley('PUT', `/api/swipes/paper/${encodeURIComponent(a.id)}`, { direction: 'right' });
    assert.equal(first.body.effect, 'created');
    const doc1 = (await es.get(INDEX.actions, actionId(EVENT_ID, RILEY, 'swipe', 'paper', a.id)))._source;
    const aff1 = first.body.feed.affinity;
    const again = await riley('PUT', `/api/swipes/paper/${encodeURIComponent(a.id)}`, { direction: 'right' });
    assert.equal(again.body.effect, 'noop');
    const doc2 = (await es.get(INDEX.actions, actionId(EVENT_ID, RILEY, 'swipe', 'paper', a.id)))._source;
    assert.equal(doc2.effective_at, doc1.effective_at);
    assert.equal(doc2.revision, 1);
    assert.deepEqual(again.body.feed.affinity, aff1);

    await riley('PUT', `/api/swipes/paper/${encodeURIComponent(b.id)}`, { direction: 'left' });
    const reload = await riley('GET', '/api/feed?deck=research');
    const ids = reload.body.cards.map((c) => c.id);
    assert.ok(!ids.includes(b.id) && !ids.includes(a.id));

    // A genuine change is one logical update with a new revision.
    const changed = await riley('PUT', `/api/swipes/paper/${encodeURIComponent(b.id)}`, { direction: 'right' });
    assert.equal(changed.body.effect, 'updated');
    assert.equal((await es.get(INDEX.actions, actionId(EVENT_ID, RILEY, 'swipe', 'paper', b.id)))._source.revision, 2);
  });

  // 13: saving a poster alone does not create buddy visibility.
  test('saving a poster does not enable buddy discovery; explicit buddy does', async () => {
    await riley('PUT', `/api/swipes/paper/${encodeURIComponent(FLOWPOLICY)}`, { direction: 'right' });
    const me = await riley('GET', '/api/me');
    assert.equal(me.body.shared_poster_interests.length, 0);
    const blocked = await riley('GET', `/api/feed?deck=people&paperId=${encodeURIComponent(FLOWPOLICY)}`);
    assert.equal(blocked.status, 409);
    const jFeed = await jules('GET', `/api/feed?deck=people&paperId=${encodeURIComponent(FLOWPOLICY)}`);
    assert.ok(!jFeed.body.cards.some((c) => c.id === RILEY), 'Riley not visible as buddy before opting in');

    const b = await riley('PUT', `/api/papers/${encodeURIComponent(FLOWPOLICY)}/buddy`, {});
    assert.equal(b.status, 200);
    assert.equal(b.body.occurrence.location_label, 'Poster scheduled in Exhibit Hall E');
    const again = await riley('PUT', `/api/papers/${encodeURIComponent(FLOWPOLICY)}/buddy`, {});
    assert.equal(again.body.effect, 'noop');
    const buddies = await riley('GET', `/api/feed?deck=people&paperId=${encodeURIComponent(FLOWPOLICY)}`);
    assert.equal(buddies.status, 200);
    assert.ok(buddies.body.cards.some((c) => c.id === JULES), 'Jules shared this poster');
    assert.ok(buddies.body.cards.every((c) => c.shared_poster && c.shared_poster.paper_id === FLOWPOLICY));
    assert.ok(!buddies.body.cards.some((c) => c.id.endsWith('.tomas')), 'unavailable attendee excluded');
  });

  // Interested = a visible chat request: the recipient is notified, accepts, and they can chat.
  test('interest notifies the recipient; accepting opens a private two-person chat', async () => {
    const like = await riley('PUT', `/api/swipes/person/${encodeURIComponent(JULES)}`, { direction: 'right', paperId: FLOWPOLICY });
    assert.equal(like.status, 200);
    assert.equal(like.body.matched, false);
    assert.equal(like.body.request_status, 'pending');
    for (const k of PRIVATE_KEYS) assert.ok(!keysDeep(like.body).has(k), `swipe response leaks ${k}`);

    // Jules is notified with Riley's public card; the private opener draft is not exposed.
    const note = await jules('GET', '/api/me/notifications');
    assert.equal(note.status, 200);
    assert.deepEqual(note.body.requests.map((r) => r.id), [RILEY]);
    for (const k of PRIVATE_KEYS) assert.ok(!keysDeep(note.body).has(k), `notifications leak ${k}`);
    // Riley's own notifications do not echo the outgoing request.
    assert.ok(!(await riley('GET', '/api/me/notifications')).body.requests.some((r) => r.id === JULES));
    assert.equal((await jules('GET', '/api/me/saved')).body.matches.length, 0);

    // No chat before acceptance, for either side.
    assert.equal((await riley('POST', `/api/chats/${encodeURIComponent(JULES)}/messages`, { body: 'hi' })).status, 403);
    assert.equal((await jules('GET', `/api/chats/${encodeURIComponent(RILEY)}/messages`)).status, 403);

    const accept = await jules('PUT', `/api/requests/${encodeURIComponent(RILEY)}`, { decision: 'accepted' });
    assert.equal(accept.status, 200);
    assert.equal(accept.body.connected, true);
    assert.equal(accept.body.effect, 'created');
    // The first answer is final: a later decline is a no-op.
    const flip = await jules('PUT', `/api/requests/${encodeURIComponent(RILEY)}`, { decision: 'rejected' });
    assert.equal(flip.body.effect, 'noop');
    assert.equal(flip.body.connected, true);
    assert.equal((await jules('GET', '/api/me/notifications')).body.requests.length, 0);
    assert.deepEqual((await riley('GET', '/api/me/notifications')).body.accepted.map((a) => a.id), [JULES]);

    const rSaved = await riley('GET', '/api/me/saved');
    assert.deepEqual(rSaved.body.matches.map((m) => m.id), [JULES]);
    const m = rSaved.body.matches[0];
    assert.ok(m.opener.startsWith('Hey Jules'));
    assert.equal(m.meetup_suggestion.kind, 'shared_poster');
    assert.equal(m.meetup_suggestion.label, 'Poster scheduled in Exhibit Hall E');
    assert.ok(m.contact_links.length === 1);
    assert.deepEqual((await jules('GET', '/api/me/saved')).body.matches.map((x) => x.id), [RILEY]);

    // Chat both ways; a retried send with the same client id stores one message.
    const sent = await riley('POST', `/api/chats/${encodeURIComponent(JULES)}/messages`, { body: '  See you at board 746?  ', clientMessageId: 'r-1' });
    assert.equal(sent.status, 201);
    assert.equal(sent.body.effect, 'created');
    assert.equal(sent.body.body, 'See you at board 746?');
    assert.equal((await riley('POST', `/api/chats/${encodeURIComponent(JULES)}/messages`, { body: 'See you at board 746?', clientMessageId: 'r-1' })).body.effect, 'noop');
    await jules('POST', `/api/chats/${encodeURIComponent(RILEY)}/messages`, { body: 'Yes! 12:30 at Exhibit Hall E.' });
    const thread = await jules('GET', `/api/chats/${encodeURIComponent(RILEY)}/messages`);
    assert.deepEqual(thread.body.messages.map((x) => [x.from, x.body]), [['them', 'See you at board 746?'], ['me', 'Yes! 12:30 at Exhibit Hall E.']]);
    assert.equal(thread.body.conversation_id, m.conversation_id);
    assert.equal((await riley('POST', `/api/chats/${encodeURIComponent(JULES)}/messages`, { body: '   ' })).status, 400);
    assert.equal((await riley('POST', `/api/chats/${encodeURIComponent(JULES)}/messages`, { body: 'x'.repeat(1001) })).status, 400);

    const edit = await riley('PUT', `/api/matches/${encodeURIComponent(JULES)}/opener`, { opener: 'Hey Jules, see you at board 746?' });
    assert.equal(edit.status, 200);
    assert.equal((await riley('GET', '/api/me/saved')).body.matches[0].opener, 'Hey Jules, see you at board 746?');
  });

  test('a declined request closes the chat and reveals no reason', async () => {
    const SAM = `${EVENT_ID}.sam`;
    // Seeded: Sam is interested in Riley.
    const note = await riley('GET', '/api/me/notifications');
    assert.ok(note.body.requests.some((r) => r.id === SAM), 'Sam request is pending for Riley');
    const no = await riley('PUT', `/api/requests/${encodeURIComponent(SAM)}`, { decision: 'rejected' });
    assert.equal(no.status, 200);
    assert.equal(no.body.connected, false);
    assert.ok(!(await riley('GET', '/api/me/notifications')).body.requests.some((r) => r.id === SAM));
    const doc = await es.get(INDEX.actions, actionId(EVENT_ID, RILEY, 'respond', 'person', SAM));
    assert.equal(doc._source.response, 'rejected');
    // Same 403 as for someone who never asked: no reason and no existence signal.
    assert.equal((await riley('GET', `/api/chats/${encodeURIComponent(SAM)}/messages`)).status, 403);
    assert.equal((await riley('GET', `/api/chats/${encodeURIComponent(`${EVENT_ID}.helena`)}/messages`)).status, 403);
    assert.equal((await riley('PUT', `/api/requests/${encodeURIComponent(`${EVENT_ID}.helena`)}`, { decision: 'accepted' })).status, 404);
    assert.equal((await riley('PUT', `/api/requests/${encodeURIComponent(SAM)}`, { decision: 'maybe' })).status, 400);
  });

  // 14: authors without an opted-in event profile never become People cards.
  test('nonparticipant authors and opted-out attendees never appear in People', async () => {
    const feed = await riley('GET', '/api/feed?deck=people');
    const names = feed.body.cards.map((c) => c.title);
    assert.ok(feed.body.cards.every((c) => c.is_fictional === true && c.id.startsWith(`${EVENT_ID}.`)));
    assert.ok(!names.includes('Qinglun Zhang') && !names.includes('Noor Haddad'));
    assert.ok(!feed.body.cards.some((c) => c.id === RILEY), 'self excluded');
    const s = await es.search(INDEX.people, { size: 0, query: { match_phrase: { display_name: 'Qinglun Zhang' } } });
    assert.equal(s.hits.total.value, 0);
  });

  // 15 + 16: saving a group is not joining; missing location says so.
  test('saving a group does not join it; unconfirmed location is explicit', async () => {
    const feed = await riley('GET', '/api/feed?deck=groups');
    const llm = feed.body.cards.find((c) => c.title.startsWith('LLM evaluation'));
    assert.equal(llm.location_label, 'Location unconfirmed');
    const walk = feed.body.cards.find((c) => c.title.startsWith('Robot learning'));
    await riley('PUT', `/api/swipes/group/${encodeURIComponent(walk.id)}`, { direction: 'right' });
    let saved = await riley('GET', '/api/me/saved');
    let g = saved.body.groups.find((x) => x.id === walk.id);
    assert.equal(g.saved, true);
    assert.equal(g.joined, false);
    const j = await riley('PUT', `/api/groups/${encodeURIComponent(walk.id)}/join`);
    assert.equal(j.body.effect, 'created');
    assert.equal((await riley('PUT', `/api/groups/${encodeURIComponent(walk.id)}/join`)).body.effect, 'noop');
    saved = await riley('GET', '/api/me/saved');
    g = saved.body.groups.find((x) => x.id === walk.id);
    assert.equal(g.joined, true);
    assert.equal(g.location_label, `Meet at ${walk.meeting_point.label}`);

    const research = await riley('GET', '/api/feed?deck=research&format=poster');
    const unconf = research.body.cards.flatMap((c) => c.occurrences).filter((o) => o.verification_status !== 'verified');
    assert.ok(unconf.every((o) => o.location_label !== 'Poster scheduled in Exhibit Hall E'));
  });

  test('actor is derived from the session, not the request', async () => {
    const anon = await fetch(`${BASE}/api/me`);
    assert.equal(anon.status, 401);
    const r = await riley('PUT', '/api/me', { profile_id: JULES });
    assert.equal(r.status, 400);
  });
});
