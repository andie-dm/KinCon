const API_BASE = (typeof import.meta.env !== 'undefined' && import.meta.env.VITE_API_BASE) || '';

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

async function request(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    credentials: 'include',
    headers: { ...(options.body ? { 'content-type': 'application/json' } : {}), ...options.headers },
    ...options,
  });
  const text = await response.text();
  let body = {};
  try { body = text ? JSON.parse(text) : {}; } catch { /* non-json error */ }
  if (!response.ok) throw new ApiError(body.error || `Request failed (${response.status})`, response.status);
  return body;
}

export const api = {
  session: (identity) => request('/api/demo/session', { method: 'POST', body: JSON.stringify({ identity }) }),
  me: () => request('/api/me'),
  updateMe: (profile) => request('/api/me', { method: 'PUT', body: JSON.stringify(profile) }),
  feed: (deck, params = {}) => {
    const query = new URLSearchParams({ deck, ...params });
    return request(`/api/feed?${query}`);
  },
  saved: () => request('/api/me/saved'),
  notifications: () => request('/api/me/notifications'),
  swipe: (type, id, direction, extra = {}) => request(`/api/swipes/${type}/${encodeURIComponent(id)}`, {
    method: 'PUT', body: JSON.stringify({ direction, ...extra }),
  }),
  buddy: (id, occurrenceId) => request(`/api/papers/${encodeURIComponent(id)}/buddy`, {
    method: 'PUT', body: JSON.stringify({ occurrenceId }),
  }),
  join: (id) => request(`/api/groups/${encodeURIComponent(id)}/join`, { method: 'PUT' }),
  respond: (id, decision) => request(`/api/requests/${encodeURIComponent(id)}`, {
    method: 'PUT', body: JSON.stringify({ decision }),
  }),
  opener: (id, opener) => request(`/api/matches/${encodeURIComponent(id)}/opener`, {
    method: 'PUT', body: JSON.stringify({ opener }),
  }),
  messages: (id) => request(`/api/chats/${encodeURIComponent(id)}/messages`),
  sendMessage: (id, body, clientMessageId = `web-${Date.now()}`) => request(`/api/chats/${encodeURIComponent(id)}/messages`, {
    method: 'POST', body: JSON.stringify({ body, clientMessageId }),
  }),
};

function first(value) {
  return Array.isArray(value) ? value.map((item) => typeof item === 'string' ? item : item.name || item.label || '').filter(Boolean).join(', ') : value || '';
}

export function normalizeCard(raw) {
  const type = raw.type === 'paper' ? 'research' : raw.type === 'person' ? 'people' : 'groups';
  const occurrence = raw.occurrences?.[0];
  return {
    ...raw,
    type,
    title: raw.title || raw.display_name || 'Untitled',
    subtitle: raw.subtitle || raw.topic || raw.stage_label || '',
    authors: first(raw.authors) || raw.subtitle || '',
    offers: first(raw.offers),
    asks: first(raw.asks),
    evidence: (raw.evidence || []).map((item) => typeof item === 'string' ? item : item.label || item.title).filter(Boolean),
    tags: raw.tags || [],
    format: occurrence?.format === 'oral' ? 'Oral' : occurrence ? 'Poster' : raw.format,
    occurrences: raw.occurrences || [],
    time: raw.when_label || '',
    place: raw.meeting_point?.label || raw.location_label || null,
    host: raw.host || '',
    color: type === 'people' ? 'peach' : type === 'groups' ? 'mint' : 'mint',
    theme: 'robot',
    summary: raw.description || raw.subtitle || '',
  };
}

export async function loadApp() {
  const identity = await api.session('riley');
  const [profile, research, people, groups, saved, notifications] = await Promise.all([
    api.me(), api.feed('research'), api.feed('people'), api.feed('groups'), api.saved(), api.notifications(),
  ]);
  const cards = [...research.cards, ...people.cards, ...groups.cards].map(normalizeCard);
  const savedCards = [...saved.research, ...saved.groups, ...saved.matches].map(normalizeCard);
  return { identity: identity.identity, profile, cards, saved: savedCards, notifications };
}

export { request };
