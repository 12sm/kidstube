#!/usr/bin/env node
// backend/scripts/audit-channels.js

const Anthropic = require('@anthropic-ai/sdk');
const db = require('../src/db');
const { buildCombinedProfile } = require('../src/childProfile');

db.migrate();
const rawDb = db.getDb();

const BATCH_SIZE = 10;
const DELAY_MS   = 1200;
const PROFILE_IDS = [5, 6];

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function chunkArray(arr, size) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
  return chunks;
}

async function auditBatch(client, channels, childProfile, profileId) {
  const channelList = channels.map((c, i) => {
    let line = `${i + 1}. **${c.channel_name || c.channel_id}** (${c.whitelisted ? 'currently enabled' : 'currently disabled'})`;
    if (c.subscriber_count) line += ` — ${Math.round(c.subscriber_count / 1000)}K subscribers`;
    if (c.description) line += `\n   Description: ${c.description.slice(0, 150)}`;
    return line;
  }).join('\n\n');

  const systemPrompt = `You are reviewing YouTube channels for a kids' content platform. The content policy is:\n\n${childProfile}\n\nFor each channel, decide whether it should be enabled or disabled for this child.`;

  const userMessage = `Review these ${channels.length} YouTube channels. For each one, respond with a JSON recommendation.

Channels:
${channelList}

Respond with ONLY a JSON array (one object per channel, in order):
[
  { "index": 1, "recommendation": "enable", "reason": "brief reason (1 sentence)" },
  { "index": 2, "recommendation": "disable", "reason": "brief reason (1 sentence)" }
]`;

  const response = await client.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 1024,
    system: systemPrompt,
    messages: [{ role: 'user', content: userMessage }]
  });

  const text = response.content[0].text.trim();
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) throw new Error(`Could not parse JSON from response: ${text.slice(0, 200)}`);

  const results = JSON.parse(match[0]);
  let count = 0;
  for (const result of results) {
    const idx = result.index - 1;
    if (idx < 0 || idx >= channels.length) continue;
    const channel = channels[idx];
    db.upsertChannelRecommendation(channel.channel_id, profileId, result.recommendation, result.reason);
    count++;
  }
  return count;
}

async function auditProfile(client, profileId, childProfile) {
  const profileRow = rawDb.prepare('SELECT name FROM profiles WHERE id = ?').get(profileId);
  const profileName = profileRow ? profileRow.name : `Profile ${profileId}`;

  const channels = rawDb.prepare(
    'SELECT channel_id, channel_name, whitelisted, subscriber_count, description FROM channels WHERE profile_id = ? ORDER BY channel_name'
  ).all(profileId);

  console.log(`\n=== ${profileName} (profile ${profileId}): ${channels.length} channels ===`);

  const batches = chunkArray(channels, BATCH_SIZE);
  let totalProcessed = 0;

  for (let i = 0; i < batches.length; i++) {
    try {
      const count = await auditBatch(client, batches[i], childProfile, profileId);
      totalProcessed += count;
      process.stdout.write(`\r  Batch ${i + 1}/${batches.length} done (${totalProcessed} total)`);
    } catch (err) {
      console.error(`\n  Batch ${i + 1} ERROR: ${err.message}`);
    }
    if (i < batches.length - 1) await sleep(DELAY_MS);
  }
  console.log(`\n${profileName}: ${totalProcessed}/${channels.length} channels audited`);
}

async function main() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || apiKey.includes('placeholder') || apiKey.length < 20) {
    console.error('ANTHROPIC_API_KEY is not set or is a placeholder. Aborting.');
    process.exit(1);
  }

  const client = new Anthropic({ apiKey });
  const childProfile = buildCombinedProfile(db);
  console.log('Child profile preview:', childProfile.slice(0, 120) + '...');

  const profileArg = process.argv[2] ? parseInt(process.argv[2], 10) : null;
  const profilesToAudit = profileArg ? [profileArg] : PROFILE_IDS;

  for (let i = 0; i < profilesToAudit.length; i++) {
    await auditProfile(client, profilesToAudit[i], childProfile);
    if (i < profilesToAudit.length - 1) await sleep(2000);
  }

  console.log('\nAudit complete. View results in admin panel > Channel Recommendations.');
}

main().catch(err => { console.error(err); process.exit(1); });
