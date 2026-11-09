'use strict';
// Server guards that need no live cluster.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createServer } = require('../server');
const { client } = require('../lib/es');
const { EVENT_ID, INDEX, DEMO_SESSIONS, actionId } = require('../lib/config');

async function start(t, opts) {
  const server = createServer(opts);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}`;
}

test('readiness stays local when Elasticsearch is unreachable; /api/health reports it', async (t) => {
  // Port 9 (discard) on loopback: connection refused, no external traffic.
  const base = await start(t, { es: client({ url: 'http://127.0.0.1:9' }) });
  const ready = await fetch(`${base}/readyz`);
  assert.equal(ready.status, 200);
  assert.equal(await ready.text(), 'ok\n');
  const health = await fetch(`${base}/api/health`);
  assert.equal(health.status, 503);
  assert.match((await health.json()).elasticsearch, /^unreachable/);
});

test('inherited object keys are not demo identities', async (t) => {
  const base = await start(t, { es: client({ url: 'http://127.0.0.1:9' }) });
  for (const identity of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
    const r = await fetch(`${base}/api/demo/session`, { method: 'POST', body: JSON.stringify({ identity }) });
    assert.equal(r.status, 400, identity);
  }
  const forged = await fetch(`${base}/api/me`, { headers: { cookie: 'demo_session=constructor' } });
  assert.equal(forged.status, 401);
});

test('with DEMO_SESSION_TOKENS set, only a valid token establishes a session', async (t) => {
  const base = await start(t, { es: client({ url: 'http://127.0.0.1:9' }), sessionTokens: 'riley=tok-r1,jules=tok-j2,constructor=x' });
  // Naming an identity is not enough once tokens are configured.
  assert.equal((await fetch(`${base}/api/demo/session`, { method: 'POST', body: JSON.stringify({ identity: 'riley' }) })).status, 401);
  assert.equal((await fetch(`${base}/api/me`, { headers: { cookie: 'demo_session=riley' } })).status, 401);
  assert.equal((await fetch(`${base}/api/me`, { headers: { authorization: 'Bearer x' } })).status, 401);
  const ok = await fetch(`${base}/api/demo/session`, { method: 'POST', body: JSON.stringify({ token: 'tok-j2' }) });
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).identity, 'jules');
  assert.match(ok.headers.get('set-cookie'), /^demo_session=tok-j2;/);
});

test('match chat needs both likes and an authenticated participant, and retries do not duplicate messages', async (t) => {
  const { riley, jules } = DEMO_SESSIONS;
  const docs = new Map();
  function like(actor, target) {
    docs.set(actionId(EVENT_ID, actor, 'swipe', 'person', target),
      { event_id: EVENT_ID, direction: 'right' });
  }
  const es = {
    get: async (index, id) => docs.has(id) ? { _source: docs.get(id) } : null,
    request: async (method, path, doc) => {
      assert.equal(method, 'PUT');
      assert.equal(path, `/${INDEX.actions}/_create/${doc.action_id}`);
      if (docs.has(doc.action_id)) throw Object.assign(new Error('conflict'), { status: 409 });
      docs.set(doc.action_id, doc);
    },
    search: async (index, body) => {
      assert.equal(index, INDEX.actions);
      const { filter, should } = body.query.bool;
      const matches = (doc, terms) => terms.every(({ term }) =>
        Object.entries(term).every(([field, value]) => doc[field] === value));
      return { hits: { hits: [...docs.values()]
        .filter((doc) => matches(doc, filter) && should.some(({ bool }) => matches(doc, bool.filter)))
        .map((_source) => ({ _source })) } };
    },
  };
  const base = await start(t, { es, sessionTokens: 'riley=tok-r1,jules=tok-j2' });
  const url = `${base}/api/matches/${jules}/messages`;
  const body = JSON.stringify({ text: '  Want to check out a poster?  ', request_id: '5da76a3a-e893-4425-928b-6b00a1a41ee8', sender_id: jules });
  const headers = { authorization: 'Bearer tok-r1' };
  assert.equal((await fetch(url)).status, 401);
  like(riley, jules);
  assert.equal((await fetch(url, { method: 'POST', headers, body })).status, 403);
  like(jules, riley);
  assert.equal((await fetch(`${base}/api/matches/${riley}/messages`, { headers })).status, 404);
  const first = await fetch(url, { method: 'POST', headers, body });
  assert.equal(first.status, 201);
  const sent = await first.json();
  assert.equal(sent.sender_id, riley);
  assert.equal(sent.text, 'Want to check out a poster?');
  const retried = await fetch(url, { method: 'POST', headers, body });
  assert.deepEqual(await retried.json(), sent);
  const inbox = await fetch(`${base}/api/matches/${riley}/messages`, {
    headers: { authorization: 'Bearer tok-j2' },
  });
  assert.deepEqual(await inbox.json(), { messages: [sent] });
});
