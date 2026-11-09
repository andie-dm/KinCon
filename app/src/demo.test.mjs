import test from 'node:test';
import assert from 'node:assert/strict';
import { findCard, identities } from './fixtures.mjs';
import { actionKey, affinity, conversation, feed, freshState, incomingRequests, introFor, isMatched, parseState, requestStatus, respond, sendMessage, swipe } from './demo.mjs';

test('passes and saves survive serialization and repeated swipes have one effect', () => {
  const paper = findCard('research', 'flow-skills');
  let state = swipe(freshState(), 'alex', paper, 'left');
  const scores = affinity(state, 'alex');
  assert.equal(swipe(state, 'alex', paper, 'right'), state);
  assert.deepEqual(affinity(state, 'alex'), scores);
  state = parseState(JSON.stringify(state));
  assert.ok(!feed(state, 'alex', 'research').some((card) => card.id === paper.id));
  assert.ok(feed(state, 'jules', 'research').some((card) => card.id === paper.id));
  assert.equal(state.swipes[actionKey('alex', 'research', paper.id)], 'left');
});

test('one-sided interest is not a match; reciprocal interest is', () => {
  let state = swipe(freshState(), 'alex', findCard('people', 'jules'), 'right');
  assert.equal(isMatched(state, 'alex', 'jules'), false);
  assert.equal(isMatched(state, 'jules', 'alex'), false);
  state = swipe(state, 'jules', findCard('people', 'alex'), 'right');
  assert.equal(isMatched(state, 'alex', 'jules'), true);
  assert.equal(isMatched(state, 'jules', 'alex'), true);
  assert.match(introFor(state, 'alex', findCard('people', 'jules')), /^Hey Jules/);
});

test('discovery excludes self and unavailable people and keeps formats separate', () => {
  const state = freshState();
  const people = feed(state, 'alex', 'people');
  assert.ok(!people.some((card) => card.id === 'alex' || card.id === 'dev'));
  assert.ok(people.every((card) => card.optedIn));
  assert.ok(feed(state, 'alex', 'research', 'Oral').every((card) => card.format === 'Oral'));
  assert.ok(feed(state, 'alex', 'research', 'Poster').every((card) => card.format === 'Poster'));
});

test('poster evidence is shared only after explicit buddy action, not a save', () => {
  let state = swipe(freshState(), 'jules', findCard('research', 'flow-skills'), 'right');
  let jules = feed(state, 'alex', 'people', 'All', 'flow-skills').find((card) => card.id === 'jules');
  assert.ok(!jules.reason.includes('both explicitly'));
  state = { ...state, buddies: { [actionKey('jules', 'research', 'flow-skills')]: true } };
  jules = feed(state, 'alex', 'people', 'All', 'flow-skills').find((card) => card.id === 'jules');
  // The viewer must explicitly opt in too, not just the other person.
  assert.ok(!jules.reason.includes('both explicitly'));
  state.buddies[actionKey('alex', 'research', 'flow-skills')] = true;
  assert.match(feed(state, 'alex', 'people', 'All', 'flow-skills')[0].reason, /both explicitly/);
});

test('a saved group is not joined and unconfirmed locations remain unconfirmed', () => {
  const group = findCard('groups', 'cross-field');
  const state = swipe(freshState(), 'alex', group, 'right');
  assert.equal(state.joins[actionKey('alex', 'groups', group.id)], undefined);
  assert.equal(group.place, null);
});

test('two robotics saves increase the rank of an eligible robotics person', () => {
  const initial = freshState();
  initial.profiles.alex = { ...initial.profiles.alex, offers: '', asks: '', preference: 'Any stage' };
  const before = feed(initial, 'alex', 'people').map((card) => card.id);
  let state = swipe(initial, 'alex', findCard('research', 'flow-skills'), 'right');
  state = swipe(state, 'alex', findCard('research', 'robot-foresight'), 'right');
  const after = feed(state, 'alex', 'people').map((card) => card.id);
  assert.ok(after.indexOf('elle') < before.indexOf('elle'));
  assert.equal(affinity(state, 'alex').Robotics, 2);
});

test('malformed storage produces an explicit error and empty storage starts fresh', () => {
  assert.deepEqual(parseState(null), freshState());
  for (const raw of ['{', '{}', 'null', JSON.stringify({ ...freshState(), profiles: { alex: null } }), JSON.stringify({ ...freshState(), swipes: { bad: {} } })]) {
    assert.throws(() => parseState(raw));
  }
});

const blankState = () => ({ ...freshState(), swipes: {}, messages: {} });

test('Interested sends a visible request the recipient can accept to open a chat', () => {
  let state = swipe(blankState(), 'alex', findCard('people', 'jules'), 'right');
  assert.equal(requestStatus(state, 'alex', 'jules'), 'pending');
  assert.deepEqual(incomingRequests(state, 'jules'), ['alex']);
  assert.deepEqual(incomingRequests(state, 'alex'), []);
  assert.throws(() => sendMessage(state, 'alex', 'jules', 'hi'), /accepted/);
  state = respond(state, 'jules', 'alex', 'accepted');
  assert.equal(requestStatus(state, 'alex', 'jules'), 'accepted');
  assert.equal(isMatched(state, 'jules', 'alex'), true);
  assert.deepEqual(incomingRequests(state, 'jules'), []);
  state = sendMessage(state, 'alex', 'jules', '  See you at the poster?  ', '2025-03-01T12:05:00-05:00');
  state = sendMessage(state, 'jules', 'alex', 'Yes! Board 746.', '2025-03-01T12:06:00-05:00');
  state = parseState(JSON.stringify(state));
  assert.deepEqual(conversation(state, 'jules', 'alex').map((m) => [m.from, m.body]),
    [['alex', 'See you at the poster?'], ['jules', 'Yes! Board 746.']]);
});

test('a declined request stays closed and only reads as not accepted', () => {
  let state = swipe(blankState(), 'alex', findCard('people', 'jules'), 'right');
  state = respond(state, 'jules', 'alex', 'rejected');
  assert.equal(requestStatus(state, 'alex', 'jules'), 'not_accepted');
  assert.equal(isMatched(state, 'alex', 'jules'), false);
  assert.deepEqual(incomingRequests(state, 'jules'), []);
  // A later response cannot reopen it, and no chat is possible.
  assert.equal(respond(state, 'jules', 'alex', 'accepted'), state);
  assert.throws(() => sendMessage(state, 'jules', 'alex', 'hi'), /accepted/);
});

test('messages are validated and old saved demos load without chat data', () => {
  let state = swipe(swipe(freshState(), 'alex', findCard('people', 'jules'), 'right'), 'jules', findCard('people', 'alex'), 'right');
  assert.equal(isMatched(state, 'alex', 'jules'), true);
  assert.throws(() => sendMessage(state, 'alex', 'jules', '   '), /Write a message/);
  assert.throws(() => sendMessage(state, 'alex', 'jules', 'x'.repeat(1001)), /limited/);
  const legacy = { ...freshState() };
  delete legacy.responses;
  delete legacy.messages;
  assert.deepEqual(parseState(JSON.stringify(legacy)).messages, {});
  assert.throws(() => parseState(JSON.stringify({ ...freshState(), responses: { x: 'maybe' } })));
  assert.throws(() => parseState(JSON.stringify({ ...freshState(), messages: { x: [{ from: 1 }] } })));
});

test('a fresh demo has dummy requests to accept, decline and open', () => {
  let state = freshState();
  assert.deepEqual(incomingRequests(state, 'alex'), ['sam', 'maya', 'leo']);
  assert.deepEqual(incomingRequests(state, 'jules'), ['elle']);
  // Their note is the first message, readable once accepted.
  state = respond(state, 'alex', 'sam', 'accepted');
  assert.equal(isMatched(state, 'alex', 'sam'), true);
  assert.match(conversation(state, 'alex', 'sam')[0].body, /buddy/);
  state = sendMessage(state, 'alex', 'sam', 'Yes, see you at 12:30!');
  assert.equal(conversation(state, 'alex', 'sam').length, 2);
  state = respond(state, 'alex', 'maya', 'rejected');
  assert.equal(requestStatus(state, 'maya', 'alex'), 'not_accepted');
  assert.deepEqual(incomingRequests(state, 'alex'), ['leo']);
  // Older saved demos pick the requests up once without losing answers.
  const legacy = { ...state, seededRequests: undefined };
  delete legacy.seededRequests;
  const migrated = parseState(JSON.stringify(legacy));
  assert.equal(requestStatus(migrated, 'maya', 'alex'), 'not_accepted');
  assert.equal(conversation(migrated, 'alex', 'sam').length, 2);
  const old = parseState(JSON.stringify({ ...blankState(), seededRequests: undefined }));
  assert.deepEqual(incomingRequests(old, 'alex'), ['sam', 'maya', 'leo']);
});

test('every attendee is playable, so any request can be answered by its recipient', () => {
  assert.equal(identities.length, 12);
  assert.deepEqual(identities.slice(0, 2).map((p) => p.id), ['alex', 'jules']);
  let state = freshState();
  // Alex sends requests to several people who are not Jules.
  for (const id of ['kai', 'tess', 'nia', 'rory']) state = swipe(state, 'alex', findCard('people', id), 'right');
  for (const id of ['kai', 'tess', 'nia', 'rory']) assert.ok(incomingRequests(state, id).includes('alex'), `${id} sees Alex's request`);
  state = respond(state, 'nia', 'alex', 'accepted');
  state = respond(state, 'rory', 'alex', 'rejected');
  assert.equal(isMatched(state, 'alex', 'nia'), true);
  assert.equal(requestStatus(state, 'alex', 'rory'), 'not_accepted');
  state = sendMessage(state, 'nia', 'alex', 'Happy to chat about efficient models!');
  assert.equal(conversation(state, 'alex', 'nia').at(-1).from, 'nia');
  // Each new identity starts from its own card's interests.
  assert.match(state.profiles.nia.offers, /Climate modeling/);
  // A demo saved with only Alex and Jules gains the other profiles on load.
  const legacy = JSON.parse(JSON.stringify(state));
  legacy.profiles = { alex: legacy.profiles.alex, jules: legacy.profiles.jules };
  assert.equal(Object.keys(parseState(JSON.stringify(legacy)).profiles).length, 12);
});
