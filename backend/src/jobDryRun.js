'use strict';

const db = require('./db');

const HAIKU_INPUT_COST  = 0.80 / 1_000_000;
const HAIKU_OUTPUT_COST = 4.00 / 1_000_000;

function calcCost(inputTokens, outputTokens) {
  return (inputTokens * HAIKU_INPUT_COST) + (outputTokens * HAIKU_OUTPUT_COST);
}

function dryRunNightly() {
  const raw = db.getDb();

  const channelsByProfile = raw.prepare(`
    SELECT p.name as profileName, COUNT(c.id) as cnt
    FROM channels c
    JOIN profiles p ON p.id = c.profile_id
    WHERE c.whitelisted = 1
    GROUP BY c.profile_id
  `).all();

  const totalChannels  = channelsByProfile.reduce((sum, r) => sum + r.cnt, 0);
  const needsLlmReview = raw.prepare(
    `SELECT COUNT(*) as cnt FROM videos WHERE needs_llm_review = 1`
  ).get().cnt;

  const estimatedNewVideos  = totalChannels * 2;
  const estimatedLlmCalls   = Math.min(estimatedNewVideos, 300) + needsLlmReview;
  const estimatedInputTokens  = estimatedLlmCalls * 2000;
  const estimatedOutputTokens = estimatedLlmCalls * 150;

  return {
    job: 'nightly',
    counts: { channelsByProfile, totalChannels, needsLlmReview, estimatedNewVideos },
    estimatedCalls: estimatedLlmCalls,
    estimatedInputTokens,
    estimatedOutputTokens,
    estimatedCostUsd: calcCost(estimatedInputTokens, estimatedOutputTokens),
  };
}

function dryRunChannelAudit() {
  const raw = db.getDb();

  const channelsByProfile = raw.prepare(`
    SELECT p.name as profileName, COUNT(c.id) as cnt
    FROM channels c
    JOIN profiles p ON p.id = c.profile_id
    GROUP BY c.profile_id
  `).all();

  const totalChannels = channelsByProfile.reduce((sum, r) => sum + r.cnt, 0);
  const totalBatches  = Math.ceil(totalChannels / 10);
  const estimatedInputTokens  = totalBatches * 2500;
  const estimatedOutputTokens = totalBatches * 300;

  return {
    job: 'channel-audit',
    counts: { channelsByProfile, totalChannels, totalBatches },
    estimatedCalls: totalBatches,
    estimatedInputTokens,
    estimatedOutputTokens,
    estimatedCostUsd: calcCost(estimatedInputTokens, estimatedOutputTokens),
  };
}

function dryRunBackfillTag() {
  const raw = db.getDb();

  const videoCount = raw.prepare(`
    SELECT COUNT(*) as cnt FROM videos v
    WHERE v.status = 'approved'
      AND NOT EXISTS (SELECT 1 FROM video_tags vt WHERE vt.video_id = v.video_id)
  `).get().cnt;

  const estimatedInputTokens  = videoCount * 2000;
  const estimatedOutputTokens = videoCount * 150;

  return {
    job: 'backfill-tag',
    counts: { videoCount },
    estimatedCalls: videoCount,
    estimatedInputTokens,
    estimatedOutputTokens,
    estimatedCostUsd: calcCost(estimatedInputTokens, estimatedOutputTokens),
  };
}

function dryRunBackfillReeval() {
  const raw = db.getDb();

  const SOFT_KEYWORDS = ['die', 'death', 'scary', 'violence'];
  const placeholders  = SOFT_KEYWORDS.map(() => '?').join(', ');

  const videoCount = raw.prepare(`
    SELECT COUNT(*) as cnt FROM videos
    WHERE status = 'rejected'
      AND rejection_reason IN (${placeholders})
  `).get(...SOFT_KEYWORDS.map(k => `Keyword: "${k}"`)).cnt;

  const estimatedInputTokens  = videoCount * 2000;
  const estimatedOutputTokens = videoCount * 100;

  return {
    job: 'backfill-reeval',
    counts: { videoCount },
    estimatedCalls: videoCount,
    estimatedInputTokens,
    estimatedOutputTokens,
    estimatedCostUsd: calcCost(estimatedInputTokens, estimatedOutputTokens),
  };
}

module.exports = {
  dryRunNightly,
  dryRunChannelAudit,
  dryRunBackfillTag,
  dryRunBackfillReeval,
};
