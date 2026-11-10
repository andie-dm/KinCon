import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCard } from './api.mjs';

test('normalizes backend paper cards to the existing research card shape', () => {
  const card = normalizeCard({
    type: 'paper', id: 'p1', title: 'Paper', subtitle: 'Authors',
    authors: [{ name: 'Riley' }], occurrences: [{ format: 'poster', room: 'Hall E' }],
    tags: ['robotics'], evidence: [{ label: 'Proceedings' }],
  });
  assert.equal(card.type, 'research');
  assert.equal(card.format, 'Poster');
  assert.equal(card.authors, 'Riley');
  assert.deepEqual(card.evidence, ['Proceedings']);
});

test('normalizes people and groups without leaking backend-only shape assumptions', () => {
  const person = normalizeCard({ type: 'person', id: 'p', display_name: 'Jules', stage_label: 'Graduate researcher', offers: ['Python'] });
  assert.equal(person.type, 'people');
  assert.equal(person.stage, 'Graduate researcher');
  const group = normalizeCard({ type: 'group', id: 'g', title: 'Meetup', meeting_point: { label: 'Lobby' } });
  assert.equal(group.type, 'groups');
  assert.equal(group.place, 'Lobby');
});
