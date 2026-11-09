const { Client } = require('@elastic/elasticsearch');
const { sessions, people, groups } = require('./seed-data');

const INDEXES = {
  sessions: process.env.ELASTICSEARCH_INDEX || 'conference-papers-2025-v1',
  people: 'conference-people-v1',
  groups: 'conference-groups-v1',
  actions: 'conference-actions-v1',
};

const mappings = {
  [INDEXES.sessions]: {
    properties: {
      id: { type: 'keyword' },
      title: { type: 'text' },
      abstract: { type: 'text' },
      authors: { type: 'text' },
      main_track: { type: 'boolean' },
      tags: { type: 'keyword' },
    },
  },
  [INDEXES.people]: {
    properties: {
      id: { type: 'keyword' },
      name: { type: 'text' },
      stage: { type: 'keyword' },
      discovery_opt_in: { type: 'boolean' },
      offers: { type: 'text' },
      asks: { type: 'text' },
      tags: { type: 'keyword' },
      shared_paper_ids: { type: 'keyword' },
      conversation_preferences: { type: 'keyword' },
    },
  },
  [INDEXES.groups]: {
    properties: {
      id: { type: 'keyword' },
      title: { type: 'text' },
      topic: { type: 'text' },
      host_id: { type: 'keyword' },
      tags: { type: 'keyword' },
      audience: { type: 'keyword' },
      meeting_time: { type: 'keyword' },
      meeting_point: { type: 'keyword' },
    },
  },
  [INDEXES.actions]: {
    properties: {
      id: { type: 'keyword' },
      actor_id: { type: 'keyword' },
      action: { type: 'keyword' },
      target_type: { type: 'keyword' },
      target_id: { type: 'keyword' },
      created_at: { type: 'date' },
    },
  },
};

function createStore({ node = process.env.ELASTICSEARCH_URL, apiKey = process.env.ELASTICSEARCH_API_KEY } = {}) {
  const client = node && apiKey
    ? new Client({ node, auth: { apiKey }, requestTimeout: 5000 })
    : null;

  function requireClient() {
    if (!client) {
      const error = new Error('Elasticsearch is not configured');
      error.statusCode = 503;
      throw error;
    }
    return client;
  }

  async function ensureIndex(index) {
    const elastic = requireClient();
    if (await elastic.indices.exists({ index })) return false;

    try {
      await elastic.indices.create({ index, mappings: mappings[index] });
      return true;
    } catch (error) {
      const errorType = error.meta?.body?.error?.type;
      if (errorType === 'resource_already_exists_exception') return false;
      throw error;
    }
  }

  async function seed(index, documents) {
    const elastic = requireClient();
    const result = await elastic.bulk({
      index,
      refresh: 'wait_for',
      operations: documents.flatMap((document) => [
        { create: { _id: document.id } },
        document,
      ]),
    });
    const failures = result.items
      .map((item) => item.create?.error)
      .filter(Boolean)
      .filter((error) => error.type !== 'version_conflict_engine_exception');
    if (failures.length > 0) {
      throw new Error(`Failed to seed ${index}: ${failures[0].reason}`);
    }
  }

  async function initialize() {
    requireClient();
    const created = await Promise.all(
      Object.values(INDEXES).map(async (index) => [index, await ensureIndex(index)]),
    );
    const createdIndexes = new Map(created);
    await Promise.all([
      createdIndexes.get(INDEXES.sessions) ? seed(INDEXES.sessions, sessions) : null,
      createdIndexes.get(INDEXES.people) ? seed(INDEXES.people, people) : null,
      createdIndexes.get(INDEXES.groups) ? seed(INDEXES.groups, groups) : null,
    ]);
  }

  async function get(index, id) {
    try {
      return (await requireClient().get({ index, id }))._source;
    } catch (error) {
      if (error.meta?.statusCode === 404) return null;
      throw error;
    }
  }

  async function search(index, query, size = 1000) {
    const response = await requireClient().search({ index, query, size });
    return response.hits.hits.map((hit) => ({ ...hit._source, score: hit._score }));
  }

  async function put(index, id, document) {
    await requireClient().index({ index, id, document, refresh: 'wait_for' });
    return document;
  }

  async function update(index, id, document) {
    await requireClient().update({
      index,
      id,
      doc: document,
      doc_as_upsert: true,
      refresh: 'wait_for',
    });
    return get(index, id);
  }

  async function remove(index, id) {
    try {
      await requireClient().delete({ index, id, refresh: 'wait_for' });
    } catch (error) {
      if (error.meta?.statusCode !== 404) throw error;
    }
  }

  return {
    indexes: INDEXES,
    initialize,
    get,
    search,
    put,
    update,
    remove,
  };
}

module.exports = { createStore };
