const { getEnrichmentRatio } = require('../src/dietMonitor');
const C = require('../src/feedConstants');

// Build a stub db where `watched` is the recent-id list and `gamingSet` are gaming ids.
function stub(watched, gamingSet) {
  return {
    getRecentWatchedVideoIds: () => watched,
    getGamingVideoIds: (ids) => ids.filter(id => gamingSet.has(id)),
  };
}

test('baseline ratio when signal is below threshold', () => {
  // 10 watched, 5 gaming (0.5 < 0.60 threshold)
  const watched = Array.from({ length: 10 }, (_, i) => 'v' + i);
  const gaming = new Set(watched.slice(0, 5));
  const r = getEnrichmentRatio(6, stub(watched, gaming));
  expect(r.gamingFraction).toBeCloseTo(0.5);
  expect(r.ratio).toBeCloseTo(C.ENRICHMENT_BASELINE);
});

test('escalates toward ENRICHMENT_MAX as gaming approaches 100%', () => {
  const watched = Array.from({ length: 10 }, (_, i) => 'v' + i);
  const allGaming = new Set(watched);
  const r = getEnrichmentRatio(6, stub(watched, allGaming));
  expect(r.gamingFraction).toBeCloseTo(1.0);
  expect(r.ratio).toBeCloseTo(C.ENRICHMENT_MAX);
});

test('midpoint (0.80) is halfway up the ramp', () => {
  const watched = Array.from({ length: 10 }, (_, i) => 'v' + i);
  const gaming = new Set(watched.slice(0, 8)); // 0.80 = midpoint of [0.60,1.0]
  const r = getEnrichmentRatio(6, stub(watched, gaming));
  const expected = C.ENRICHMENT_BASELINE + 0.5 * (C.ENRICHMENT_MAX - C.ENRICHMENT_BASELINE);
  expect(r.ratio).toBeCloseTo(expected);
});

test('insufficient tagged signal returns baseline', () => {
  const watched = ['a', 'b', 'c']; // 3 tagged < DIET_MIN_TAGGED (5)
  const r = getEnrichmentRatio(6, stub(watched, new Set(watched)));
  expect(r.ratio).toBeCloseTo(C.ENRICHMENT_BASELINE);
  expect(r.taggedCount).toBe(3);
});
