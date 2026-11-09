const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('@elastic/elasticsearch');

const port = Number(process.env.PORT || 8080);
const team = process.env.TEAM_NAME || 'kincon';
const version = process.env.APP_VERSION || 'dev';
const staticRoot = path.join(__dirname, 'dist');
const searchIndex = process.env.ELASTICSEARCH_INDEX || 'conference-sessions';
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

const elasticsearchUrl = process.env.ELASTICSEARCH_URL;
const elasticsearchApiKey = process.env.ELASTICSEARCH_API_KEY;
const searchClient = elasticsearchUrl && elasticsearchApiKey
  ? new Client({ node: elasticsearchUrl, auth: { apiKey: elasticsearchApiKey }, requestTimeout: 5000 })
  : null;

async function initializeSearchIndex() {
  if (!searchClient) {
    console.warn('Elasticsearch is not configured; session search is unavailable');
    return;
  }
  try {
    if (!await searchClient.indices.exists({ index: searchIndex })) {
      try {
        await searchClient.indices.create({
          index: searchIndex,
          mappings: {
            properties: {
              id: { type: 'integer' },
              time: { type: 'keyword' },
              room: { type: 'keyword' },
              title: { type: 'text' },
            },
          },
        });
      } catch (error) {
        if (error.meta?.body?.error?.type !== 'resource_already_exists_exception') throw error;
      }
    }
    const result = await searchClient.bulk({
      index: searchIndex,
      refresh: 'wait_for',
      operations: sessions.flatMap((session) => [{ index: { _id: String(session.id) } }, session]),
    });
    if (result.errors) {
      const failures = result.items.map((item) => item.index?.error).filter(Boolean);
      console.error(`Elasticsearch bulk indexing had ${failures.length} failures:`, failures[0]?.reason);
      return;
    }
    console.log(`indexed ${sessions.length} sessions in Elasticsearch index ${searchIndex}`);
  } catch (error) {
    console.error('Elasticsearch initialization failed:', error.message);
  }
}

async function searchSessions(query) {
  if (!searchClient) return { status: 503, body: { error: 'Elasticsearch is not configured' } };
  try {
    const response = await searchClient.search({
      index: searchIndex,
      query: { multi_match: { query, fields: ['title^2', 'room', 'time'] } },
      size: 20,
    });
    return {
      status: 200,
      body: { query, sessions: response.hits.hits.map((hit) => hit._source) },
    };
  } catch (error) {
    console.error('Elasticsearch search failed:', error.message);
    return { status: 502, body: { error: 'Elasticsearch search failed' } };
  }
}

function createServer() {
  return http.createServer((req, res) => {
    let url;
    try {
      url = new URL(req.url, 'http://localhost');
    } catch {
      res.writeHead(400, { 'content-type': 'text/plain' });
      return res.end('bad request\n');
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { 'content-type': 'text/plain', allow: 'GET, HEAD' });
      return res.end('method not allowed\n');
    }
    if (url.pathname === '/healthz' || url.pathname === '/readyz') {
      res.writeHead(200, { 'content-type': 'text/plain' });
      return res.end('ok\n');
    }
    if (url.pathname === '/api/sessions') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ version, sessions }));
    }
    if (url.pathname === '/api/sessions/search') {
      const query = url.searchParams.get('q')?.trim();
      if (!query) {
        res.writeHead(400, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ error: 'The q query parameter is required' }));
      }
      return searchSessions(query).then(({ status, body }) => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(body));
      });
    }
    if (url.pathname === '/' || url.pathname.startsWith('/assets/')) {
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
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found\n');
  });
}

if (require.main === module) {
  const server = createServer();
  server.listen(port, () => {
    console.log(`listening on :${port}, version ${version}`);
    initializeSearchIndex();
  });
  const shutdown = () => server.close(async () => {
    await globalThis.otelShutdown?.();
    process.exit(0);
  });
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
}

module.exports = { createServer };
