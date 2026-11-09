import { cards, defaultProfile, identities, findCard } from './fixtures.mjs';

export const STORAGE_KEY = 'fowpy-demo-v1';
export const freshState = () => ({
  profiles: Object.fromEntries(identities.map(({ id }) => [id, { ...defaultProfile }])),
  swipes: {},
  buddies: {},
  joins: {},
  drafts: {},
});

export function parseState(raw) {
  if (raw === null) return freshState();
  const state = JSON.parse(raw);
  const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
  if (!isRecord(state) || !['profiles', 'swipes', 'buddies', 'joins', 'drafts'].every((key) => isRecord(state[key]))) {
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
      || Object.values(state.drafts).some((value) => typeof value !== 'string')) {
    throw new Error('Stored demo actions are invalid. Reset the demo to continue.');
  }
  return state;
}

export const actionKey = (actor, type, id) => `${actor}:${type}:${id}`;
export const isSaved = (state, actor, card) => state.swipes[actionKey(actor, card.type, card.id)] === 'right';
export const isMatched = (state, actor, id) =>
  state.swipes[actionKey(actor, 'people', id)] === 'right'
  && state.swipes[actionKey(id, 'people', actor)] === 'right';

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
