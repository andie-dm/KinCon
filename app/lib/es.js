// Minimal Elasticsearch REST client on Node's built-in fetch.
// Settings: ELASTICSEARCH_URL and ELASTICSEARCH_API_KEY (ELASTIC_API_KEY also accepted; from a Kubernetes Secret in
// the cluster). Credentials are never logged or returned to clients.
'use strict';

class ESError extends Error {
  constructor(status, body) {
    const reason = body && body.error ? (body.error.reason || body.error.type) : String(body).slice(0, 200);
    super(`Elasticsearch HTTP ${status}: ${reason}`);
    this.status = status;
    this.body = body;
  }
}

function client({ url = process.env.ELASTICSEARCH_URL, apiKey = process.env.ELASTICSEARCH_API_KEY || process.env.ELASTIC_API_KEY } = {}) {
  if (!url) return null;
  const base = url.replace(/\/+$/, '');
  const headers = { 'content-type': 'application/json' };
  if (apiKey) headers.authorization = `ApiKey ${apiKey}`;

  async function request(method, path, body, { ok = [200, 201], query, timeoutMs = 15000 } = {}) {
    const qs = query ? '?' + new URLSearchParams(query).toString() : '';
    const res = await fetch(base + path + qs, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await res.text();
    let parsed;
    try { parsed = text ? JSON.parse(text) : {}; } catch { parsed = text; }
    if (!ok.includes(res.status)) throw new ESError(res.status, parsed);
    return parsed;
  }

  const enc = encodeURIComponent;
  return {
    request,
    info: ({ timeoutMs } = {}) => request('GET', '/', undefined, { timeoutMs }),
    // GET by id is real-time: it sees a just-indexed document before refresh.
    get: async (index, id) => {
      const r = await request('GET', `/${index}/_doc/${enc(id)}`, undefined, { ok: [200, 404] });
      return r.found ? r : null;
    },
    mget: (index, ids, source) => request('POST', `/${index}/_mget`, { ids }, source ? { query: { _source_includes: source.join(',') } } : {}),
    search: (index, body) => request('POST', `/${index}/_search`, body),
    update: (index, id, body, query = {}) => request('POST', `/${index}/_update/${enc(id)}`, body, { query }),
  };
}

module.exports = { client, ESError };
