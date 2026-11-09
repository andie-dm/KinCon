'use strict';
// Pure ranking functions (unit-tested in app/test/ranking.test.js).

const AFFINITY_WINDOW = 20;
const RIGHT = 1;
const LEFT = -0.25;
const CLAMP = [-2, 3];
const AFFINITY_WEIGHT = 0.12;

// swipes: [{target_id, direction, effective_at, target_tags}] — one per target
// (action IDs are deterministic), so "latest 20 distinct" = latest 20 docs.
function topicAffinity(swipes) {
  const latest = [...swipes]
    .sort((a, b) => String(b.effective_at).localeCompare(String(a.effective_at)))
    .filter((s, i, arr) => arr.findIndex((t) => t.target_id === s.target_id) === i)
    .slice(0, AFFINITY_WINDOW);
  const aff = {};
  for (const s of latest) {
    const delta = s.direction === 'right' ? RIGHT : s.direction === 'left' ? LEFT : 0;
    for (const tag of new Set(s.target_tags || [])) aff[tag] = (aff[tag] || 0) + delta;
  }
  for (const t of Object.keys(aff)) aff[t] = Math.min(CLAMP[1], Math.max(CLAMP[0], aff[t]));
  return aff;
}

// Retrieval order -> percentile in [0, 1]; best = 1, worst = 0.
// A single candidate gets 1. Ties are impossible: RRF returns a strict order.
function rankPercentile(index, n) {
  return n <= 1 ? 1 : 1 - index / (n - 1);
}

// Mean affinity over the card's tags; a card with no tags (or only unseen tags)
// contributes 0, so it keeps its retrieval percentile.
function meanAffinity(tags, aff) {
  if (!tags || !tags.length) return 0;
  return tags.reduce((s, t) => s + (aff[t] || 0), 0) / tags.length;
}

function rerank(candidates, aff) {
  const n = candidates.length;
  return candidates
    .map((c, i) => {
      const pct = rankPercentile(i, n);
      const m = meanAffinity(c.tags, aff);
      return { ...c, rank: { retrieval_index: i, percentile: +pct.toFixed(4), mean_affinity: +m.toFixed(4), score: +(pct + AFFINITY_WEIGHT * m).toFixed(4) } };
    })
    .sort((a, b) => b.rank.score - a.rank.score || a.rank.retrieval_index - b.rank.retrieval_index);
}

// "broaden": every 4th slot goes to the best adjacent card — one that shares
// at least one familiar tag and adds at least one unfamiliar tag.
function reserveAdjacent(ranked, viewerTags) {
  const familiar = new Set(viewerTags || []);
  const isAdj = (c) => (c.tags || []).some((t) => familiar.has(t)) && (c.tags || []).some((t) => !familiar.has(t));
  const pool = ranked.filter(isAdj);
  const rest = ranked.filter((c) => !isAdj(c));
  const out = [];
  while (pool.length || rest.length) {
    if ((out.length + 1) % 4 === 0 && pool.length) out.push({ ...pool.shift(), adjacent: true });
    else if (rest.length) out.push(rest.shift());
    else out.push({ ...pool.shift(), adjacent: true });
  }
  return out;
}

module.exports = { topicAffinity, rankPercentile, meanAffinity, rerank, reserveAdjacent, AFFINITY_WEIGHT, AFFINITY_WINDOW };
