// Reads a profile's recent watch history and returns a target enrichment ratio:
// baseline by default, escalating as the recent diet skews all-gaming.
const C = require('./feedConstants');

function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }

function getEnrichmentRatio(profileId, dbModule = require('./db')) {
  const watched = dbModule.getRecentWatchedVideoIds(profileId, C.DIET_WINDOW);
  const windowSize = watched.length;

  // taggedCount: how many of the window videos carry at least one tag.
  // The stub used in tests has no countTaggedVideos; fall back to windowSize then.
  const taggedCount = dbModule.countTaggedVideos
    ? dbModule.countTaggedVideos(watched)
    : windowSize;

  if (taggedCount < C.DIET_MIN_TAGGED) {
    return { ratio: C.ENRICHMENT_BASELINE, gamingFraction: 0, windowSize, taggedCount };
  }

  const gamingCount = dbModule.getGamingVideoIds(watched).length;
  const denom = taggedCount || 1;
  const gamingFraction = gamingCount / denom;

  let ratio = C.ENRICHMENT_BASELINE;
  if (gamingFraction > C.MONOTONY_THRESHOLD) {
    const t = (gamingFraction - C.MONOTONY_THRESHOLD) / (1 - C.MONOTONY_THRESHOLD);
    ratio = C.ENRICHMENT_BASELINE + t * (C.ENRICHMENT_MAX - C.ENRICHMENT_BASELINE);
  }
  ratio = clamp(ratio, C.ENRICHMENT_BASELINE, C.ENRICHMENT_MAX);

  return { ratio, gamingFraction, windowSize, taggedCount };
}

module.exports = { getEnrichmentRatio };
