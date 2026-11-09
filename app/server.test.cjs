const test = require('node:test');
const assert = require('node:assert/strict');
const { createServer } = require('./server');

test('encoded null bytes return 400 without crashing the server', { timeout: 5000 }, async (t) => {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;

  for (const file of ['/assets/%00', '/assets/app%00.js']) {
    for (const method of ['GET', 'HEAD']) {
      const response = await fetch(`${base}${file}`, { method });
      assert.equal(response.status, 400);
      assert.equal(await response.text(), method === 'HEAD' ? '' : 'bad path\n');
    }
  }

  const health = await fetch(`${base}/healthz`);
  assert.equal(health.status, 200);
  assert.equal(await health.text(), 'ok\n');
});

test('production server keeps probes and starter API, and restricts static file access', async (t) => {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  for (const probe of ['/healthz', '/readyz']) {
    const response = await fetch(`${base}${probe}`);
    assert.equal(response.status, 200);
    assert.equal(await response.text(), 'ok\n');
  }
  const sessions = await (await fetch(`${base}/api/sessions`)).json();
  assert.equal(sessions.sessions.length, 4);
  assert.ok(sessions.version);
  for (const file of ['/server.js', '/package.json', '/assets/%2e%2e%2fserver.js', '/assets/missing.js']) {
    assert.equal((await fetch(`${base}${file}`)).status, 404);
  }
  assert.equal((await fetch(`${base}/assets/%ZZ`)).status, 400);
  const post = await fetch(base, { method: 'POST' });
  assert.equal(post.status, 405);
  assert.equal(post.headers.get('allow'), 'GET, HEAD');
});
