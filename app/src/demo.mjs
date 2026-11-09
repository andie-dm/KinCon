import { cards, defaultProfile, identities, findCard } from './fixtures.mjs';

export const STORAGE_KEY = 'fowpy-demo-v1';

// Fictional people who have already tapped Interested on a demo identity, so a
// fresh demo has requests waiting to accept or decline. Their intro note is
// the first chat message, visible once the request is accepted.
export const SEEDED_REQUESTS = [
  { from: 'sam', to: 'alex', at: '2025-03-01T11:42:00-05:00', note: "Hi Alex! First AAAI for me too. I'd love a buddy for the robotics posters at 12:30." },
  { from: 'maya', to: 'alex', at: '2025-03-01T11:48:00-05:00', note: 'Saw you work on imitation learning. Happy to compare notes on getting policies working outside the lab.' },
  { from: 'leo', to: 'alex', at: '2025-03-01T11:55:00-05:00', note: 'Flow matching question for you: has it actually sped up inference in your experiments?' },
  { from: 'elle', to: 'jules', at: '2025-03-01T11:50:00-05:00', note: "Hey Jules, I'm into visual foresight. Want to check out the robot manipulation posters together?" },
];

const conversationOf = (a, b) => [a, b].sort().join('|');

export const freshState = () => ({
  profiles: Object.fromEntries(identities.map(({ id }) => [id, { ...defaultProfile }])),
  swipes: Object.fromEntries(SEEDED_REQUESTS.map(({ from, to }) => [`${from}:people:${to}`, 'right'])),
  buddies: {},
  joins: {},
  drafts: {},
  responses: {},
  messages: Object.fromEntries(SEEDED_REQUESTS.map(({ from, to, at, note }) => [conversationOf(from, to), [{ from, body: note, at }]])),
  seededRequests: true,
});

// Demo data saved before the dummy requests existed gets them once; anything
// already answered or written keeps its value.
function addSeededRequests(state) {
  if (state.seededRequests) return state;
  const swipes = { ...state.swipes };
  const messages = { ...state.messages };
  for (const { from, to, at, note } of SEEDED_REQUESTS) {
    swipes[`${from}:people:${to}`] ??= 'right';
    messages[conversationOf(from, to)] ??= [{ from, body: note, at }];
  }
  return { ...state, swipes, messages, seededRequests: true };
}

export const MAX_MESSAGE_LENGTH = 1000;

export function parseState(raw) {
  if (raw === null) return freshState();
  const state = JSON.parse(raw);
  const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
  // Demo data saved before chat existed has no responses/messages yet.
  if (isRecord(state)) {
    state.responses ??= {};
    state.messages ??= {};
  }
  if (!isRecord(state) || !['profiles', 'swipes', 'buddies', 'joins', 'drafts', 'responses', 'messages'].every((key) => isRecord(state[key]))) {
    throw new Error('Stored demo data is invalid. Reset the demo to continue.');
  }
  for (const { id } of identities) {
    const profile = state.profiles[id];
    if (!isRecord(profile) || !Object.keys(defaultProfile).every((key) => typeof profile[key] === 'string')) {
      throw new Error('Stored demo profile is invalid. Reset the demo to continue.');
    }
  }
  if (Object.values(state.swipes).some((value) => !['left', 'right'].includes(value))
      || Object.values(state.buddies).some((value) => typeof value !== 'boolean')
      || Object.values(state.joins).some((value) => typeof value !== 'boolean')
      || Object.values(state.drafts).some((value) => typeof value !== 'string')
      || Object.values(state.responses).some((value) => !['accepted', 'rejected'].includes(value))
      || Object.values(state.messages).some((thread) => !Array.isArray(thread) || thread.some((message) =>
        !isRecord(message) || typeof message.from !== 'string' || typeof message.body !== 'string' || typeof message.at !== 'string'))) {
    throw new Error('Stored demo actions are invalid. Reset the demo to continue.');
  }
  return addSeededRequests(state);
}

export const actionKey = (actor, type, id) => `${actor}:${type}:${id}`;
export const isSaved = (state, actor, card) => state.swipes[actionKey(actor, card.type, card.id)] === 'right';

// "Interested" on a person is a visible chat request. The recipient is notified
// and accepts or declines; two people who are both interested are connected
// without a separate acceptance.
const interested = (state, from, to) => state.swipes[actionKey(from, 'people', to)] === 'right';

export function requestStatus(state, sender, recipient) {
  if (!interested(state, sender, recipient)) return 'none';
  if (interested(state, recipient, sender)) return 'accepted';
  const response = state.responses[actionKey(recipient, 'people', sender)];
  // The sender only learns "not accepted", never a reason.
  return response === 'accepted' ? 'accepted' : response === 'rejected' ? 'not_accepted' : 'pending';
}

export const isMatched = (state, actor, id) =>
  requestStatus(state, actor, id) === 'accepted' || requestStatus(state, id, actor) === 'accepted';

// Pending requests other people sent to this actor, oldest first.
export function incomingRequests(state, actor) {
  return Object.keys(state.swipes)
    .map((key) => key.split(':'))
    .filter(([from, type, to]) => type === 'people' && to === actor && from !== actor)
    .map(([from]) => from)
    .filter((from) => requestStatus(state, from, actor) === 'pending');
}

export function respond(state, actor, sender, decision) {
  if (!['accepted', 'rejected'].includes(decision)) throw new Error('Invalid response.');
  if (requestStatus(state, sender, actor) !== 'pending') return state;
  return { ...state, responses: { ...state.responses, [actionKey(actor, 'people', sender)]: decision } };
}

export const conversationKey = conversationOf;
export const conversation = (state, a, b) => state.messages[conversationKey(a, b)] || [];

export function sendMessage(state, actor, other, body, at = new Date().toISOString()) {
  if (!isMatched(state, actor, other)) throw new Error('You can chat once your request is accepted.');
  const text = String(body ?? '').trim();
  if (!text) throw new Error('Write a message first.');
  if (text.length > MAX_MESSAGE_LENGTH) throw new Error(`Messages are limited to ${MAX_MESSAGE_LENGTH} characters.`);
  const key = conversationKey(actor, other);
  return { ...state, messages: { ...state.messages, [key]: [...conversation(state, actor, other), { from: actor, body: text, at }] } };
}

export function swipe(state, actor, card, direction) {
  if (!['left', 'right'].includes(direction)) throw new Error('Invalid swipe direction.');
  const key = actionKey(actor, card.type, card.id);
  // A retry never changes the original action or counts as another signal.
  if (state.swipes[key]) return state;
  return { ...state, swipes: { ...state.swipes, [key]: direction } };
}

export function affinity(state, actor) {
  const scores = {};
  Object.entries(state.swipes).filter(([key]) => key.startsWith(`${actor}:`)).slice(-20).forEach(([key, direction]) => {
    const [, type, id] = key.split(':');
    findCard(type, id)?.tags.forEach((tag) => {
      scores[tag] = (scores[tag] || 0) + (direction === 'right' ? 1 : -0.25);
    });
  });
  return Object.fromEntries(Object.entries(scores).map(([tag, value]) => [tag, Math.max(-2, Math.min(3, value))]));
}

export function feed(state, actor, deck, format = 'All', paperId = null) {
  const profile = state.profiles[actor];
  const topics = `${profile.offers},${profile.asks}`.toLowerCase();
  const scores = affinity(state, actor);
  return cards.filter((card) =>
    card.type === deck
    && card.id !== actor
    && card.available !== false
    && (deck !== 'people' || card.optedIn)
    && !state.swipes[actionKey(actor, deck, card.id)]
    && (deck !== 'research' || format === 'All' || card.format === format)
  ).map((card, index, eligible) => {
    const shared = card.tags.filter((tag) => topics.includes(tag.toLowerCase()));
    const topicAffinity = card.tags.reduce((sum, tag) => sum + (scores[tag] || 0), 0) / card.tags.length;
    const buddy = paperId && state.buddies[actionKey(actor, 'research', paperId)]
      && state.buddies[actionKey(card.id, 'research', paperId)];
    const peer = deck === 'people' && profile.preference === 'Peers at my stage'
      && card.stage === identities.find(({ id }) => id === actor)?.stage;
    const score = (eligible.length - index) / eligible.length + shared.length * 0.18
      + topicAffinity * 0.12 + (buddy ? 2 : 0) + (peer ? 0.2 : 0);
    let reason = shared.length
      ? `You're exploring ${shared[0].toLowerCase()}. ${deck === 'people' ? `${card.title.split(' ')[0]} shares that interest.` : deck === 'groups' ? 'So is this little group.' : 'Follow that curiosity here.'}`
      : 'A fresh perspective, just outside your usual research circle.';
    if (buddy) reason = 'You both explicitly opened buddy discovery for this poster.';
    if (deck === 'people' && !buddy && paperId) reason += ' Shared poster interest is not confirmed.';
    return { ...card, reason, score };
  }).sort((a, b) => b.score - a.score);
}

export function introFor(state, actor, person) {
  const key = actionKey(actor, 'people', person.id);
  return state.drafts[key] ?? `Hey ${person.title.split(' ')[0]}, I'm also exploring ${person.tags[0].toLowerCase()}. I can help with ${state.profiles[actor].offers.toLowerCase()} and would love to hear about your work. Want to check out a poster together?`;
}
