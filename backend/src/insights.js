'use strict';

const db = require('./db');

/**
 * Daily insights pass — runs at 3am, after the main ingest cron.
 * For each profile:
 *   1. Check if a session occurred today
 *   2. If yes: aggregate tag engagement, write insights, apply decay to untouched behavior tags
 *   3. If no: write a "no session" insight, skip decay
 */
async function runDailyInsightsPass() {
  const profiles = db.getProfiles();
  const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

  console.log(`[Insights] Starting daily pass for ${profiles.length} profiles (${today})`);

  for (const profile of profiles) {
    const hadSession = db.profileHadSessionToday(profile.id, today);

    if (!hadSession) {
      db.insertProfileInsight(profile.id, 'No session today', 'watch_behavior');
      console.log(`[Insights] ${profile.name}: no session, skipping decay`);
      continue;
    }

    // Aggregate tag stats for today's watch activity
    const tagStats = db.getTagStatsByDay(profile.id, today);

    for (const stat of tagStats) {
      const pct = Math.round((stat.avg_completion || 0) * 100);
      const insight = `Watched ${stat.completed}/${stat.total} ${stat.tag} videos (avg ${pct}% completion)`;
      db.insertProfileInsight(profile.id, insight, 'watch_behavior');
    }

    // Apply decay to behavior tags not engaged with today
    db.applyDecayToProfile(profile.id, today);

    console.log(`[Insights] ${profile.name}: ${tagStats.length} tag groups, decay applied`);
  }

  console.log('[Insights] Daily pass complete');
}

module.exports = { runDailyInsightsPass };
