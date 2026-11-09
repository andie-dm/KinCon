// AAAI-25 replay networking API. Keeps the starter contract: listens on
// $PORT and serves /healthz and /readyz, so the manifests in deploy/ keep working.
const http = require('node:http');
const { client } = require('./lib/es');
const { createService, HttpError } = require('./lib/service');
const { DEMO_SESSIONS } = require('./lib/config');

const port = Number(process.env.PORT || 8080);
const team = process.env.TEAM_NAME || 'your-team';
const version = process.env.APP_VERSION || 'dev';

const es = client();
const svc = es ? createService(es) : null;

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers });
  res.end(JSON.stringify(body));
}

function cookies(req) {
  return Object.fromEntries((req.headers.cookie || '').split(';').map((c) => c.trim().split('=')).filter((p) => p.length === 2));
}

// The actor comes only from the server-side demo session cookie.
function actorOf(req) {
  const id = DEMO_SESSIONS[cookies(req).demo_session];
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

const routes = [
  ['POST', /^\/api\/demo\/session$/, async (req, res) => {
    const { identity } = await readJson(req);
    if (!DEMO_SESSIONS[identity]) throw new HttpError(400, `identity must be one of ${Object.keys(DEMO_SESSIONS).join(', ')}`);
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
  ['GET', /^\/api\/feed$/, async (req, res, m, url) => {
    const q = Object.fromEntries(url.searchParams);
    send(res, 200, await svc.feed(actorOf(req), q));
  }],
  ['PUT', /^\/api\/swipes\/(paper|person|group)\/([^/]+)$/, async (req, res, m, url) => {
    const actor = actorOf(req);
    const body = await readJson(req);
    const out = await svc.swipe(actor, m[1], decodeURIComponent(m[2]), body.direction, { paperId: body.paperId, occurrenceId: body.occurrenceId });
    const deck = { paper: 'research', person: 'people', group: 'groups' }[m[1]];
    const feedQuery = m[1] === 'person' && body.paperId ? { deck, paperId: body.paperId } : { deck };
    out.feed = await svc.feed(actor, feedQuery);
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

const server = http.createServer(async (req, res) => {
  let url;
  try {
    url = new URL(req.url, 'http://localhost');
  } catch {
    return send(res, 400, { error: 'bad request' });
  }
  if (url.pathname === '/healthz') {
    res.writeHead(200, { 'content-type': 'text/plain' });
    return res.end('ok\n');
  }
  if (url.pathname === '/readyz') {
    // Not configured yet: stay ready (static pages work) so a rollout cannot stall
    // waiting for the Secret; /api routes answer 503 until it exists.
    if (!es) return send(res, 200, { ready: true, elasticsearch: 'not configured' });
    try {
      await es.info();
      return send(res, 200, { ready: true });
    } catch (e) {
      return send(res, 503, { ready: false, reason: `elasticsearch unreachable (${e.status || e.code || 'error'})` });
    }
  }
  if (url.pathname === '/') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    return res.end(`<!doctype html><title>${team}</title><h1>AAAI-25 replay</h1><p>version ${version}. API under /api; UI pending.</p>`);
  }
  for (const [method, re, handler] of routes) {
    const m = url.pathname.match(re);
    if (!m || req.method !== method) continue;
    if (!svc) return send(res, 503, { error: 'ELASTICSEARCH_URL not configured' });
    try {
      return await handler(req, res, m, url);
    } catch (e) {
      if (e instanceof HttpError) return send(res, e.status, { error: e.message });
      console.error(`${req.method} ${url.pathname} failed: ${e.message}`);
      return send(res, 502, { error: 'upstream search error' });
    }
  }
  send(res, 404, { error: 'not found' });
});

server.listen(port, () => console.log(`listening on :${port}, version ${version}, elasticsearch ${es ? 'configured' : 'NOT configured'}`));

// Exit cleanly when Kubernetes stops the pod, so rollouts don't drop requests.
process.on('SIGTERM', () => server.close(() => process.exit(0)));
