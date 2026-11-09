'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { topicAffinity, rankPercentile, meanAffinity, rerank, reserveAdjacent } = require('../lib/ranking');

const sw = (id, direction, tags, t) => ({ target_id: id, direction, target_tags: tags, effective_at: `2026-01-01T00:00:${String(t).padStart(2, '0')}Z` });

test('right +1, left -0.25, clamped to [-2, 3]', () => {
  const swipes = [
    ...Array.from({ length: 5 }, (_, i) => sw(`r${i}`, 'right', ['robotics'], i)),
    ...Array.from({ length: 10 }, (_, i) => sw(`l${i}`, 'left', ['llms'], 10 + i)),
    sw('m', 'left', ['robotics'], 30),
  ];
  const aff = topicAffinity(swipes);
  assert.equal(aff.robotics, 3); // 5 - 0.25 = 4.75 -> clamp 3
  assert.equal(aff.llms, -2);    // -2.5 -> clamp -2
});

test('only the latest 20 distinct swipes count; a duplicated target counts once', () => {
  const old = sw('old', 'right', ['nlp'], 0);
  const recent = Array.from({ length: 20 }, (_, i) => sw(`n${i}`, 'left', ['time-series'], 10 + i));
  assert.equal(topicAffinity([old, ...recent]).nlp, undefined);
  const dup = [sw('a', 'right', ['robotics'], 5), sw('a', 'right', ['robotics'], 5)];
  assert.equal(topicAffinity(dup).robotics, 1);
});

test('rank percentile: best 1, worst 0, single candidate 1', () => {
  assert.equal(rankPercentile(0, 5), 1);
  assert.equal(rankPercentile(4, 5), 0);
  assert.equal(rankPercentile(0, 1), 1);
});

test('missing tags contribute zero affinity', () => {
  assert.equal(meanAffinity([], { robotics: 3 }), 0);
  assert.equal(meanAffinity(undefined, { robotics: 3 }), 0);
  assert.equal(meanAffinity(['unseen'], { robotics: 3 }), 0);
});

// Validation 18: two right swipes lift a previously lower-ranked eligible card.
test('two right swipes on a topic move a lower-ranked card up (repeatable fixture)', () => {
  const candidates = [
    { id: 'A', tags: ['llms'] }, { id: 'B', tags: ['recommender-systems'] }, { id: 'C', tags: ['nlp'] },
    { id: 'D', tags: ['robotics'] }, { id: 'E', tags: ['time-series'] }, { id: 'F', tags: ['robotics', 'flow-matching'] },
  ];
  const before = rerank(candidates, topicAffinity([])).map((c) => c.id);
  assert.deepEqual(before, ['A', 'B', 'C', 'D', 'E', 'F']);
  const aff = topicAffinity([sw('x1', 'right', ['robotics'], 1), sw('x2', 'right', ['robotics'], 2)]);
  assert.equal(aff.robotics, 2);
  const after = rerank(candidates, aff).map((c) => c.id);
  // D: pct 0.4 + 0.12*2 = 0.64 > C's 0.6. Retrying the same two swipes changes nothing.
  assert.ok(after.indexOf('D') < before.indexOf('D'), `D should rise: ${after}`);
  assert.deepEqual(rerank(candidates, topicAffinity([sw('x1', 'right', ['robotics'], 1), sw('x1', 'right', ['robotics'], 1), sw('x2', 'right', ['robotics'], 2)])).map((c) => c.id), after);
});

test('broaden reserves every 4th slot for an adjacent card', () => {
  const ranked = rerank([
    { id: 1, tags: ['robotics'] }, { id: 2, tags: ['robotics'] }, { id: 3, tags: ['robotics'] },
    { id: 4, tags: ['robotics'] }, { id: 5, tags: ['robotics', 'ai-for-science'] },
  ], {});
  const out = reserveAdjacent(ranked, ['robotics']);
  assert.equal(out[3].id, 5);
  assert.equal(out[3].adjacent, true);
});
