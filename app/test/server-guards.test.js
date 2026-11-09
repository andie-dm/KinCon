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
