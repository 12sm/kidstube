#!/usr/bin/env node
'use strict';

// Re-review search/enrichment videos that are approved but have no review for a
// child yet. Until the review gate existed, these were reviewed by the nightly
// run with childProfile: null ("ages 7-8"), so a 5-year-old's stale approvals
// were never judged for him. Each video is reviewed once per child, against
// that child's own profile, with the same strict prompt as the live gate.
//
// Dry run by default: reports how many approvals would flip, writes nothing.
//
//   node scripts/rereview-search-approvals.js --db /path/to/copy.db [--profile 6] [--limit 50]
//   node scripts/rereview-search-approvals.js --db /path/to/copy.db --apply
//   node scripts/rereview-search-approvals.js --apply --verdicts-from /path/to/copy.db
//
// --apply           write verdicts to video_reviews (a child's rejected video is
//                   then hidden and unplayable for that child) and reject outright
//                   any video every child's review rejected.
// --verdicts-from   reuse the verdicts already produced on a copy instead of
//                   calling the LLM again, so what was reported is what's applied.
// --report <file>   write every verdict as JSON lines.

const path = require('path');
const fs = require('fs');

function parseArgs(argv) {
  const args = { apply: false, concurrency: 4, limit: null, profile: null, db: null, verdictsFrom: null, report: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--apply') args.apply = true;
    else if (a === '--db') args.db = argv[++i];
    else if (a === '--profile') args.profile = parseInt(argv[++i], 10);
    else if (a === '--limit') args.limit = parseInt(argv[++i], 10);
    else if (a === '--concurrency') args.concurrency = parseInt(argv[++i], 10);
    else if (a === '--verdicts-from') args.verdictsFrom = argv[++i];
    else if (a === '--report') args.report = argv[++i];
    else if (a === '--help' || a === '-h') { console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(3, 22).join('\n')); process.exit(0); }
    else { console.error(`Unknown argument: ${a}`); process.exit(2); }
  }
  return args;
}

const args = parseArgs(process.argv);
if (args.db) process.env.DB_PATH = path.resolve(args.db);
try { require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') }); } catch { /* optional */ }

const db = require('../src/db');
const llm = require('../src/llm');
const reviewGate = require('../src/reviewGate');

function candidates(rawDb, profileId) {
  return rawDb.prepare(`
    SELECT v.* FROM videos v
    WHERE v.status = 'approved'
      AND v.video_id IS NOT NULL
      AND (v.discovery_source IN ('search', 'enrichment') OR v.needs_llm_review = 1)
      AND NOT EXISTS (SELECT 1 FROM video_reviews r WHERE r.video_id = v.video_id AND r.profile_id = ?)
    ORDER BY v.video_id
  `).all(profileId);
}

async function reviewAll(videos, profileId, who, concurrency, onResult) {
  let i = 0, done = 0;
  const worker = async () => {
    while (i < videos.length) {
      const video = videos[i++];
      let result;
      try {
        const r = await llm.runLlmReviewStrict(video, {
          childProfile: who.markdown, age: who.age, strict: true, timeoutMs: 30000, maxRetries: 3,
        });
        result = { verdict: r.approved ? 'approved' : 'rejected', reason: r.approved ? null : (r.reason || 'not appropriate'), tags: r.tags };
      } catch (err) {
        result = { verdict: 'error', reason: err.message, tags: [] };
      }
      onResult(video, result);
      if (++done % 100 === 0) console.log(`  profile ${profileId}: ${done}/${videos.length}`);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, videos.length)) }, worker));
}

async function main() {
  const rawDb = db.getDb();
  reviewGate.ensureSchema(db);
  console.log(`DB: ${process.env.DB_PATH || '(default data/kidstube.db)'}  mode: ${args.apply ? 'APPLY' : 'dry run'}`);

  const profiles = db.getProfiles().filter(p => !args.profile || p.id === args.profile);
  const report = args.report ? fs.createWriteStream(args.report) : null;
  const verdicts = new Map(); // video_id -> { profileId: result }
  const summary = {};

  let source = null;
  if (args.verdictsFrom) {
    source = new (require('better-sqlite3'))(path.resolve(args.verdictsFrom), { readonly: true });
  }

  for (const profile of profiles) {
    const who = reviewGate.resolveReviewProfile(db, profile.id);
    let videos = candidates(rawDb, profile.id);
    if (args.limit) videos = videos.slice(0, args.limit);
    const s = summary[profile.id] = {
      name: profile.name, age: who.age, profile_source: who.source,
      reviewed: videos.length, approved: 0, rejected: 0, errors: 0, rejected_and_watched: 0,
    };
    console.log(`\n${profile.name} (profile ${profile.id}): ${videos.length} approved search/enrichment videos without a review; judging for age ${who.age} (${who.source})`);

    const watched = new Set(rawDb.prepare('SELECT video_id FROM watch_history WHERE profile_id = ?').all(profile.id).map(r => r.video_id));
    const record = (video, result) => {
      if (result.verdict === 'approved') s.approved++;
      else if (result.verdict === 'rejected') { s.rejected++; if (watched.has(video.video_id)) s.rejected_and_watched++; }
      else s.errors++;
      if (!verdicts.has(video.video_id)) verdicts.set(video.video_id, {});
      verdicts.get(video.video_id)[profile.id] = result;
      report?.write(JSON.stringify({ video_id: video.video_id, title: video.title, profile_id: profile.id, ...result, watched: watched.has(video.video_id) }) + '\n');
      if (args.apply && result.verdict !== 'error') {
        reviewGate.saveVerdict(db, {
          videoId: video.video_id, profileId: profile.id, verdict: result.verdict, reason: result.reason,
          tags: result.tags, age: who.age, profileSource: result.imported ? 'imported' : who.source,
        });
      }
    };

    if (source) {
      const get = source.prepare('SELECT verdict, reason, tags_json FROM video_reviews WHERE video_id = ? AND profile_id = ?');
      for (const v of videos) {
        const row = get.get(v.video_id, profile.id);
        if (row) record(v, { verdict: row.verdict, reason: row.reason, tags: JSON.parse(row.tags_json || '[]'), imported: true });
        else s.reviewed--; // not in the copy; leave for the play gate / a later run
      }
    } else {
      await reviewAll(videos, profile.id, who, args.concurrency, record);
    }
  }

  // A video every child's review rejected is rejected outright (as the nightly does).
  const allProfileIds = profiles.map(p => p.id);
  let rejectAll = 0;
  const reject = rawDb.prepare("UPDATE videos SET status = 'rejected', rejection_reason = ?, processed_at = CURRENT_TIMESTAMP WHERE video_id = ? AND status = 'approved'");
  const clearPending = rawDb.prepare('UPDATE videos SET needs_llm_review = 0 WHERE video_id = ?');
  const youngest = reviewGate.youngestProfile(db);
  for (const [videoId, byProfile] of verdicts) {
    const rs = allProfileIds.map(id => byProfile[id]).filter(Boolean);
    const complete = rs.length === allProfileIds.length && rs.every(r => r.verdict !== 'error');
    if (!complete || args.profile) continue;
    if (rs.every(r => r.verdict === 'rejected')) {
      rejectAll++;
      if (args.apply) {
        const pick = (youngest && byProfile[youngest.profileId]) || rs[0];
        reject.run(`LLM: ${pick.reason || 'inappropriate content'}`, videoId);
      }
    }
    if (args.apply) clearPending.run(videoId);
  }

  report?.end();
  console.log('\n=== Summary ===');
  for (const [id, s] of Object.entries(summary)) {
    console.log(`${s.name} (profile ${id}, age ${s.age}, ${s.profile_source}): reviewed ${s.reviewed} -> approved ${s.approved}, would flip to rejected ${s.rejected} (${s.rejected_and_watched} already watched), errors ${s.errors}`);
  }
  if (!args.profile) console.log(`Rejected for every child (would be rejected outright): ${rejectAll}`);
  console.log(args.apply ? 'Applied.' : 'Dry run: nothing written. Re-run with --apply to write verdicts.');
  console.log(JSON.stringify({ summary, rejectedForEveryChild: rejectAll }));
}

main().catch(err => { console.error(err); process.exit(1); });
