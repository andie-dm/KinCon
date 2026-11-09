'use strict';
// Server guards that need no live cluster.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createServer } = require('../server');
const { client } = require('../lib/es');

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
