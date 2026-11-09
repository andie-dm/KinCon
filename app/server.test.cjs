const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
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

  const malformed = await new Promise((resolve, reject) => {
    const request = http.request({
      host: '127.0.0.1',
      port: server.address().port,
      path: '//[',
    }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { body += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, body }));
    });
    request.on('error', reject);
    request.end();
  });
  assert.deepEqual(malformed, { status: 400, body: 'bad request\n' });
});

test('production server keeps probes and starter API, and restricts static file access', async (t) => {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const health = await fetch(`${base}/healthz`);
  assert.equal(health.status, 200);
  assert.equal(await health.text(), 'ok\n');
  // Readiness stays local so an Elasticsearch outage cannot remove the UI from
  // the Service; dependency status is reported by /api/health.
  const readiness = await fetch(`${base}/readyz`);
  assert.equal(readiness.status, 200);
  assert.equal(await readiness.text(), 'ok\n');
  const sessions = await (await fetch(`${base}/api/sessions`)).json();
  assert.ok(sessions.sessions.length > 0);
  assert.ok(sessions.version);
  for (const file of ['/server.js', '/package.json', '/assets/%2e%2e%2fserver.js', '/assets/missing.js']) {
    assert.equal((await fetch(`${base}${file}`)).status, 404);
  }
  assert.equal((await fetch(`${base}/assets/%ZZ`)).status, 400);
  const post = await fetch(base, { method: 'POST' });
  assert.equal(post.status, 405);
  assert.equal(post.headers.get('allow'), 'GET, HEAD');
});
