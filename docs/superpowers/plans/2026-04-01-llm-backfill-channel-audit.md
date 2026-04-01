# LLM Backfill + Channel Audit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Backfill LLM tags on approved videos, re-evaluate soft-keyword-rejected videos through the LLM, and audit all whitelisted/disabled channels with LLM recommendations surfaced in the admin UI.

**Architecture:** Three one-shot scripts handle data migration (run manually then discard). The `channel_recommendations` table + API endpoints + React component form the permanent channel review system.

**Tech Stack:** Node.js scripts, Anthropic Haiku 4.5, SQLite (better-sqlite3), React + Tailwind

---

### Task 1: Remove soft keywords from filter_rules

**Files:**
- Create: `backend/scripts/remove-soft-keywords.js`

The keyword IDs to remove are: `die` (id=3), `death` (id=5), `scary` (id=6), `violence` (id=2). These are contextual — appear in benign gaming content. `LIVE` (id=7) and `would you rather` (id=4) are **format-based blocks** — keep them.

- [ ] **Step 1: Write the script**

```js
#!/usr/bin/env node
// backend/scripts/remove-soft-keywords.js
// Removes contextual keywords that are better handled by LLM than hard blocks.
// Safe to re-run — DELETE WHERE is idempotent.

const db = require('../src/db');

db.migrate();

const SOFT_KEYWORDS = ['die', 'death', 'scary', 'violence'];

const existing = db.getDb()
  .prepare(`SELECT id, value FROM filter_rules WHERE rule_type='keyword_block' AND value IN (${SOFT_KEYWORDS.map(() => '?').join(',')})`)
  .all(...SOFT_KEYWORDS);

if (existing.length === 0) {
  console.log('No soft keywords found — already removed or never existed.');
  process.exit(0);
}

console.log('Removing soft keywords:');
existing.forEach(r => console.log(`  [${r.id}] ${r.value}`));

db.getDb()
  .prepare(`DELETE FROM filter_rules WHERE rule_type='keyword_block' AND value IN (${SOFT_KEYWORDS.map(() => '?').join(',')})`)
  .run(...SOFT_KEYWORDS);

console.log(`Removed ${existing.length} keyword rule(s).`);
console.log('Remaining keyword rules:');
const remaining = db.getDb().prepare("SELECT id, value FROM filter_rules WHERE rule_type='keyword_block'").all();
remaining.forEach(r => console.log(`  [${r.id}] ${r.value}`));
```

- [ ] **Step 2: Run the script**

```bash
cd /home/michael/projects/kidstube
node backend/scripts/remove-soft-keywords.js
```

Expected output:
```
Removing soft keywords:
  [2] violence
  [3] die
  [5] death
  [6] scary
Removed 4 keyword rule(s).
Remaining keyword rules:
  [4] would you rather
  [7] LIVE
```

- [ ] **Step 3: Commit**

```bash
git add backend/scripts/remove-soft-keywords.js
git commit -m "chore: remove contextual keyword blocks (die, death, scary, violence) — LLM handles these"
```

---

### Task 2: buildCombinedProfile helper + backfill tests

**Files:**
- Modify: `backend/src/childProfile.js` (add `buildCombinedProfile`)
- Create: `backend/tests/backfill.test.js`

`buildCombinedProfile` reads both child profiles and concatenates them with headers. The combined profile is injected as LLM context during backfill so the model sees both kids' needs at once. Child2 (age 5) is the more restrictive baseline.

- [ ] **Step 1: Write failing tests**

```js
// backend/tests/backfill.test.js
const { setupTestDb, teardownTestDb, seedProfile } = require('./helpers/testDb');

let db;
beforeEach(() => {
  db = setupTestDb();
  seedProfile(db, { id: 5, name: 'Child1' });
  seedProfile(db, { id: 6, name: 'Child2' });
});
afterEach(() => teardownTestDb(db));

const { buildCombinedProfile } = require('../src/childProfile');

describe('buildCombinedProfile', () => {
  test('returns generic fallback when no profiles exist', () => {
    const result = buildCombinedProfile(db);
    expect(result).toContain('ages 7-8');
  });

  test('returns single profile when only one exists', () => {
    db.saveChildProfile(5, 'Child1 loves space.');
    const result = buildCombinedProfile(db);
    expect(result).toContain('Child1 loves space.');
    expect(result).not.toContain('## Profile:');
  });

  test('combines both profiles with headers when both exist', () => {
    db.saveChildProfile(5, 'Child1 loves space.');
    db.saveChildProfile(6, 'Child2 loves animals.');
    const result = buildCombinedProfile(db);
    expect(result).toContain('## Profile: Child1');
    expect(result).toContain('Child1 loves space.');
    expect(result).toContain('## Profile: Child2');
    expect(result).toContain('Child2 loves animals.');
  });

  test('returns generic fallback when profiles exist but markdown is empty', () => {
    db.saveChildProfile(5, '');
    db.saveChildProfile(6, '');
    const result = buildCombinedProfile(db);
    expect(result).toContain('ages 7-8');
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd /home/michael/projects/kidstube
DB_PATH=':memory:' npx jest backend/tests/backfill.test.js --no-coverage 2>&1 | tail -20
```

Expected: FAIL — `buildCombinedProfile is not a function`

- [ ] **Step 3: Add `buildCombinedProfile` to childProfile.js**

Read the end of `backend/src/childProfile.js` first, then add before `module.exports`:

```js
function buildCombinedProfile(db) {
  const PROFILE_IDS = [5, 6]; // Child1, Child2
  const profiles = [];

  for (const id of PROFILE_IDS) {
    const row = db.getChildProfile(id);
    if (row && row.markdown && row.markdown.trim()) {
      const profileRow = db.getDb().prepare('SELECT name FROM profiles WHERE id = ?').get(id);
      profiles.push({ name: profileRow ? profileRow.name : `Profile ${id}`, markdown: row.markdown.trim() });
    }
  }

  if (profiles.length === 0) {
    return 'This content is for children ages 7-8. Approve only age-appropriate, educational or entertaining content.';
  }

  if (profiles.length === 1) {
    return profiles[0].markdown;
  }

  return profiles.map(p => `## Profile: ${p.name}\n\n${p.markdown}`).join('\n\n---\n\n');
}
```

Add `buildCombinedProfile` to `module.exports`.

- [ ] **Step 4: Run tests to confirm they pass**

```bash
DB_PATH=':memory:' npx jest backend/tests/backfill.test.js --no-coverage 2>&1 | tail -10
```

Expected: PASS — 4 tests

- [ ] **Step 5: Commit**

```bash
git add backend/src/childProfile.js backend/tests/backfill.test.js
git commit -m "feat: buildCombinedProfile helper — merges both child profiles for backfill LLM context"
```

---

### Task 3: backfill-llm.js script

**Files:**
- Create: `backend/scripts/backfill-llm.js`

Two batches:
- **Batch A**: 888 approved videos with no `video_tags` rows → run LLM → add tags (or flip to rejected)
- **Batch B**: 421 soft-keyword rejected videos (`die`, `death`, `scary`, `violence`) → run LLM → flip to approved with tags or keep rejected

Rate limiting: 1 second between calls. Resumable: Batch A skips videos already in `video_tags`; Batch B skips videos whose `rejection_reason` starts with `LLM:`.

- [ ] **Step 1: Write the script**

```js
#!/usr/bin/env node
// backend/scripts/backfill-llm.js
//
// Batch A: Tag approved videos that have no tags yet.
// Batch B: Re-evaluate soft-keyword-rejected videos through LLM.
//
// Resumable: re-run safely — both batches skip already-processed videos.

const db = require('../src/db');
const { runLlmCheck } = require('../src/llm');
const { buildCombinedProfile } = require('../src/childProfile');

db.migrate();
const rawDb = db.getDb();

const BATCH_SIZE = 10;
const DELAY_MS   = 1200;  // ~50 calls/min — well within Haiku rate limits

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

  let processed = 0, tagged = 0, rejected = 0, errors = 0;

  for (const video of videos) {
    try {
      const result = await runLlmCheck(video, { childProfile });

      if (result.approved) {
        if (result.tags && result.tags.length > 0) {
          db.insertVideoTags(video.video_id, result.tags.map(t => ({ tag: t, weight: 1.0 })));
          tagged++;
        }
      } else {
        // LLM disagrees with prior approval — flip to rejected
        rawDb.prepare(`UPDATE videos SET status='rejected', rejection_reason=? WHERE video_id=?`)
          .run(`LLM: ${result.reason || 'Content not appropriate'}`, video.video_id);
        rejected++;
        console.log(`  FLIP→REJECTED [${video.video_id}] ${video.title.slice(0, 60)}`);
      }

      processed++;
      if (processed % 50 === 0) {
        console.log(`  Progress: ${processed}/${videos.length} (tagged=${tagged} flipped_rejected=${rejected} errors=${errors})`);
      }
    } catch (err) {
      errors++;
      console.error(`  ERROR [${video.video_id}]: ${err.message}`);
    }

    await sleep(DELAY_MS);
  }

  console.log(`Batch A complete: ${processed} processed, ${tagged} tagged, ${rejected} flipped to rejected, ${errors} errors`);
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

  // Resume: skip videos already flipped (rejection_reason starts with 'LLM:' means we already re-evaluated)
  const pending = videos.filter(v => !v.rejection_reason.startsWith('LLM:'));
  console.log(`Found ${videos.length} soft-keyword rejections, ${pending.length} not yet re-evaluated.`);
  if (pending.length === 0) return;

  let approved = 0, kept = 0, errors = 0;

  for (const video of pending) {
    try {
      const result = await runLlmCheck(video, { childProfile });

      if (result.approved) {
        rawDb.prepare(`UPDATE videos SET status='approved', rejection_reason=NULL WHERE video_id=?`)
          .run(video.video_id);
        if (result.tags && result.tags.length > 0) {
          db.insertVideoTags(video.video_id, result.tags.map(t => ({ tag: t, weight: 1.0 })));
        }
        approved++;
        console.log(`  FLIP→APPROVED [${video.video_id}] ${video.title.slice(0, 60)}`);
      } else {
        // Keep rejected, update reason to LLM: prefix to mark as re-evaluated
        rawDb.prepare(`UPDATE videos SET rejection_reason=? WHERE video_id=?`)
          .run(`LLM: ${result.reason || video.rejection_reason}`, video.video_id);
        kept++;
      }
    } catch (err) {
      errors++;
      console.error(`  ERROR [${video.video_id}]: ${err.message}`);
    }

    await sleep(DELAY_MS);
  }

  console.log(`Batch B complete: ${approved} flipped to approved, ${kept} kept rejected, ${errors} errors`);
}

async function main() {
  const childProfile = buildCombinedProfile(db);
  console.log('Using combined child profile:');
  console.log(childProfile.slice(0, 200) + (childProfile.length > 200 ? '...' : ''));

  const batchArg = process.argv[2]; // 'a', 'b', or undefined (both)

  if (!batchArg || batchArg === 'a') await runBatchA(childProfile);
  if (!batchArg || batchArg === 'b') await runBatchB(childProfile);

  console.log('\nDone.');
}

main().catch(err => { console.error(err); process.exit(1); });
```

- [ ] **Step 2: Verify the script syntax**

```bash
node --check backend/scripts/backfill-llm.js && echo "Syntax OK"
```

Expected: `Syntax OK`

- [ ] **Step 3: Dry-run count check (no LLM calls)**

```bash
cd /home/michael/projects/kidstube
node -e "
const db = require('./backend/src/db');
db.migrate();
const rawDb = db.getDb();
const batchA = rawDb.prepare(\"SELECT COUNT(*) as c FROM videos v WHERE v.status='approved' AND NOT EXISTS (SELECT 1 FROM video_tags vt WHERE vt.video_id = v.video_id)\").get();
const batchB = rawDb.prepare(\"SELECT COUNT(*) as c FROM videos v WHERE v.status='rejected' AND v.rejection_reason IN ('Keyword: \\\"die\\\"','Keyword: \\\"death\\\"','Keyword: \\\"scary\\\"','Keyword: \\\"violence\\\"')\").get();
console.log('Batch A:', batchA.c, 'videos');
console.log('Batch B:', batchB.c, 'videos');
"
```

Expected: Batch A ~888, Batch B ~421

- [ ] **Step 4: Commit**

```bash
git add backend/scripts/backfill-llm.js
git commit -m "feat: backfill-llm script — tag approved videos and re-evaluate soft-keyword rejections"
```

---

### Task 4: channel_recommendations table + DB functions + tests

**Files:**
- Modify: `backend/src/db.js` (add table + 4 functions + update exports)
- Modify: `backend/tests/helpers/testDb.js` (add teardown for new table)
- Modify: `backend/tests/db.test.js` (add tests for 4 new functions)

- [ ] **Step 1: Write failing tests** (add to end of `backend/tests/db.test.js`)

```js
// --- channel_recommendations ---
describe('channel_recommendations', () => {
  beforeEach(() => {
    db.getDb().prepare('INSERT OR IGNORE INTO profiles (id, name) VALUES (5, ?)').run('Child1');
    db.getDb().prepare('INSERT OR IGNORE INTO channels (channel_id, profile_id, channel_name, whitelisted) VALUES (?, ?, ?, ?)').run('UCtest1', 5, 'Test Channel', 0);
  });

  test('upsertChannelRecommendation inserts a new rec', () => {
    db.upsertChannelRecommendation('UCtest1', 5, 'enable', 'Good STEM content');
    const recs = db.getChannelRecommendations(5);
    expect(recs).toHaveLength(1);
    expect(recs[0].recommendation).toBe('enable');
    expect(recs[0].reason).toBe('Good STEM content');
    expect(recs[0].dismissed).toBe(0);
    expect(recs[0].applied).toBe(0);
  });

  test('upsertChannelRecommendation updates on re-run', () => {
    db.upsertChannelRecommendation('UCtest1', 5, 'enable', 'First reason');
    db.upsertChannelRecommendation('UCtest1', 5, 'disable', 'Updated reason');
    const recs = db.getChannelRecommendations(5);
    expect(recs).toHaveLength(1);
    expect(recs[0].recommendation).toBe('disable');
    expect(recs[0].reason).toBe('Updated reason');
  });

  test('getChannelRecommendations excludes dismissed and applied', () => {
    db.getDb().prepare('INSERT OR IGNORE INTO channels (channel_id, profile_id, channel_name, whitelisted) VALUES (?, ?, ?, ?)').run('UCtest2', 5, 'Dismissed Chan', 0);
    db.getDb().prepare('INSERT OR IGNORE INTO channels (channel_id, profile_id, channel_name, whitelisted) VALUES (?, ?, ?, ?)').run('UCtest3', 5, 'Applied Chan', 0);
    db.upsertChannelRecommendation('UCtest1', 5, 'enable', 'Active');
    db.upsertChannelRecommendation('UCtest2', 5, 'enable', 'Dismissed');
    db.upsertChannelRecommendation('UCtest3', 5, 'enable', 'Applied');
    db.dismissChannelRecommendation('UCtest2', 5);
    db.applyChannelRecommendation('UCtest3', 5);
    const recs = db.getChannelRecommendations(5);
    expect(recs).toHaveLength(1);
    expect(recs[0].channel_id).toBe('UCtest1');
  });

  test('applyChannelRecommendation flips whitelisted flag', () => {
    db.upsertChannelRecommendation('UCtest1', 5, 'enable', 'Good content');
    db.applyChannelRecommendation('UCtest1', 5);
    const channel = db.getDb().prepare('SELECT whitelisted FROM channels WHERE channel_id=? AND profile_id=?').get('UCtest1', 5);
    expect(channel.whitelisted).toBe(1);
    const rec = db.getDb().prepare('SELECT applied FROM channel_recommendations WHERE channel_id=? AND profile_id=?').get('UCtest1', 5);
    expect(rec.applied).toBe(1);
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
DB_PATH=':memory:' npx jest backend/tests/db.test.js --no-coverage -t 'channel_recommendations' 2>&1 | tail -15
```

Expected: FAIL — `db.upsertChannelRecommendation is not a function`

- [ ] **Step 3: Add table to migrate() in db.js**

After the `child_profiles` table creation block (around line 136) and before the index lines, add:

```js
    CREATE TABLE IF NOT EXISTS channel_recommendations (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      channel_id     TEXT NOT NULL,
      profile_id     INTEGER NOT NULL REFERENCES profiles(id),
      recommendation TEXT NOT NULL,  -- 'enable' | 'disable'
      reason         TEXT NOT NULL,
      dismissed      INTEGER NOT NULL DEFAULT 0,
      applied        INTEGER NOT NULL DEFAULT 0,
      created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(channel_id, profile_id)
    );
    CREATE INDEX IF NOT EXISTS idx_channel_recs_profile ON channel_recommendations(profile_id, dismissed, applied);
```

- [ ] **Step 4: Add the four query functions to db.js** (before `module.exports`)

```js
function upsertChannelRecommendation(channelId, profileId, recommendation, reason) {
  getDb().prepare(`
    INSERT INTO channel_recommendations (channel_id, profile_id, recommendation, reason, updated_at)
    VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(channel_id, profile_id) DO UPDATE SET
      recommendation = excluded.recommendation,
      reason         = excluded.reason,
      dismissed      = 0,
      applied        = 0,
      updated_at     = CURRENT_TIMESTAMP
  `).run(channelId, profileId, recommendation, reason);
}

function getChannelRecommendations(profileId) {
  return getDb().prepare(`
    SELECT cr.*, c.channel_name, c.thumbnail_url, c.subscriber_count, c.whitelisted
    FROM channel_recommendations cr
    JOIN channels c ON cr.channel_id = c.channel_id AND cr.profile_id = c.profile_id
    WHERE cr.profile_id = ? AND cr.dismissed = 0 AND cr.applied = 0
    ORDER BY cr.updated_at DESC
  `).all(profileId);
}

function dismissChannelRecommendation(channelId, profileId) {
  getDb().prepare(`
    UPDATE channel_recommendations SET dismissed = 1, updated_at = CURRENT_TIMESTAMP
    WHERE channel_id = ? AND profile_id = ?
  `).run(channelId, profileId);
}

function applyChannelRecommendation(channelId, profileId) {
  const rec = getDb().prepare(
    'SELECT recommendation FROM channel_recommendations WHERE channel_id = ? AND profile_id = ?'
  ).get(channelId, profileId);
  if (!rec) return;

  const newWhitelisted = rec.recommendation === 'enable' ? 1 : 0;
  getDb().prepare('UPDATE channels SET whitelisted = ? WHERE channel_id = ? AND profile_id = ?')
    .run(newWhitelisted, channelId, profileId);
  getDb().prepare(`
    UPDATE channel_recommendations SET applied = 1, updated_at = CURRENT_TIMESTAMP
    WHERE channel_id = ? AND profile_id = ?
  `).run(channelId, profileId);
}
```

- [ ] **Step 5: Add functions to module.exports in db.js**

```js
  upsertChannelRecommendation,
  getChannelRecommendations,
  dismissChannelRecommendation,
  applyChannelRecommendation,
```

- [ ] **Step 6: Update teardownTestDb in testDb.js**

Add before `DELETE FROM filter_rules`:
```js
  db.getDb().prepare('DELETE FROM channel_recommendations').run();
```

- [ ] **Step 7: Run tests to confirm they pass**

```bash
DB_PATH=':memory:' npx jest backend/tests/db.test.js --no-coverage 2>&1 | tail -15
```

Expected: all tests pass (existing + 4 new channel_recommendations tests)

- [ ] **Step 8: Commit**

```bash
git add backend/src/db.js backend/tests/db.test.js backend/tests/helpers/testDb.js
git commit -m "feat: channel_recommendations table — store LLM channel audit results with apply/dismiss lifecycle"
```

---

### Task 5: Channel recommendation API endpoints

**Files:**
- Modify: `backend/src/server.js` (add 3 admin routes)

- [ ] **Step 1: Add the three endpoints** (after the existing child profile endpoints)

```js
// GET /api/admin/channel-recommendations/:profileId
app.get('/api/admin/channel-recommendations/:profileId', requireAdmin, (req, res) => {
  const profileId = parseInt(req.params.profileId, 10);
  const recs = db.getChannelRecommendations(profileId);
  res.json(recs);
});

// POST /api/admin/channel-recommendations/:profileId/:channelId/apply
app.post('/api/admin/channel-recommendations/:profileId/:channelId/apply', requireAdmin, (req, res) => {
  const { profileId, channelId } = req.params;
  db.applyChannelRecommendation(channelId, parseInt(profileId, 10));
  res.json({ ok: true });
});

// POST /api/admin/channel-recommendations/:profileId/:channelId/dismiss
app.post('/api/admin/channel-recommendations/:profileId/:channelId/dismiss', requireAdmin, (req, res) => {
  const { profileId, channelId } = req.params;
  db.dismissChannelRecommendation(channelId, parseInt(profileId, 10));
  res.json({ ok: true });
});
```

- [ ] **Step 2: Verify server.js still loads (syntax check)**

```bash
node --check backend/src/server.js && echo "Syntax OK"
```

Expected: `Syntax OK`

- [ ] **Step 3: Commit**

```bash
git add backend/src/server.js
git commit -m "feat: channel recommendation admin API — GET list, POST apply/dismiss"
```

---

### Task 6: audit-channels.js script

**Files:**
- Create: `backend/scripts/audit-channels.js`

Audits all channels across both profiles. Uses 10-channel batches to minimize API calls (~95 calls total, ~$0.07). Stores results in `channel_recommendations`. Resumable — upsert on conflict resets dismissed/applied.

- [ ] **Step 1: Write the script**

```js
#!/usr/bin/env node
// backend/scripts/audit-channels.js
//
// Runs LLM audit across all channels for both profiles.
// Groups 10 channels per Haiku call to keep costs low (~$0.07 total).
// Stores results in channel_recommendations table.
// Resumable — safe to re-run.

const Anthropic = require('@anthropic-ai/sdk');
const db = require('../src/db');
const { buildCombinedProfile } = require('../src/childProfile');

db.migrate();
const rawDb = db.getDb();

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const BATCH_SIZE = 10;
const DELAY_MS   = 1200;
const PROFILE_IDS = [5, 6];  // Child1, Child2

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function chunkArray(arr, size) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

async function auditBatch(channels, childProfile, profileId) {
  const channelList = channels.map((c, i) =>
    `${i + 1}. **${c.channel_name || c.channel_id}** (${c.whitelisted ? 'currently enabled' : 'currently disabled'})` +
    (c.subscriber_count ? ` — ${(c.subscriber_count / 1000).toFixed(0)}K subscribers` : '') +
    (c.description ? `\n   Description: ${c.description.slice(0, 150)}` : '')
  ).join('\n\n');

  const systemPrompt = `You are reviewing YouTube channels for a kids' content platform. The content policy is:\n\n${childProfile}\n\nYour job: for each channel, decide whether it should be enabled or disabled for this child.`;

  const userMessage = `Review these ${channels.length} YouTube channels and for each one respond with a JSON recommendation.

Channels:
${channelList}

Respond with a JSON array (one object per channel, in order):
[
  { "index": 1, "recommendation": "enable" | "disable", "reason": "brief reason (1 sentence)" },
  ...
]

Only return the JSON array, no other text.`;

  const response = await client.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 1024,
    system: systemPrompt,
    messages: [{ role: 'user', content: userMessage }]
  });

  const text = response.content[0].text.trim();

  // Extract JSON array from response
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) throw new Error(`Could not parse JSON from: ${text.slice(0, 200)}`);

  const results = JSON.parse(match[0]);

  for (const result of results) {
    const idx = result.index - 1;
    if (idx < 0 || idx >= channels.length) continue;
    const channel = channels[idx];
    db.upsertChannelRecommendation(channel.channel_id, profileId, result.recommendation, result.reason);
  }

  return results.length;
}

async function auditProfile(profileId, childProfile) {
  const profileRow = rawDb.prepare('SELECT name FROM profiles WHERE id = ?').get(profileId);
  const profileName = profileRow ? profileRow.name : `Profile ${profileId}`;

  const channels = rawDb.prepare(
    'SELECT channel_id, channel_name, whitelisted, subscriber_count, description FROM channels WHERE profile_id = ? ORDER BY channel_name'
  ).all(profileId);

  console.log(`\n=== ${profileName} (profile ${profileId}): ${channels.length} channels ===`);

  const batches = chunkArray(channels, BATCH_SIZE);
  let processed = 0;

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    try {
      const count = await auditBatch(batch, childProfile, profileId);
      processed += count;
      console.log(`  Batch ${i + 1}/${batches.length}: ${count} channels processed`);
    } catch (err) {
      console.error(`  Batch ${i + 1} ERROR: ${err.message}`);
    }
    if (i < batches.length - 1) await sleep(DELAY_MS);
  }

  console.log(`${profileName}: ${processed}/${channels.length} channels audited`);
}

async function main() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || apiKey.includes('placeholder') || apiKey.length < 20) {
    console.error('ANTHROPIC_API_KEY is not set or is a placeholder. Aborting.');
    process.exit(1);
  }

  const childProfile = buildCombinedProfile(db);
  console.log('Child profile preview:', childProfile.slice(0, 100) + '...');

  const profileArg = process.argv[2] ? parseInt(process.argv[2], 10) : null;
  const profilesToAudit = profileArg ? [profileArg] : PROFILE_IDS;

  for (const profileId of profilesToAudit) {
    await auditProfile(profileId, childProfile);
    if (profilesToAudit.length > 1) await sleep(2000);
  }

  console.log('\nAudit complete. View results in admin panel under Channel Recommendations.');
}

main().catch(err => { console.error(err); process.exit(1); });
```

- [ ] **Step 2: Verify script syntax**

```bash
node --check backend/scripts/audit-channels.js && echo "Syntax OK"
```

Expected: `Syntax OK`

- [ ] **Step 3: Commit**

```bash
git add backend/scripts/audit-channels.js
git commit -m "feat: audit-channels script — LLM reviews all channels, stores recs in channel_recommendations"
```

---

### Task 7: ChannelRecommendations React component in Admin.jsx

**Files:**
- Modify: `frontend/src/pages/Admin.jsx`

Adds a `ChannelRecommendations` section to the admin panel. Shows pending recommendations grouped by profile. Each card shows channel name, current status, LLM recommendation (enable/disable), reason, and Apply/Dismiss buttons.

- [ ] **Step 1: Read the current Admin.jsx** to find where to insert the component

Look for the `AdminDashboard` component and the section where `ChildProfileSection` is used. The new section goes after child profiles.

- [ ] **Step 2: Add the ChannelRecommendations component**

Add this component definition before `AdminDashboard`:

```jsx
function ChannelRecommendations({ profileId, profileName }) {
  const [recs, setRecs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(null); // channelId being acted on

  async function loadRecs() {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/channel-recommendations/${profileId}`, { credentials: 'include' });
      const data = await res.json();
      setRecs(Array.isArray(data) ? data : []);
    } catch {
      setRecs([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadRecs(); }, [profileId]);

  async function handleApply(channelId) {
    setActing(channelId);
    await fetch(`/api/admin/channel-recommendations/${profileId}/${channelId}/apply`, { method: 'POST', credentials: 'include' });
    await loadRecs();
    setActing(null);
  }

  async function handleDismiss(channelId) {
    setActing(channelId);
    await fetch(`/api/admin/channel-recommendations/${profileId}/${channelId}/dismiss`, { method: 'POST', credentials: 'include' });
    await loadRecs();
    setActing(null);
  }

  if (loading) return <p className="text-yt-muted text-sm">Loading recommendations...</p>;
  if (recs.length === 0) return <p className="text-yt-muted text-sm">No pending channel recommendations for {profileName}.</p>;

  const toEnable  = recs.filter(r => r.recommendation === 'enable');
  const toDisable = recs.filter(r => r.recommendation === 'disable');

  function RecCard({ rec }) {
    const isActing = acting === rec.channel_id;
    const badgeClass = rec.recommendation === 'enable'
      ? 'bg-green-900/40 text-green-400 border border-green-700'
      : 'bg-red-900/40 text-red-400 border border-red-700';

    return (
      <div className="flex items-start gap-3 p-3 rounded-lg bg-yt-card border border-yt-border">
        {rec.thumbnail_url && (
          <img src={rec.thumbnail_url} alt="" className="w-10 h-10 rounded-full flex-shrink-0 object-cover" />
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-yt-text font-medium text-sm truncate">{rec.channel_name || rec.channel_id}</span>
            <span className="text-yt-muted text-xs">{rec.whitelisted ? 'currently enabled' : 'currently disabled'}</span>
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${badgeClass}`}>
              {rec.recommendation}
            </span>
          </div>
          <p className="text-yt-muted text-xs mt-1">{rec.reason}</p>
        </div>
        <div className="flex gap-2 flex-shrink-0">
          <button
            onClick={() => handleApply(rec.channel_id)}
            disabled={isActing}
            className="text-xs px-3 py-1 rounded bg-yt-red text-white hover:bg-red-600 disabled:opacity-50"
          >
            Apply
          </button>
          <button
            onClick={() => handleDismiss(rec.channel_id)}
            disabled={isActing}
            className="text-xs px-3 py-1 rounded bg-yt-surface text-yt-muted hover:text-yt-text border border-yt-border disabled:opacity-50"
          >
            Dismiss
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {toEnable.length > 0 && (
        <div>
          <h4 className="text-sm font-medium text-green-400 mb-2">Suggested to enable ({toEnable.length})</h4>
          <div className="space-y-2">
            {toEnable.map(r => <RecCard key={r.channel_id} rec={r} />)}
          </div>
        </div>
      )}
      {toDisable.length > 0 && (
        <div>
          <h4 className="text-sm font-medium text-red-400 mb-2">Suggested to disable ({toDisable.length})</h4>
          <div className="space-y-2">
            {toDisable.map(r => <RecCard key={r.channel_id} rec={r} />)}
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Add Channel Recommendations section to AdminDashboard**

In `AdminDashboard`, after the "Child Profiles" section, add:

```jsx
{/* Channel Recommendations */}
<section>
  <h2 className="text-lg font-semibold text-yt-text mb-4">Channel Recommendations</h2>
  <p className="text-yt-muted text-sm mb-4">
    AI-generated recommendations after auditing all channels. Run <code className="bg-yt-card px-1 rounded">node backend/scripts/audit-channels.js</code> to populate.
  </p>
  <div className="space-y-6">
    {profiles.map(p => (
      <div key={p.id} className="bg-yt-surface rounded-xl p-4">
        <h3 className="text-yt-text font-medium mb-3">{p.name}</h3>
        <ChannelRecommendations profileId={p.id} profileName={p.name} />
      </div>
    ))}
  </div>
</section>
```

Note: `profiles` is already available in `AdminDashboard` from the existing `useEffect` that loads profiles.

- [ ] **Step 4: Rebuild frontend**

```bash
cd /home/michael/projects/kidstube
docker compose build frontend && docker compose up -d frontend
```

Expected: Build succeeds, no errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/Admin.jsx
git commit -m "feat: channel recommendations admin UI — view, apply, and dismiss LLM channel audit results"
```

---

## Running the scripts

After all tasks are committed and deployed:

```bash
# 1. Remove soft keywords (fast, no LLM)
node backend/scripts/remove-soft-keywords.js

# 2. Backfill tags + re-evaluate soft rejections (slow — ~30 min for 1300 videos)
node backend/scripts/backfill-llm.js

# 3. Audit all channels (medium — ~5 min for 982 channels)
node backend/scripts/audit-channels.js
```

Note: Scripts 2 and 3 require `ANTHROPIC_API_KEY` in environment. The Docker container has it — run inside the container if needed:
```bash
docker compose exec backend node /app/scripts/backfill-llm.js
docker compose exec backend node /app/scripts/audit-channels.js
```
