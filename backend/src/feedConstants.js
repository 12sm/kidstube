// Central tunables for adaptive feed enrichment. See
// docs/superpowers/specs/2026-06-26-adaptive-feed-enrichment-design.md
module.exports = {
  ENRICHMENT_BASELINE: 0.20,   // min enrichment share of the feed
  ENRICHMENT_MAX:      0.50,   // enrichment share during an all-gaming streak
  MONOTONY_THRESHOLD:  0.60,   // gamingFraction below which ratio stays at baseline
  DIET_WINDOW:         20,     // # recent distinct watched videos examined
  DIET_MIN_TAGGED:     5,      // min tagged videos in window for a valid signal
  GROWTH_MIN_PER_PAGE: 2,      // guaranteed growth-source picks per page when available
  GAMING_TAGS: ['gaming', 'minecraft', 'roblox', 'minecraft-roleplay', 'gaming-challenge'],
};
