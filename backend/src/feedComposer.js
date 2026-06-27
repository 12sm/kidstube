// Interleaves a scored feed pool to hit a target enrichment ratio, with a
// growth guarantee, per-channel cap, and gaming backfill. Pure function.
const { GROWTH_MIN_PER_PAGE } = require('./feedConstants');

function composeFeed(pool, opts) {
  const {
    ratio,
    limit,
    isGaming,
    isGrowth,
    perChannelCap = 2,
    growthMinPerPage = GROWTH_MIN_PER_PAGE,
  } = opts;

  // Partition, preserving input (score) order.
  const gaming = [];
  const growth = [];
  const alternatives = [];
  for (const v of pool) {
    if (isGaming(v)) gaming.push(v);
    else if (isGrowth(v)) growth.push(v);
    else alternatives.push(v);
  }

  const enrichmentSlots = Math.round(limit * ratio);

  // Build the enrichment pick list: guaranteed growth first, then alternatives,
  // then any leftover growth — each in score order.
  const guaranteedGrowth = growth.slice(0, Math.min(growthMinPerPage, enrichmentSlots));
  const remainingGrowth = growth.slice(guaranteedGrowth.length);
  const enrichmentPicks = [...guaranteedGrowth, ...alternatives, ...remainingGrowth]
    .slice(0, enrichmentSlots);

  // Interleave: walk the page positions, placing an enrichment pick at evenly
  // spaced slots, gaming otherwise. Channel cap applied as we go; if a pick is
  // capped out, fall through to the other bucket.
  const result = [];
  const channelCount = new Map();
  let ei = 0;
  const canPlace = (v) => (channelCount.get(v.channel_id) || 0) < perChannelCap;
  const place = (v) => {
    result.push(v);
    channelCount.set(v.channel_id, (channelCount.get(v.channel_id) || 0) + 1);
  };
  const nextFrom = (arr, idxRef) => {
    while (idxRef.i < arr.length) {
      const v = arr[idxRef.i++];
      if (canPlace(v)) return v;
    }
    return null;
  };
  const gRef = { i: 0 }, eRef = { i: 0 };

  const enrichStride = enrichmentPicks.length > 0 ? limit / enrichmentPicks.length : Infinity;
  for (let pos = 0; pos < limit; pos++) {
    const wantEnrich = enrichmentPicks.length > 0 &&
      ei < enrichmentPicks.length &&
      Math.floor(pos / enrichStride) >= ei;
    let v = null;
    if (wantEnrich) { v = nextFrom(enrichmentPicks, eRef); if (v) ei++; }
    if (!v) { v = nextFrom(gaming, gRef); }
    if (!v) { v = nextFrom(enrichmentPicks, eRef); if (v) ei++; } // enrichment backfill
    if (!v) break; // pool exhausted under channel cap
    place(v);
  }

  // Backfill to a full page from any remaining pool videos (in score order),
  // honoring the channel cap. Prevents a short page when one bucket is
  // channel-capped but other eligible videos remain in the pool.
  if (result.length < limit) {
    const placed = new Set(result.map(v => v.video_id));
    for (const v of pool) {
      if (result.length >= limit) break;
      if (placed.has(v.video_id) || !canPlace(v)) continue;
      place(v);
      placed.add(v.video_id);
    }
  }

  return result;
}

module.exports = { composeFeed };
