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

  // 11 + 12: one-sided interest is private; reciprocity unlocks exactly this pair.
  test('one-sided like stays private; reciprocity unlocks the two profiles', async () => {
    const like = await riley('PUT', `/api/swipes/person/${encodeURIComponent(JULES)}`, { direction: 'right', paperId: FLOWPOLICY });
    assert.equal(like.status, 200);
    assert.equal(like.body.matched, false);
    for (const k of PRIVATE_KEYS) assert.ok(!keysDeep(like.body).has(k), `swipe response leaks ${k}`);

    const jSaved = await jules('GET', '/api/me/saved');
    assert.equal(jSaved.body.matches.length, 0);
    const jPeople = await jules('GET', '/api/feed?deck=people');
    for (const k of PRIVATE_KEYS) assert.ok(!keysDeep(jPeople.body).has(k), `feed leaks ${k}`);
    assert.ok(!JSON.stringify(jPeople.body).includes('liked'), 'no hint of the pending like');

    const back = await jules('PUT', `/api/swipes/person/${encodeURIComponent(RILEY)}`, { direction: 'right' });
    assert.equal(back.body.matched, true);
    const rSaved = await riley('GET', '/api/me/saved');
    assert.deepEqual(rSaved.body.matches.map((m) => m.id), [JULES]);
    const m = rSaved.body.matches[0];
    assert.ok(m.opener.startsWith('Hey Jules'));
    assert.equal(m.meetup_suggestion.kind, 'shared_poster');
    assert.equal(m.meetup_suggestion.label, 'Poster scheduled in Exhibit Hall E');
    assert.ok(m.contact_links.length === 1);
    const jSaved2 = await jules('GET', '/api/me/saved');
    assert.deepEqual(jSaved2.body.matches.map((x) => x.id), [RILEY]);
    // Seeded one-sided Marcus -> Helena is not a match for anyone involved.
    assert.equal(await (async () => {
      const a = await es.get(INDEX.actions, actionId(EVENT_ID, `${EVENT_ID}.helena`, 'swipe', 'person', `${EVENT_ID}.marcus`));
      return a;
    })(), null);

    const edit = await riley('PUT', `/api/matches/${encodeURIComponent(JULES)}/opener`, { opener: 'Hey Jules, see you at board 746?' });
    assert.equal(edit.status, 200);
    assert.equal((await riley('GET', '/api/me/saved')).body.matches[0].opener, 'Hey Jules, see you at board 746?');
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
