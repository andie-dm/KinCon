// A tiny conference schedule service. Replace it with your own app: keep
// listening on $PORT and keep /healthz and /readyz, and the manifests in
// deploy/ keep working.
const http = require('node:http');
const { Client } = require('@elastic/elasticsearch');

const port = Number(process.env.PORT || 8080);
const team = process.env.TEAM_NAME || 'kincon';
const version = process.env.APP_VERSION || 'dev';
const searchIndex = process.env.ELASTICSEARCH_INDEX || 'conference-sessions';

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
    const indexExists = await searchClient.indices.exists({ index: searchIndex });
    if (!indexExists) {
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
        const errorType = error.meta?.body?.error?.type;
        if (errorType !== 'resource_already_exists_exception') {
          throw error;
        }
      }
    }

    const result = await searchClient.bulk({
      index: searchIndex,
      refresh: 'wait_for',
      operations: sessions.flatMap((session) => [
        { create: { _id: `fowpy-seed-${session.id}` } },
        session,
      ]),
    });

    if (result.errors) {
      const failures = result.items
        .map((item) => item.create?.error)
        .filter(Boolean);
      const unexpectedFailures = failures.filter(
        (error) => error.type !== 'version_conflict_engine_exception',
      );
      if (unexpectedFailures.length > 0) {
        console.error(
          `Elasticsearch bulk indexing had ${unexpectedFailures.length} failures:`,
          unexpectedFailures[0].reason,
        );
        return;
      }
      console.log(`Elasticsearch seed sessions already existed in index ${searchIndex}`);
      return;
    }

    console.log(`indexed ${sessions.length} sessions in Elasticsearch index ${searchIndex}`);
  } catch (error) {
    console.error('Elasticsearch initialization failed:', error.message);
  }
}

async function searchSessions(query) {
  if (!searchClient) {
    return { status: 503, body: { error: 'Elasticsearch is not configured' } };
  }

  try {
    const response = await searchClient.search({
      index: searchIndex,
      query: {
        multi_match: {
          query,
          fields: ['title^2', 'room', 'time'],
        },
      },
      size: 20,
    });

    return {
      status: 200,
      body: {
        query,
        sessions: response.hits.hits.map((hit) => hit._source),
      },
    };
  } catch (error) {
    console.error('Elasticsearch search failed:', error.message);
    return { status: 502, body: { error: 'Elasticsearch search failed' } };
  }
}

const server = http.createServer((req, res) => {
  let url;
  try {
    url = new URL(req.url, 'http://localhost');
  } catch {
    res.writeHead(400, { 'content-type': 'text/plain' });
    return res.end('bad request\n');
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

  if (url.pathname === '/') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    const rows = sessions.map((s) => `<li>${s.time} · ${s.room} · ${s.title}</li>`).join('');
    return res.end(`<!doctype html><title>${team}</title><h1>${team}</h1><p>version ${version}</p><ul>${rows}</ul>`);
  }

  res.writeHead(404, { 'content-type': 'text/plain' });
  res.end('not found\n');
});

server.listen(port, () => {
  console.log(`listening on :${port}, version ${version}`);
  initializeSearchIndex();
});

// Exit cleanly when Kubernetes stops the pod, so rollouts don't drop requests or telemetry.
const shutdown = () => server.close(async () => {
  await globalThis.otelShutdown?.();
  process.exit(0);
});
process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
