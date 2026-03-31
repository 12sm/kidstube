'use strict';

const db = require('./db');
const Anthropic = require('@anthropic-ai/sdk');
const childProfile = require('./childProfile');

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

/**
 * Weekly consolidation pass — runs Sunday at 4am.
 * For each profile with unconsolidated insights:
 *   1. Read current child profile + all unconsolidated insights
 *   2. Ask Haiku to update the profile based on observations
 *   3. Save updated profile, mark insights consolidated
 *   4. Refresh parent-source interest tags from new profile
 */
async function runWeeklyConsolidationPass() {
  const profiles = db.getProfiles();
  console.log(`[Consolidation] Starting weekly pass for ${profiles.length} profiles`);

  for (const profile of profiles) {
    const insights = db.getUnconsolidatedInsights(profile.id);
    if (insights.length === 0) {
      console.log(`[Consolidation] ${profile.name}: no unconsolidated insights, skipping`);
      continue;
    }

    const profileRow   = db.getChildProfile(profile.id);
    const currentMd    = profileRow?.markdown || '';
    const insightLines = insights.map(i => `- ${i.insight} (${i.source})`).join('\n');

    let updatedMd = currentMd;

    if (process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_API_KEY.includes('placeholder')) {
      try {
        const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
        const response = await client.messages.create({
          model:      'claude-haiku-4-5',
          max_tokens: 400,
          system: `You update child profiles for a kids' content recommendation system.
Return ONLY the updated profile text — no preamble, no explanation, no markdown headers.
Keep it under 150 words. Promote confirmed patterns, strengthen existing interests, remove things that are no longer true.
If no current profile exists, write a new one from the observations.`,
          messages: [{
            role: 'user',
            content: `Current profile:\n${currentMd || '(none yet)'}\n\nRecent observations:\n${insightLines}\n\nReturn the updated profile.`,
          }],
        });
        updatedMd = (response.content[0]?.text || currentMd).trim();
      } catch (err) {
        console.error(`[Consolidation] Haiku call failed for ${profile.name}:`, err.message);
      }
    }

    db.saveChildProfile(profile.id, updatedMd, 'consolidation');
    db.markInsightsConsolidated(profile.id);
    await childProfile.refreshParentInterests(profile.id, updatedMd).catch(() => {});

    console.log(`[Consolidation] ${profile.name}: profile updated, ${insights.length} insights consolidated`);
  }

  console.log('[Consolidation] Weekly pass complete');
}

module.exports = { runDailyInsightsPass, runWeeklyConsolidationPass };
