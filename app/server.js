// Fowpy: AAAI-25 replay networking app. Keeps the starter contract: listens on
// $PORT and serves /healthz and /readyz, so the manifests in deploy/ keep working.
// Serves the built UI from dist/ and the Elasticsearch-backed API under /api.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { client } = require('./lib/es');
const { createService, HttpError } = require('./lib/service');
const { DEMO_SESSIONS } = require('./lib/config');

const port = Number(process.env.PORT || 8080);
const version = process.env.APP_VERSION || 'dev';
const staticRoot = path.join(__dirname, 'dist');
const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
};

const sessions = [
  { id: 1, time: '10:00', room: 'Main', title: 'Kickoff and sponsor talks' },
  { id: 2, time: '11:00', room: 'Everywhere', title: 'Build' },
  { id: 3, time: '14:00', room: 'Main', title: 'Panel' },
  { id: 4, time: '17:30', room: 'Main', title: 'Submissions close' },
];

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers });
  res.end(JSON.stringify(body));
}

function cookies(req) {
  return Object.fromEntries((req.headers.cookie || '').split(';').map((c) => c.trim().split('=')).filter((p) => p.length === 2));
}

// The actor comes only from the server-side demo session cookie.
// Own keys only: inherited names such as "constructor" are not identities.
const demoProfile = (key) => (typeof key === 'string' && Object.hasOwn(DEMO_SESSIONS, key) ? DEMO_SESSIONS[key] : null);

function actorOf(req) {
  const id = demoProfile(cookies(req).demo_session);
  if (!id) throw new HttpError(401, 'choose a demo identity first: POST /api/demo/session {"identity":"riley"|"jules"}');
  return id;
}

async function readJson(req) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 64 * 1024) throw new HttpError(413, 'body too large');
  }
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { throw new HttpError(400, 'invalid JSON'); }
}

function apiRoutes(svc) {
  return [
    ['POST', /^\/api\/demo\/session$/, async (req, res) => {
      const { identity } = await readJson(req);
      if (!demoProfile(identity)) throw new HttpError(400, `identity must be one of ${Object.keys(DEMO_SESSIONS).join(', ')}`);
      send(res, 200, { identity, profile_id: DEMO_SESSIONS[identity] },
        { 'set-cookie': `demo_session=${identity}; Path=/; HttpOnly; SameSite=Lax` });
    }],
    ['GET', /^\/api\/event$/, async (req, res) => {
      const ev = await svc.event();
      send(res, 200, { event_id: ev.event_id, display_name: ev.display_name, replay_mode: ev.replay_mode, demo_clock: ev.demo_clock,
        time_zone: ev.time_zone, topic_vocabulary: ev.topic_vocabulary.map((v) => ({ tag: v.tag, label: v.label })),
        meeting_points: ev.meeting_points, source_references: ev.source_references });
    }],
    ['GET', /^\/api\/me$/, async (req, res) => send(res, 200, await svc.me(actorOf(req)))],
    ['PUT', /^\/api\/me$/, async (req, res) => send(res, 200, await svc.updateMe(actorOf(req), await readJson(req)))],
    ['GET', /^\/api\/feed$/, async (req, res, m, url) => send(res, 200, await svc.feed(actorOf(req), Object.fromEntries(url.searchParams)))],
    ['PUT', /^\/api\/swipes\/(paper|person|group)\/([^/]+)$/, async (req, res, m) => {
      const actor = actorOf(req);
      const body = await readJson(req);
      const out = await svc.swipe(actor, m[1], decodeURIComponent(m[2]), body.direction, { paperId: body.paperId, occurrenceId: body.occurrenceId });
      const deck = { paper: 'research', person: 'people', group: 'groups' }[m[1]];
      out.feed = await svc.feed(actor, m[1] === 'person' && body.paperId ? { deck, paperId: body.paperId } : { deck });
      send(res, 200, out);
    }],
    ['PUT', /^\/api\/papers\/([^/]+)\/buddy$/, async (req, res, m) => {
      const body = await readJson(req);
      send(res, 200, await svc.buddy(actorOf(req), decodeURIComponent(m[1]), body.occurrenceId));
    }],
    ['PUT', /^\/api\/groups\/([^/]+)\/join$/, async (req, res, m) => send(res, 200, await svc.join(actorOf(req), decodeURIComponent(m[1])))],
    ['PUT', /^\/api\/matches\/([^/]+)\/opener$/, async (req, res, m) => {
      const body = await readJson(req);
      send(res, 200, await svc.editOpener(actorOf(req), decodeURIComponent(m[1]), body.opener));
    }],
    ['GET', /^\/api\/me\/saved$/, async (req, res) => send(res, 200, await svc.saved(actorOf(req)))],
  ];
}

// Returns true when the request was an /api route handled here.
async function handleApi(req, res, url, es, svc, routes) {
  for (const [method, re, handler] of routes) {
    const m = url.pathname.match(re);
    if (!m || req.method !== method) continue;
    if (!svc) {
      send(res, 503, { error: 'ELASTICSEARCH_URL not configured' });
      return true;
    }
    try {
      await handler(req, res, m, url);
    } catch (e) {
      if (e instanceof HttpError) send(res, e.status, { error: e.message });
      else {
        console.error(`${req.method} ${url.pathname} failed: ${e.message}`);
        send(res, 502, { error: 'upstream search error' });
      }
    }
    return true;
  }
  return false;
}

function serveStatic(req, res, url) {
  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    res.writeHead(400, { 'content-type': 'text/plain' });
    return res.end('bad path\n');
  }
  if (pathname.includes('\0')) {
    res.writeHead(400, { 'content-type': 'text/plain' });
    return res.end('bad path\n');
  }
  const file = path.resolve(staticRoot, pathname === '/' ? 'index.html' : `.${pathname}`);
  if (!file.startsWith(`${staticRoot}${path.sep}`)) {
    res.writeHead(404, { 'content-type': 'text/plain' });
    return res.end('not found\n');
  }
  return fs.readFile(file, (error, content) => {
    if (error) {
      const missingBuild = pathname === '/' && error.code === 'ENOENT';
      const status = missingBuild ? 503 : error.code === 'ENOENT' || error.code === 'EISDIR' ? 404 : 500;
      if (status !== 404) console.error(`Static UI request failed: ${error.message}`);
      res.writeHead(status, { 'content-type': 'text/plain' });
      return res.end(missingBuild ? 'UI build missing. Run npm run build first.\n' : 'unable to serve asset\n');
    }
    res.writeHead(200, {
      'content-type': contentTypes[path.extname(file)] || 'application/octet-stream',
      'cache-control': pathname === '/' ? 'no-cache' : 'public, max-age=31536000, immutable',
      'x-content-type-options': 'nosniff',
    });
    res.end(req.method === 'HEAD' ? undefined : content);
  });
}

function createServer({ es = client() } = {}) {
  const svc = es ? createService(es) : null;
  const routes = apiRoutes(svc);
  return http.createServer(async (req, res) => {
    let url;
    try {
      url = new URL(req.url, 'http://localhost');
    } catch {
      res.writeHead(400, { 'content-type': 'text/plain' });
      return res.end('bad request\n');
    }
    // Probes stay local: an Elasticsearch outage must not pull the UI out of the
    // Service. Dependency status is reported by /api/health instead.
    if (url.pathname === '/healthz' || url.pathname === '/readyz') {
      res.writeHead(200, { 'content-type': 'text/plain' });
      return res.end('ok\n');
    }
    if (url.pathname === '/api/health') {
      if (!es) return send(res, 503, { elasticsearch: 'not configured' });
      try {
        await es.info({ timeoutMs: 2000 });
        return send(res, 200, { elasticsearch: 'ok' });
      } catch (e) {
        return send(res, 503, { elasticsearch: `unreachable (${e.status || e.name || 'error'})` });
      }
    }
    if (url.pathname === '/api/sessions') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ version, sessions }));
    }
    if (url.pathname.startsWith('/api/') && await handleApi(req, res, url, es, svc, routes)) return undefined;
    if (url.pathname.startsWith('/api/')) return send(res, 404, { error: 'not found' });
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { 'content-type': 'text/plain', allow: 'GET, HEAD' });
      return res.end('method not allowed\n');
    }
    if (url.pathname === '/' || url.pathname.startsWith('/assets/')) return serveStatic(req, res, url);
    res.writeHead(404, { 'content-type': 'text/plain' });
    return res.end('not found\n');
  });
}

if (require.main === module) {
  const server = createServer();
  server.listen(port, () => console.log(`listening on :${port}, version ${version}, elasticsearch ${process.env.ELASTICSEARCH_URL ? 'configured' : 'NOT configured'}`));

  // Exit cleanly when Kubernetes stops the pod, so rollouts don't drop requests.
  process.on('SIGTERM', () => server.close(() => process.exit(0)));
}

module.exports = { createServer };
