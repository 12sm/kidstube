#!/usr/bin/env node
// backend/scripts/backfill-llm.js

const db = require('../src/db');
const { runLlmCheck } = require('../src/llm');
const { buildCombinedProfile } = require('../src/childProfile');

db.migrate();
const rawDb = db.getDb();

const DELAY_MS = 1200;
const SOFT_KEYWORDS = ['die', 'death', 'scary', 'violence'];

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function runBatchA(childProfile) {
  console.log('\n=== BATCH A: Tag approved videos with no tags ===');

  const videos = rawDb.prepare(`
    SELECT v.video_id, v.title, v.description, v.transcript, v.duration_seconds, v.channel_id
    FROM videos v
    WHERE v.status = 'approved'
      AND NOT EXISTS (SELECT 1 FROM video_tags vt WHERE vt.video_id = v.video_id)
    ORDER BY v.published_at DESC
  `).all();

  console.log(`Found ${videos.length} videos to tag.`);
  if (videos.length === 0) return;

  let tagged = 0, rejected = 0, errors = 0;

  for (let i = 0; i < videos.length; i++) {
    const video = videos[i];
    try {
      const result = await runLlmCheck(video, { childProfile });

      if (result.approved) {
        if (result.tags && result.tags.length > 0) {
          db.insertVideoTags(video.video_id, result.tags);
          tagged++;
        }
      } else {
        rawDb.prepare(`UPDATE videos SET status='rejected', rejection_reason=? WHERE video_id=?`)
          .run(`LLM: ${result.reason || 'Content not appropriate'}`, video.video_id);
        rejected++;
        console.log(`  FLIP→REJECTED [${video.video_id}] ${(video.title || '').slice(0, 60)}`);
      }

      if ((i + 1) % 50 === 0) {
        console.log(`  Progress: ${i + 1}/${videos.length} (tagged=${tagged} flipped_rejected=${rejected} errors=${errors})`);
      }
    } catch (err) {
      errors++;
      console.error(`  ERROR [${video.video_id}]: ${err.message}`);
    }

    if (i < videos.length - 1) await sleep(DELAY_MS);
  }

  console.log(`Batch A complete: ${videos.length} processed, ${tagged} tagged, ${rejected} flipped to rejected, ${errors} errors`);
}

async function runBatchB(childProfile) {
  console.log('\n=== BATCH B: Re-evaluate soft-keyword rejected videos ===');

  const placeholders = SOFT_KEYWORDS.map(() => '?').join(', ');
  const videos = rawDb.prepare(`
    SELECT v.video_id, v.title, v.description, v.transcript, v.duration_seconds, v.channel_id,
           v.rejection_reason
    FROM videos v
    WHERE v.status = 'rejected'
      AND v.rejection_reason IN (${placeholders})
  `).all(...SOFT_KEYWORDS.map(k => `Keyword: "${k}"`));

  const pending = videos.filter(v => !v.rejection_reason.startsWith('LLM:'));
  console.log(`Found ${videos.length} soft-keyword rejections, ${pending.length} not yet re-evaluated.`);
  if (pending.length === 0) return;

  let approved = 0, kept = 0, errors = 0;

  for (let i = 0; i < pending.length; i++) {
    const video = pending[i];
    try {
      const result = await runLlmCheck(video, { childProfile });

      if (result.approved) {
        rawDb.prepare(`UPDATE videos SET status='approved', rejection_reason=NULL WHERE video_id=?`)
          .run(video.video_id);
        if (result.tags && result.tags.length > 0) {
          db.insertVideoTags(video.video_id, result.tags);
        }
        approved++;
        console.log(`  FLIP→APPROVED [${video.video_id}] ${(video.title || '').slice(0, 60)}`);
      } else {
        rawDb.prepare(`UPDATE videos SET rejection_reason=? WHERE video_id=?`)
          .run(`LLM: ${result.reason || video.rejection_reason}`, video.video_id);
        kept++;
      }
    } catch (err) {
      errors++;
      console.error(`  ERROR [${video.video_id}]: ${err.message}`);
    }

    if (i < pending.length - 1) await sleep(DELAY_MS);
  }

  console.log(`Batch B complete: ${approved} flipped to approved, ${kept} kept rejected, ${errors} errors`);
}

async function main() {
  const childProfile = buildCombinedProfile(db);
  console.log('Child profile preview:', childProfile.slice(0, 150) + (childProfile.length > 150 ? '...' : ''));

  const batchArg = process.argv[2];

  if (!batchArg || batchArg === 'a') await runBatchA(childProfile);
  if (!batchArg || batchArg === 'b') await runBatchB(childProfile);

  console.log('\nDone.');
}

main().catch(err => { console.error(err); process.exit(1); });
