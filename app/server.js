// Conference networking API. Keep /healthz and /readyz stable for Kubernetes.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { createStore } = require('./store');
const { sessions } = require('./seed-data');

const port = Number(process.env.PORT || 8080);
const team = process.env.TEAM_NAME || 'kincon';
const version = process.env.APP_VERSION || 'dev';
const staticRoot = path.join(__dirname, 'dist');
const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
};
const store = createStore();
const allowInsecureIdentity = process.env.ALLOW_INSECURE_DEMO_IDENTITY === 'true';
const demoTokens = new Map(
  (process.env.DEMO_SESSION_TOKENS || '')
    .split(',')
    .map((entry) => {
      const trimmed = entry.trim();
      const separator = trimmed.indexOf('=');
      return separator > 0
        ? [trimmed.slice(0, separator), trimmed.slice(separator + 1)]
        : [];
    })
    .filter(([id, token]) => id && token),
);
let storeReady = false;
let storeFailure = null;

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

function serveStatic(req, res, pathname) {
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(pathname);
  } catch {
    res.writeHead(400, { 'content-type': 'text/plain' });
    return res.end('bad path\n');
  }
  if (decodedPath.includes('\0')) {
    res.writeHead(400, { 'content-type': 'text/plain' });
    return res.end('bad path\n');
  }
  const file = path.resolve(staticRoot, decodedPath === '/' ? 'index.html' : `.${decodedPath}`);
  if (!file.startsWith(`${staticRoot}${path.sep}`)) {
    res.writeHead(404, { 'content-type': 'text/plain' });
    return res.end('not found\n');
  }
  return fs.readFile(file, (error, content) => {
    if (error) {
      const missingBuild = decodedPath === '/' && error.code === 'ENOENT';
      const status = missingBuild ? 503 : error.code === 'ENOENT' || error.code === 'EISDIR' ? 404 : 500;
      if (status !== 404) console.error(`Static UI request failed: ${error.message}`);
      res.writeHead(status, { 'content-type': 'text/plain' });
      return res.end(missingBuild ? 'UI build missing. Run npm run build first.\n' : 'unable to serve asset\n');
    }
    res.writeHead(200, {
      'content-type': contentTypes[path.extname(file)] || 'application/octet-stream',
      'cache-control': decodedPath === '/' ? 'no-cache' : 'public, max-age=31536000, immutable',
      'x-content-type-options': 'nosniff',
    });
    res.end(req.method === 'HEAD' ? undefined : content);
  });
}

function viewerId(req) {
  if (allowInsecureIdentity) {
    const header = req.headers['x-demo-user'];
    if (typeof header === 'string' && header.trim()) return header.trim();
  }
  const authorization = req.headers.authorization;
  const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : '';
  for (const [id, expectedToken] of demoTokens) {
    if (token === expectedToken) return id;
  }
  const error = new Error('a valid demo session token is required');
  error.statusCode = 401;
  throw error;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 100_000) {
        reject(Object.assign(new Error('request body is too large'), { statusCode: 413 }));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(Object.assign(new Error('request body must be valid JSON'), { statusCode: 400 }));
      }
    });
    req.on('error', reject);
  });
}

function actionId(actorId, targetType, targetId, action) {
  return [actorId, targetType, targetId, action].map(encodeURIComponent).join(':');
}

async function actionsFor(actorId) {
  return store.search(store.indexes.actions, { term: { actor_id: actorId } });
}

function swipedIds(actions, targetType) {
  const latest = latestSwipes(actions);
  return new Set(
    latest
      .filter((action) => action.target_type === targetType)
      .map((action) => action.target_id),
  );
}

function latestSwipes(actions) {
  const latest = new Map();
  for (const action of actions.filter((item) => ['left', 'right'].includes(item.action))) {
    const key = `${action.target_type}:${action.target_id}`;
    const previous = latest.get(key);
    if (!previous || new Date(action.created_at) > new Date(previous.created_at)) {
      latest.set(key, action);
    }

  }
  return [...latest.values()].sort((left, right) => new Date(right.created_at) - new Date(left.created_at));
}

async function hasCurrentRight(actorId, targetId) {
  const actions = latestSwipes(await actionsFor(actorId));
  return actions.some(
    (action) => action.action === 'right'
      && action.target_type === 'person'
      && action.target_id === targetId,
  );
}

function tagsOf(profile) {
  return new Set([...(profile?.tags || []), ...(profile?.offers || []), ...(profile?.asks || [])]);
}

function overlap(left, right) {
  return [...left].filter((tag) => right.has(tag));
}

function reasonFor(viewer, candidate, deck, paperId) {
  if (deck === 'people' && paperId && candidate.shared_paper_ids?.includes(paperId)) {
    return 'You both opted into finding a buddy for this poster.';
  }
  const shared = overlap(tagsOf(viewer), tagsOf(candidate));
  if (shared.length > 0) return `You both mentioned ${shared[0]}.`;
  if (deck === 'groups') return `A hosted meetup about ${candidate.topic}.`;
  return 'This attendee has a compatible conversation profile.';
}

function researchCard(paper) {
  const occurrences = paper.occurrences || [];
  return {
    id: paper.id,
    type: 'research',
    title: paper.title,
    subtitle: paper.authors?.length ? paper.authors.join(', ') : 'AAAI-25 replay',
    reason: paper.tags?.length ? `You may enjoy ${paper.tags[0]}.` : 'Recommended from the conference corpus.',
    tags: paper.tags || [],
    evidence: paper.paper_url ? [{ label: 'Paper', url: paper.paper_url }] : [],
    occurrences,
  };
}

function personCard(viewer, person, paperId) {
  return {
    id: person.id,
    type: 'person',
    title: person.name,
    subtitle: `${person.stage} attendee`,
    reason: reasonFor(viewer, person, 'people', paperId),
    tags: person.tags || [],
    evidence: person.evidence || [],
    occurrences: [],
    offers: person.offers || [],
    asks: person.asks || [],
    conversation_preferences: person.conversation_preferences || [],
  };
}

function groupCard(viewer, group) {
  return {
    id: group.id,
    type: 'group',
    title: group.title,
    subtitle: group.conversation_style,
    reason: reasonFor(viewer, group, 'groups'),
    tags: group.tags || [],
    evidence: group.evidence || [],
    occurrences: [{
      start: group.meeting_time,
      room: group.meeting_point,
    }],
    meeting_time: group.meeting_time,
    meeting_point: group.meeting_point,
  };
}

async function feed(req, url) {
  const actorId = viewerId(req);
  const deck = url.searchParams.get('deck') || 'research';
  const paperId = url.searchParams.get('paperId') || null;
  const viewer = await store.get(store.indexes.people, actorId);
  if (!viewer) return { status: 404, body: { error: 'demo attendee was not found' } };

  const actions = await actionsFor(actorId);
  const targetType = deck === 'research' ? 'paper' : deck === 'people' ? 'person' : 'group';
  const hidden = swipedIds(actions, targetType);
  const queryText = url.searchParams.get('q')?.trim();
  let candidates;

  if (deck === 'research') {
    candidates = await store.search(
      store.indexes.sessions,
      {
        bool: {
          must: queryText
            ? [{ multi_match: { query: queryText, fields: ['title^2', 'abstract', 'tags'] } }]
            : [{ match_all: {} }],
          filter: [{ term: { main_track: true } }],
        },
      },
    );
  } else if (deck === 'people') {
    const must = [{ term: { discovery_opt_in: true } }];
    if (paperId) must.push({ term: { shared_paper_ids: paperId } });
    const stage = url.searchParams.get('stage');
    if (stage === 'peers' || viewer.conversation_preferences?.includes('peers at my stage')) {
      must.push({ term: { stage: viewer.stage } });
    }
    candidates = await store.search(store.indexes.people, {
      bool: { must, must_not: [{ term: { id: actorId } }] },
    });
  } else if (deck === 'groups') {
    candidates = await store.search(store.indexes.groups, { match_all: {} });
  } else {
    return { status: 400, body: { error: 'deck must be research, people, or groups' } };
  }

  const affinity = new Map();
  for (const action of latestSwipes(actions).slice(0, 20)) {
    const index = action.target_type === 'paper'
      ? store.indexes.sessions
      : action.target_type === 'person'
        ? store.indexes.people
        : store.indexes.groups;
    const target = await store.get(index, action.target_id);
    const delta = action.action === 'right' ? 1 : -0.25;
    for (const tag of target?.tags || []) {
      affinity.set(tag, Math.max(-2, Math.min(3, (affinity.get(tag) || 0) + delta)));
    }
  }

  candidates = candidates
    .filter((candidate) => !hidden.has(candidate.id))
    .sort((left, right) => {
      const score = (candidate) => {
        const values = (candidate.tags || []).map((tag) => affinity.get(tag) || 0);
        const meanAffinity = values.length
          ? values.reduce((total, value) => total + value, 0) / values.length
          : 0;
        return (candidate.score || 0) + (0.12 * meanAffinity);
      };
      return score(right) - score(left);
    })
    .slice(0, 30);

  const cards = candidates.map((candidate) => {
    if (deck === 'research') return researchCard(candidate);
    if (deck === 'people') return personCard(viewer, candidate, paperId);
    return groupCard(viewer, candidate);
  });
  return { status: 200, body: { deck, cards } };
}

function introDraft(viewer, person, paper) {
  const topic = paper?.title || person.tags?.[0] || 'the conference';
  return `Hey ${person.name}, I’m also interested in ${topic}. Want to check it out together?`;
}

async function swipe(req, type, id) {
  const actorId = viewerId(req);
  const body = await readBody(req);
  if (!['left', 'right'].includes(body.direction)) {
    return { status: 400, body: { error: 'direction must be left or right' } };
  }

  const targetType = ['paper', 'papers'].includes(type)
    ? 'paper'
    : type === 'people'
      ? 'person'
      : ['group', 'groups'].includes(type)
        ? 'group'
        : null;
  if (!targetType) return { status: 400, body: { error: 'type must be paper, papers, people, group, or groups' } };

  const target = await store.get(
    targetType === 'paper' ? store.indexes.sessions : targetType === 'person' ? store.indexes.people : store.indexes.groups,
    id,
  );
  if (!target) return { status: 404, body: { error: 'target was not found' } };

  const swipeId = actionId(actorId, targetType, id, 'swipe');
  await store.put(store.indexes.actions, swipeId, {
    id: swipeId,
    actor_id: actorId,
    action: body.direction,
    target_type: targetType,
    target_id: id,
    created_at: new Date().toISOString(),
  });
  await Promise.all([
    store.remove(store.indexes.actions, actionId(actorId, targetType, id, 'left')),
    store.remove(store.indexes.actions, actionId(actorId, targetType, id, 'right')),
  ]);

  let matched = false;
  let draft = null;
  if (targetType === 'person' && body.direction === 'right') {
    matched = await hasCurrentRight(id, actorId);
    draft = introDraft(await store.get(store.indexes.people, actorId), target);
  }

  const nextDeck = targetType === 'paper' ? 'research' : targetType === 'person' ? 'people' : 'groups';
  const nextFeed = await feed(req, new URL(`/api/feed?deck=${nextDeck}`, 'http://localhost'));
  return {
    status: 200,
    body: { saved: body.direction === 'right', matched, draft, feed: nextFeed.body.cards },
  };
}

async function explicitAction(req, type, id, action) {
  const actorId = viewerId(req);
  const index = type === 'paper' ? store.indexes.sessions : store.indexes.groups;
  if (!await store.get(index, id)) return { status: 404, body: { error: 'target was not found' } };
  const idempotentId = actionId(actorId, type, id, action);
  await store.put(store.indexes.actions, idempotentId, {
    id: idempotentId,
    actor_id: actorId,
    action,
    target_type: type,
    target_id: id,
    created_at: new Date().toISOString(),
  });
  return { status: 200, body: { id, action, saved: true } };
}

async function saved(req) {
  const actorId = viewerId(req);
  const actions = await actionsFor(actorId);
  const currentSwipes = latestSwipes(actions);
  const rightPeople = currentSwipes.filter((action) => action.action === 'right' && action.target_type === 'person');
  const matches = [];
  for (const action of rightPeople) {
    if (await hasCurrentRight(action.target_id, actorId)) {
      const person = await store.get(store.indexes.people, action.target_id);
      matches.push({ ...personCard(await store.get(store.indexes.people, actorId), person), draft: introDraft(await store.get(store.indexes.people, actorId), person) });
    }
  }

  const research = [];
  const groupsSaved = [];
  for (const action of [
    ...currentSwipes,
    ...actions.filter((item) => item.action === 'join' || item.action === 'buddy'),
  ]) {
    if (action.target_type === 'paper') {
      const paper = await store.get(store.indexes.sessions, action.target_id);
      if (paper) research.push(researchCard(paper));
    }
    if (action.target_type === 'group') {
      const group = await store.get(store.indexes.groups, action.target_id);
      if (group) groupsSaved.push(groupCard({}, group));
    }
  }
  return { status: 200, body: { research: research.filter(Boolean), groups: groupsSaved.filter(Boolean), people: matches } };
}

async function handle(req, res) {
  const url = new URL(req.url, 'http://localhost');
  if (req.method !== 'GET' && req.method !== 'HEAD'
    && ['/healthz', '/readyz', '/api/sessions'].includes(url.pathname)) {
    res.writeHead(405, { 'content-type': 'text/plain', allow: 'GET, HEAD' });
    return res.end('method not allowed\n');
  }
  if (url.pathname === '/healthz' || url.pathname === '/readyz') {
    const ready = url.pathname === '/healthz' || storeReady;
    res.writeHead(ready ? 200 : 503, { 'content-type': 'text/plain' });
    return res.end(ready ? 'ok\n' : `not ready: ${storeFailure || 'Elasticsearch initialization is pending'}\n`);
  }
  if ((url.pathname === '/' || url.pathname.startsWith('/assets/'))
    && req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { 'content-type': 'text/plain', allow: 'GET, HEAD' });
    return res.end('method not allowed\n');
  }
  if ((url.pathname === '/' || url.pathname.startsWith('/assets/'))
    && (req.method === 'GET' || req.method === 'HEAD')) {
    return serveStatic(req, res, url.pathname);
  }
  if (!url.pathname.startsWith('/api/')) return json(res, 404, { error: 'not found' });
  if (req.method === 'GET' && url.pathname === '/api/sessions') {
    if (!storeReady) return json(res, 200, { version, sessions });
    const records = await store.search(store.indexes.sessions, { match_all: {} });
    return json(res, 200, { version, sessions: records });
  }
  if (!storeReady) {
    return json(res, 503, { error: storeFailure || 'Elasticsearch initialization is pending' });
  }
  if (req.method === 'GET' && url.pathname === '/api/sessions/search') {
    const query = url.searchParams.get('q')?.trim();
    if (!query) return json(res, 400, { error: 'The q query parameter is required' });
    const records = await store.search(store.indexes.sessions, {
      bool: {
        must: [{ multi_match: { query, fields: ['title^2', 'abstract', 'tags'] } }],
        filter: [{ term: { main_track: true } }],
      },
    });
    return json(res, 200, { query, sessions: records });
  }
  if (req.method === 'GET' && url.pathname === '/api/feed') return json(res, ...(Object.values(await feed(req, url))));
  if (req.method === 'GET' && url.pathname === '/api/me/saved') return json(res, ...(Object.values(await saved(req))));
  if (req.method === 'PUT' && url.pathname === '/api/me') {
    const body = await readBody(req);
    const id = viewerId(req);
    const profile = await store.update(store.indexes.people, id, { ...body, id, discovery_opt_in: true });
    return json(res, 200, profile);
  }

  const swipeMatch = req.method === 'PUT' && url.pathname.match(/^\/api\/swipes\/(papers?|people|groups?)\/([^/]+)$/);
  if (swipeMatch) return json(res, ...(Object.values(await swipe(req, swipeMatch[1], decodeURIComponent(swipeMatch[2])))));
  const buddyMatch = req.method === 'PUT' && url.pathname.match(/^\/api\/papers\/([^/]+)\/buddy$/);
  if (buddyMatch) return json(res, ...(Object.values(await explicitAction(req, 'paper', decodeURIComponent(buddyMatch[1]), 'buddy'))));
  const joinMatch = req.method === 'PUT' && url.pathname.match(/^\/api\/groups\/([^/]+)\/join$/);
  if (joinMatch) return json(res, ...(Object.values(await explicitAction(req, 'group', decodeURIComponent(joinMatch[1]), 'join'))));
  return json(res, 404, { error: 'not found' });
}

function createServer() {
  return http.createServer((req, res) => {
    handle(req, res).catch((error) => {
      console.error('request failed:', error.message);
      json(res, error.statusCode || 500, { error: error.statusCode ? error.message : 'internal server error' });
    });
  });
}

async function initializeWithRetry() {
  for (let attempt = 1; ; attempt += 1) {
    try {
      await store.initialize();
      storeReady = true;
      storeFailure = null;
      console.log('Elasticsearch initialization succeeded');
      return;
    } catch (error) {
      storeFailure = error.message;
      console.error(`Elasticsearch initialization attempt ${attempt} failed:`, error.message);
      await new Promise((resolve) => setTimeout(resolve, Math.min(attempt * 1000, 30000)));
    }
  }
}

if (require.main === module) {
  const server = createServer();
  server.listen(port, () => {
    console.log(`listening on :${port}, version ${version}`);
    initializeWithRetry();
  });

  const shutdown = () => server.close(async () => {
    await globalThis.otelShutdown?.();
    process.exit(0);
  });
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
}

module.exports = { createServer };
