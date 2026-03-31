# Recommendation Algorithm Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace brute-force keyword filtering and same-channel-only recommendations with a tag-based interest graph, session-aware scoring, and a living per-child profile that evolves from watch behavior and parent input.

**Architecture:** Videos are tagged at ingest time via a single combined Haiku call (appropriateness + topic tags). Each profile maintains a `profile_interests` table of decaying tag weights updated in real-time by watch events and reactions. The `getRelatedVideos` query is replaced by a scored SQL ranking against those weights. Two cron passes (daily insights + weekly consolidation) maintain a per-child markdown profile that feeds back into Haiku's system prompt and sets parent-defined interest floors.

**Tech Stack:** Node.js/Express, better-sqlite3 (SQLite), Anthropic Haiku 4.5, YouTube Data API v3, Jest (new), React 18 + Tailwind CSS

---

## File Map

**New files:**
- `backend/src/recommendations.js` — scored `getRecommendedVideos(videoId, profileId)` query
- `backend/src/insights.js` — `runDailyInsightsPass()` and `runWeeklyConsolidationPass()`
- `backend/src/childProfile.js` — profile generation, parent tag extraction, consolidation helpers
- `backend/tests/filter.test.js` — unit tests for shorts detection
- `backend/tests/llm.test.js` — unit tests for `smartSampleTranscript`
- `backend/tests/recommendations.test.js` — integration tests for scoring query

**Modified files:**
- `backend/package.json` — add Jest devDependency + `test` script
- `backend/src/filter.js` — add `isShort(video)` (Pass 0)
- `backend/src/llm.js` — combined prompt returning `{ approved, reason, tags }` + `smartSampleTranscript`
- `backend/src/youtube.js` — add `topicDetails` to `videos.list` part; export `parseTopicCategories`
- `backend/src/db.js` — 4 new table migrations + 8 new query functions
- `backend/src/cron.js` — wire Haiku, shorts pass, tag storage, LLM cap, schedule new passes
- `backend/src/server.js` — add `/api/video/:id/react`, `/api/admin/video/:id/react`, update `/api/related/:videoId`, add child profile admin endpoints
- `frontend/src/pages/Watch.jsx` — wire Like/Dislike buttons to `/api/video/:id/react`
- `frontend/src/pages/Admin.jsx` — child profile setup interview + ongoing management UI

---

## Quick Wins (Tasks 1–3) — shippable independently

These three tasks fix broken behavior in the current system. They can be built, tested, and deployed before the rest of the plan.

---

### Task 1: Add Jest test infrastructure

**Files:**
- Modify: `backend/package.json`
- Create: `backend/jest.config.js`
- Create: `backend/tests/helpers/testDb.js`

- [ ] **Step 1: Install Jest**

```bash
cd backend && npm install --save-dev jest
```

- [ ] **Step 2: Add test script and Jest config to package.json**

In `backend/package.json`, add to `scripts` and add `jest` config block:

```json
{
  "scripts": {
    "start": "node src/server.js",
    "dev": "nodemon src/server.js",
    "migrate": "node migrate.js",
    "test": "jest --testPathPattern=tests/"
  },
  "jest": {
    "testEnvironment": "node",
    "testMatch": ["**/tests/**/*.test.js"]
  }
}
```

- [ ] **Step 3: Create test DB helper**

Create `backend/tests/helpers/testDb.js`:

```js
// Sets DB_PATH to :memory: so tests use an in-memory SQLite database.
// Must be required BEFORE db.js is loaded anywhere in the test file.
process.env.DB_PATH = ':memory:';

const db = require('../../src/db');

function setupTestDb() {
  db.migrate();
  return db;
}

function seedProfile(db, { id = 1, name = 'Test' } = {}) {
  db.getDb().prepare(
    `INSERT OR IGNORE INTO profiles (id, name) VALUES (?, ?)`
  ).run(id, name);
}

function seedVideo(db, { video_id = 'vid1', channel_id = 'ch1', channel_name = 'Chan', title = 'Test', status = 'approved', duration_seconds = 300 } = {}) {
  db.getDb().prepare(`
    INSERT OR IGNORE INTO videos (video_id, channel_id, channel_name, title, status, duration_seconds, published_at)
    VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `).run(video_id, channel_id, channel_name, title, status, duration_seconds);
}

function seedTag(db, videoId, tag) {
  db.getDb().prepare(
    `INSERT OR IGNORE INTO video_tags (video_id, tag) VALUES (?, ?)`
  ).run(videoId, tag);
}

function seedInterest(db, profileId, tag, weight, source = 'behavior') {
  db.getDb().prepare(`
    INSERT OR REPLACE INTO profile_interests (profile_id, tag, weight, source, last_seen)
    VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
  `).run(profileId, tag, weight, source);
}

module.exports = { setupTestDb, seedProfile, seedVideo, seedTag, seedInterest };
```

- [ ] **Step 4: Verify Jest runs (no tests yet)**

```bash
cd backend && npm test
```

Expected output: `No tests found` or similar — no error.

- [ ] **Step 5: Commit**

```bash
cd /home/michael/projects/kidstube
git add backend/package.json backend/tests/helpers/testDb.js
git commit -m "chore: add Jest test infrastructure with in-memory SQLite helper"
```

---

### Task 2: Shorts detection — Pass 0

**Files:**
- Modify: `backend/src/filter.js`
- Create: `backend/tests/filter.test.js`

- [ ] **Step 1: Write failing tests**

Create `backend/tests/filter.test.js`:

```js
const { isShort } = require('../src/filter');

describe('isShort', () => {
  test('rejects videos 60 seconds or under', () => {
    expect(isShort({ duration_seconds: 60 })).toBe(true);
    expect(isShort({ duration_seconds: 59 })).toBe(true);
    expect(isShort({ duration_seconds: 61 })).toBe(false);
  });

  test('rejects #shorts in title (case-insensitive)', () => {
    expect(isShort({ title: 'Cool video #Shorts' })).toBe(true);
    expect(isShort({ title: 'cool #short thing' })).toBe(true);
    expect(isShort({ title: 'Cool video' })).toBe(false);
  });

  test('rejects #short in description', () => {
    expect(isShort({ description: 'Watch this #shorts' })).toBe(true);
  });

  test('rejects #short in tags array', () => {
    expect(isShort({ tags: ['minecraft', '#short', 'gaming'] })).toBe(true);
    expect(isShort({ tags: ['minecraft', 'gaming'] })).toBe(false);
  });

  test('rejects when yt-dlp is_short flag is true', () => {
    expect(isShort({ is_short: true })).toBe(true);
    expect(isShort({ is_short: false })).toBe(false);
  });

  test('rejects vertical video (height > width)', () => {
    expect(isShort({ width: 1080, height: 1920 })).toBe(true);
    expect(isShort({ width: 1920, height: 1080 })).toBe(false);
    expect(isShort({ width: 1920, height: 1920 })).toBe(false); // square is not a short
  });

  test('returns false for a normal video with no signals', () => {
    expect(isShort({
      duration_seconds: 300,
      title: 'Minecraft lets play',
      tags: ['minecraft', 'gaming'],
      is_short: false,
      width: 1920,
      height: 1080
    })).toBe(false);
  });

  test('returns false when no fields present', () => {
    expect(isShort({})).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

```bash
cd backend && npm test -- --testPathPattern=filter
```

Expected: `isShort is not a function` or similar.

- [ ] **Step 3: Implement `isShort` in filter.js**

Add to the bottom of `backend/src/filter.js`, before `module.exports`:

```js
/**
 * Pass 0: Shorts detection
 * Any one signal firing means the video is a YouTube Short.
 * Runs before keyword filter — cheap metadata check only.
 */
function isShort(video) {
  // Signal 1: duration ≤ 60s
  if (video.duration_seconds != null && video.duration_seconds <= 60) return true;

  // Signal 2: self-labelled with #shorts or #short
  const textFields = [
    video.title,
    video.description,
    ...(Array.isArray(video.tags) ? video.tags : [])
  ].filter(Boolean).join(' ').toLowerCase();
  if (/#shorts?\b/.test(textFields)) return true;

  // Signal 3: yt-dlp is_short flag
  if (video.is_short === true) return true;

  // Signal 4: vertical aspect ratio (height > width)
  if (video.width && video.height && video.height > video.width) return true;

  return false;
}
```

Update `module.exports` line at the bottom:

```js
module.exports = { runFilterPass, applyKeywordFilter, applyChannelFilter, isShort };
```

- [ ] **Step 4: Run tests, verify they pass**

```bash
cd backend && npm test -- --testPathPattern=filter
```

Expected: all 7 tests pass.

- [ ] **Step 5: Wire Pass 0 into cron.js `processVideo`**

In `backend/src/cron.js`, add the import at the top (update existing filter import):

```js
const filter = require('./filter');
// filter.isShort, filter.runFilterPass are now available
```

In `processVideo`, add Pass 0 in two places.

First, **before yt-dlp fetch** (catches shorts from RSS data alone), right after the quick keyword filter block:

```js
// Pass 0a: Shorts detection on RSS metadata
if (filter.isShort(videoData)) {
  db.updateVideoStatus(videoId, 'rejected', 'YouTube Short');
  stats.rejected++;
  return;
}
```

Second, **after yt-dlp fetch** (catches shorts yt-dlp detects via is_short and aspect ratio), right after the `if (fullData?.is_short)` block — replace that existing block:

```js
// Pass 0b: Shorts detection on full yt-dlp data (aspect ratio, is_short flag)
if (fullData && filter.isShort(fullData)) {
  db.updateVideoStatus(videoId, 'rejected', 'YouTube Short');
  stats.rejected++;
  return;
}
```

Remove the old `if (fullData?.is_short)` check since `isShort` now covers it.

- [ ] **Step 6: Rebuild backend and verify**

```bash
cd /home/michael/projects/kidstube
docker compose build backend && docker compose up -d backend
docker compose logs backend --tail=20
```

Expected: backend starts without errors.

- [ ] **Step 7: Commit**

```bash
git add backend/src/filter.js backend/src/cron.js backend/tests/filter.test.js
git commit -m "feat: Pass 0 multi-signal shorts detection (duration, #shorts tag, is_short, aspect ratio)"
```

---

### Task 3: Wire the Haiku LLM pass (fix dead code)

**Files:**
- Modify: `backend/src/cron.js`

The `runLlmCheck` import exists in `llm.js` but is never called in `processVideo`. This task wires it in with a per-run cap.

- [ ] **Step 1: Add llm import and cap counter to cron.js**

At the top of `backend/src/cron.js`, add:

```js
const { runLlmCheck } = require('./llm');
```

In `runNightlyJob`, add a cap counter before the profile loop:

```js
const LLM_CAP = 300;
let llmCallsThisRun = 0;
```

Pass it through to `processVideo` by updating all calls to `processVideo` to include it:

```js
// Change signature of processVideo:
async function processVideo(videoData, filterRules, stats, isRecommended, sourceVideoId, llmState) {
  // llmState = { calls: number, cap: number }
```

Update each `processVideo` call in `runNightlyJob`:

```js
const llmState = { calls: 0, cap: LLM_CAP };

// In the new videos loop:
await processVideo(video, filterRules, stats, false, null, llmState);

// In the related videos loop:
await processVideo(related, filterRules, stats, true, approvedVideo.video_id, llmState);
```

- [ ] **Step 2: Add the Haiku call inside processVideo**

After the second `runFilterPass` call (the one with `enrichedVideo`) and before the final `db.updateVideoStatus(videoId, 'approved')`, add:

```js
// Pass 2: LLM appropriateness check
if (llmState && llmState.calls < llmState.cap) {
  llmState.calls++;
  const llmResult = await runLlmCheck(enrichedVideo);
  if (!llmResult.approved) {
    db.updateVideoStatus(videoId, 'rejected', `LLM: ${llmResult.reason || 'inappropriate content'}`);
    stats.rejected++;
    return;
  }
} else if (llmState && llmState.calls >= llmState.cap) {
  console.warn(`[Cron] LLM cap of ${llmState.cap} reached, skipping LLM check for ${videoId}`);
}

// All passes cleared — approve
db.updateVideoStatus(videoId, 'approved');
stats.approved++;
```

- [ ] **Step 3: Rebuild and verify LLM rejections appear in logs**

```bash
docker compose build backend && docker compose up -d backend
docker compose logs backend -f
```

Trigger a manual cron run via the admin panel or via:
```bash
curl -X POST http://localhost:3001/api/admin/cron/run
```

Expected: log lines like `[Cron] LLM: inappropriate content` for rejected videos.

- [ ] **Step 4: Commit**

```bash
git add backend/src/cron.js
git commit -m "fix: wire Haiku LLM appropriateness pass in processVideo (was dead code), add 300-call nightly cap"
```

---

## Recommendation System (Tasks 4–18)

---

### Task 4: Database migrations — four new tables

**Files:**
- Modify: `backend/src/db.js`

- [ ] **Step 1: Add migrations inside the `migrate()` function's `db.exec()` call**

In `backend/src/db.js`, inside the large `db.exec(` template literal in `migrate()`, append these four table definitions after the existing `CREATE TABLE IF NOT EXISTS` blocks:

```sql
    CREATE TABLE IF NOT EXISTS video_tags (
      video_id  TEXT NOT NULL REFERENCES videos(video_id) ON DELETE CASCADE,
      tag       TEXT NOT NULL,
      weight    REAL NOT NULL DEFAULT 1.0,
      PRIMARY KEY (video_id, tag)
    );

    CREATE TABLE IF NOT EXISTS profile_interests (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      profile_id  INTEGER NOT NULL REFERENCES profiles(id),
      tag         TEXT NOT NULL,
      weight      REAL NOT NULL DEFAULT 1.0,
      source      TEXT NOT NULL DEFAULT 'behavior',
      last_seen   DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(profile_id, tag, source)
    );

    CREATE TABLE IF NOT EXISTS profile_insights (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      profile_id   INTEGER NOT NULL REFERENCES profiles(id),
      insight      TEXT NOT NULL,
      source       TEXT NOT NULL,
      created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
      consolidated INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS child_profiles (
      profile_id  INTEGER PRIMARY KEY REFERENCES profiles(id),
      markdown    TEXT NOT NULL DEFAULT '',
      updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_by  TEXT NOT NULL DEFAULT 'parent'
    );

    CREATE INDEX IF NOT EXISTS idx_video_tags_tag ON video_tags(tag);
    CREATE INDEX IF NOT EXISTS idx_profile_interests_profile ON profile_interests(profile_id);
    CREATE INDEX IF NOT EXISTS idx_profile_insights_profile ON profile_insights(profile_id, consolidated);
```

- [ ] **Step 2: Add DB query functions to db.js**

Add these functions before the `module.exports` block in `backend/src/db.js`:

```js
// --- Video tags ---

function insertVideoTags(videoId, tags) {
  const insert = getDb().prepare(
    `INSERT OR IGNORE INTO video_tags (video_id, tag) VALUES (?, ?)`
  );
  const insertMany = getDb().transaction((tags) => {
    for (const tag of tags) insert.run(videoId, tag);
  });
  insertMany(tags);
}

function getVideoTags(videoId) {
  return getDb().prepare(
    `SELECT tag FROM video_tags WHERE video_id = ?`
  ).all(videoId).map(r => r.tag);
}

// --- Profile interests ---

function upsertProfileInterest(profileId, tag, delta, source = 'behavior') {
  getDb().prepare(`
    INSERT INTO profile_interests (profile_id, tag, weight, source, last_seen)
    VALUES (?, ?, MAX(0.0, ?), ?, CURRENT_TIMESTAMP)
    ON CONFLICT(profile_id, tag, source) DO UPDATE SET
      weight    = MAX(0.0, weight + ?),
      last_seen = CURRENT_TIMESTAMP
  `).run(profileId, tag, Math.max(0, delta), source, delta);
}

function setParentInterest(profileId, tag, weight) {
  getDb().prepare(`
    INSERT INTO profile_interests (profile_id, tag, weight, source, last_seen)
    VALUES (?, ?, ?, 'parent', CURRENT_TIMESTAMP)
    ON CONFLICT(profile_id, tag, source) DO UPDATE SET
      weight    = ?,
      last_seen = CURRENT_TIMESTAMP
  `).run(profileId, tag, weight, weight);
}

function deleteParentInterests(profileId) {
  getDb().prepare(
    `DELETE FROM profile_interests WHERE profile_id = ? AND source = 'parent'`
  ).run(profileId);
}

function applyDecayToProfile(profileId, today) {
  getDb().prepare(`
    UPDATE profile_interests
    SET weight = MAX(0.0, weight * 0.85)
    WHERE profile_id = ?
      AND source = 'behavior'
      AND DATE(last_seen) != ?
  `).run(profileId, today);
}

function profileHadSessionToday(profileId, today) {
  const row = getDb().prepare(`
    SELECT COUNT(*) as count FROM watch_history
    WHERE profile_id = ? AND DATE(watched_at) = ?
  `).get(profileId, today);
  return row.count > 0;
}

// --- Profile insights ---

function insertProfileInsight(profileId, insight, source) {
  getDb().prepare(
    `INSERT INTO profile_insights (profile_id, insight, source) VALUES (?, ?, ?)`
  ).run(profileId, insight, source);
}

function getUnconsolidatedInsights(profileId) {
  return getDb().prepare(`
    SELECT insight, source, created_at
    FROM profile_insights
    WHERE profile_id = ? AND consolidated = 0
    ORDER BY created_at ASC
  `).all(profileId);
}

function markInsightsConsolidated(profileId) {
  getDb().prepare(
    `UPDATE profile_insights SET consolidated = 1 WHERE profile_id = ? AND consolidated = 0`
  ).run(profileId);
}

// --- Child profiles ---

function getChildProfile(profileId) {
  return getDb().prepare(
    `SELECT * FROM child_profiles WHERE profile_id = ?`
  ).get(profileId);
}

function saveChildProfile(profileId, markdown, updatedBy = 'parent') {
  getDb().prepare(`
    INSERT INTO child_profiles (profile_id, markdown, updated_at, updated_by)
    VALUES (?, ?, CURRENT_TIMESTAMP, ?)
    ON CONFLICT(profile_id) DO UPDATE SET
      markdown   = excluded.markdown,
      updated_at = CURRENT_TIMESTAMP,
      updated_by = excluded.updated_by
  `).run(profileId, markdown, updatedBy);
}

function getTagStatsByDay(profileId, dateStr) {
  return getDb().prepare(`
    SELECT vt.tag,
      COUNT(*) as total,
      SUM(CASE WHEN CAST(wh.progress_seconds AS REAL) / NULLIF(wh.duration_seconds, 0) >= 0.8 THEN 1 ELSE 0 END) as completed,
      AVG(CAST(wh.progress_seconds AS REAL) / NULLIF(wh.duration_seconds, 0)) as avg_completion
    FROM watch_history wh
    JOIN video_tags vt ON wh.video_id = vt.video_id
    WHERE wh.profile_id = ? AND DATE(wh.watched_at) = ?
    GROUP BY vt.tag
    ORDER BY total DESC
  `).all(profileId, dateStr);
}
```

- [ ] **Step 3: Add new exports to module.exports**

Append to the `module.exports` object at the bottom of `db.js`:

```js
  insertVideoTags,
  getVideoTags,
  upsertProfileInterest,
  setParentInterest,
  deleteParentInterests,
  applyDecayToProfile,
  profileHadSessionToday,
  insertProfileInsight,
  getUnconsolidatedInsights,
  markInsightsConsolidated,
  getChildProfile,
  saveChildProfile,
  getTagStatsByDay,
```

- [ ] **Step 4: Rebuild backend (migrations run on startup)**

```bash
docker compose build backend && docker compose up -d backend
docker compose logs backend --tail=20
```

Expected: no errors. The new tables now exist in `kidstube.db`.

- [ ] **Step 5: Verify tables were created**

```bash
docker compose exec backend node -e "
const db = require('./src/db');
const tables = db.getDb().prepare(\"SELECT name FROM sqlite_master WHERE type='table'\").all();
console.log(tables.map(t=>t.name));
"
```

Expected output includes: `video_tags`, `profile_interests`, `profile_insights`, `child_profiles`.

- [ ] **Step 6: Commit**

```bash
git add backend/src/db.js
git commit -m "feat: add video_tags, profile_interests, profile_insights, child_profiles tables + DB query functions"
```

---

### Task 5: YouTube topicDetails

**Files:**
- Modify: `backend/src/youtube.js`

- [ ] **Step 1: Add `topicDetails` to the `videos.list` part parameter**

In `backend/src/youtube.js`, find the `videos.list` call (around line 48). Change `part`:

```js
const res = await youtube.videos.list({
  part: 'snippet,contentDetails,statistics,topicDetails',
  id: batch.join(',')
});
```

- [ ] **Step 2: Add `parseTopicCategories` helper**

Add this function near the top of `youtube.js`, before the exports:

```js
/**
 * Extracts readable topic strings from YouTube's topicDetails.topicCategories.
 * Input: ["https://en.wikipedia.org/wiki/Minecraft", "https://en.wikipedia.org/wiki/Video_game"]
 * Output: ["Minecraft", "Video game"]
 */
function parseTopicCategories(topicCategories) {
  if (!Array.isArray(topicCategories)) return [];
  return topicCategories
    .map(url => {
      try {
        const slug = url.split('/wiki/')[1];
        if (!slug) return null;
        return decodeURIComponent(slug).replace(/_/g, ' ');
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}
```

- [ ] **Step 3: Export the new helper**

Find the `module.exports` at the bottom of `youtube.js` and add `parseTopicCategories`:

```js
module.exports = {
  // ... existing exports ...
  parseTopicCategories,
};
```

- [ ] **Step 4: Rebuild and verify**

```bash
docker compose build backend && docker compose up -d backend
docker compose logs backend --tail=5
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add backend/src/youtube.js
git commit -m "feat: add topicDetails to YouTube videos.list call, add parseTopicCategories helper"
```

---

### Task 6: Combined Haiku prompt — appropriateness + tag extraction

**Files:**
- Modify: `backend/src/llm.js`
- Create: `backend/tests/llm.test.js`

- [ ] **Step 1: Write failing tests for `smartSampleTranscript`**

Create `backend/tests/llm.test.js`:

```js
const { smartSampleTranscript } = require('../src/llm');

describe('smartSampleTranscript', () => {
  test('returns empty string for null transcript', () => {
    expect(smartSampleTranscript(null, 300)).toBe('');
    expect(smartSampleTranscript(undefined, 300)).toBe('');
  });

  test('returns up to 3000 chars for short videos (under 3 min)', () => {
    const transcript = 'x'.repeat(5000);
    const result = smartSampleTranscript(transcript, 150);
    expect(result).toBe('x'.repeat(3000));
  });

  test('returns full transcript if it fits within 3000 chars', () => {
    const transcript = 'x'.repeat(500);
    const result = smartSampleTranscript(transcript, 150);
    expect(result).toBe('x'.repeat(500));
  });

  test('returns smart front+middle+end sample for long videos (over 3 min)', () => {
    // 9000 char transcript, video is 400s
    const transcript = Array.from({ length: 9000 }, (_, i) => String.fromCharCode(65 + (i % 3))).join('');
    const result = smartSampleTranscript(transcript, 400);
    // Should start with first 1000 chars
    expect(result.startsWith(transcript.slice(0, 1000))).toBe(true);
    // Should end with last 1000 chars
    expect(result.endsWith(transcript.slice(-1000))).toBe(true);
    // Length: 3000 chars + 2 separator strings '\n...\n' = 3010
    expect(result.length).toBeLessThanOrEqual(3020);
  });

  test('handles transcript shorter than 3 chunks gracefully', () => {
    const transcript = 'hello world';
    expect(smartSampleTranscript(transcript, 400)).toBe('hello world');
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

```bash
cd backend && npm test -- --testPathPattern=llm
```

Expected: `smartSampleTranscript is not a function`

- [ ] **Step 3: Rewrite llm.js**

Replace the full contents of `backend/src/llm.js` with:

```js
const Anthropic = require('@anthropic-ai/sdk');
const axios = require('axios');

/**
 * Returns a smart transcript sample:
 * - Videos ≤ 3 min: first 3000 chars (usually the full transcript)
 * - Videos > 3 min: first 1000 + middle 1000 + last 1000 chars
 */
function smartSampleTranscript(transcript, durationSeconds) {
  if (!transcript) return '';

  const CHUNK = 1000;

  if (!durationSeconds || durationSeconds <= 180) {
    return transcript.slice(0, CHUNK * 3);
  }

  if (transcript.length <= CHUNK * 3) return transcript;

  const len = transcript.length;
  const front  = transcript.slice(0, CHUNK);
  const middle = transcript.slice(Math.floor(len / 2 - CHUNK / 2), Math.floor(len / 2 + CHUNK / 2));
  const end    = transcript.slice(-CHUNK);
  return [front, middle, end].join('\n...\n');
}

function buildSystemPrompt(childProfile) {
  const base = childProfile
    ? `You are a content moderator for a children's video platform.\n\nChild profile:\n${childProfile}`
    : `You are a content moderator for a children's video platform. The viewers are ages 7–8.`;

  return `${base}

Evaluate the video and return ONLY a JSON object with three fields:
- "approved" (boolean)
- "reason" (string, max 100 chars, only populated if approved is false)
- "tags" (array of 3–5 lowercase hyphenated topic tags, e.g. ["outer-space", "minecraft", "planets"])

For tags: use the YouTube topic categories and creator tags as context clues. Prefer specific over generic.

Reject content with: violence or fighting, horror or jump scares, adult humor or innuendo, strong language or name-calling, scary/disturbing themes, dangerous activities children might imitate, creators who regularly yell or demean others.
Approve content that is: educational, entertaining for children, age-appropriate gaming, general family content.
When in doubt, approve.`;
}

function buildUserMessage(video, { topicCategories = [], creatorTags = [] } = {}) {
  return [
    topicCategories.length > 0 ? `YouTube topics: ${topicCategories.join(', ')}` : null,
    creatorTags.length > 0    ? `Creator tags: ${creatorTags.slice(0, 20).join(', ')}` : null,
    `Title: ${video.title || '(no title)'}`,
    `Description: ${(video.description || '').slice(0, 300)}`,
    `Transcript: ${smartSampleTranscript(video.transcript, video.duration_seconds)}`,
  ].filter(Boolean).join('\n');
}

function parseResponse(text) {
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return { approved: true, reason: null, tags: [] };
    const parsed = JSON.parse(jsonMatch[0]);
    return {
      approved: !!parsed.approved,
      reason:   parsed.reason || null,
      tags:     Array.isArray(parsed.tags) ? parsed.tags.map(t => String(t).toLowerCase().trim()) : [],
    };
  } catch {
    console.warn('LLM response parse failed, defaulting to approve:', text.slice(0, 100));
    return { approved: true, reason: null, tags: [] };
  }
}

async function checkWithAnthropic(video, opts = {}) {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const response = await client.messages.create({
    model:      'claude-haiku-4-5',
    max_tokens: 200,
    system:     buildSystemPrompt(opts.childProfile || null),
    messages:   [{ role: 'user', content: buildUserMessage(video, opts) }],
  });
  return parseResponse(response.content[0]?.text || '{}');
}

async function checkWithOllama(video, opts = {}) {
  const ollamaUrl = process.env.OLLAMA_URL || 'http://localhost:11434';
  const response = await axios.post(`${ollamaUrl}/api/generate`, {
    model:  'llama3',
    system: buildSystemPrompt(opts.childProfile || null),
    prompt: buildUserMessage(video, opts),
    stream: false,
  }, { timeout: 30000 });
  return parseResponse(response.data.response || '{}');
}

/**
 * Run the combined appropriateness + tag extraction check.
 *
 * @param {object} video - { title, description, transcript, duration_seconds }
 * @param {object} opts  - { childProfile?, topicCategories?, creatorTags? }
 * @returns {{ approved: boolean, reason: string|null, tags: string[] }}
 */
async function runLlmCheck(video, opts = {}) {
  const provider = process.env.LLM_PROVIDER || 'anthropic';
  try {
    if (provider === 'ollama') {
      return await checkWithOllama(video, opts);
    }
    return await checkWithAnthropic(video, opts);
  } catch (err) {
    console.error('LLM check failed, defaulting to approve:', err.message);
    return { approved: true, reason: null, tags: [] };
  }
}

module.exports = { runLlmCheck, smartSampleTranscript };
```

- [ ] **Step 4: Run tests, verify they pass**

```bash
cd backend && npm test -- --testPathPattern=llm
```

Expected: all 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend/src/llm.js backend/tests/llm.test.js
git commit -m "feat: combined Haiku prompt returns approved+reason+tags, smart transcript sampling"
```

---

### Task 7: Wire new ingest flow — tag storage + child profile context

**Files:**
- Modify: `backend/src/cron.js`

- [ ] **Step 1: Add imports at top of cron.js**

Add/update imports:

```js
const { runLlmCheck } = require('./llm');
const { parseTopicCategories } = require('./youtube');
const db = require('./db');
```

- [ ] **Step 2: Pass child profile + topic categories into the LLM call**

In `processVideo`, replace the LLM call added in Task 3 with this version that passes enriched context and stores tags:

```js
// Pass 2: LLM appropriateness + tag extraction
if (llmState && llmState.calls < llmState.cap) {
  llmState.calls++;

  // Load child profile if available (used per-profile in runNightlyJob)
  const childProfileRow = db.getChildProfile(enrichedVideo._profileId || null);
  const childProfile = childProfileRow?.markdown || null;

  // Parse YouTube topicCategories if present
  const topicCategories = parseTopicCategories(enrichedVideo.topicCategories || []);
  const creatorTags = Array.isArray(enrichedVideo.tags) ? enrichedVideo.tags : [];

  const llmResult = await runLlmCheck(enrichedVideo, { childProfile, topicCategories, creatorTags });

  if (!llmResult.approved) {
    db.updateVideoStatus(videoId, 'rejected', `LLM: ${llmResult.reason || 'inappropriate content'}`);
    stats.rejected++;
    return;
  }

  // Store tags for approved videos
  if (llmResult.tags.length > 0) {
    db.insertVideoTags(videoId, llmResult.tags);
  }
} else if (llmState && llmState.calls >= llmState.cap) {
  console.warn(`[Cron] LLM cap reached, skipping check for ${videoId}`);
}

db.updateVideoStatus(videoId, 'approved');
stats.approved++;
```

- [ ] **Step 3: Attach profileId to videoData before processVideo calls**

In `runNightlyJob`, update the processVideo calls to attach `_profileId` to the video objects:

```js
// In the new videos loop:
video._profileId = profile.id;
await processVideo(video, filterRules, stats, false, null, llmState);

// In the related videos loop:
related._profileId = profile.id;
await processVideo(related, filterRules, stats, true, approvedVideo.video_id, llmState);
```

- [ ] **Step 4: Store topicCategories from YouTube API on enrichedVideo**

In `processVideo`, after the `fullData` merge, add:

```js
// Attach topicCategories from initial RSS/API data if available
if (!enrichedVideo.topicCategories && videoData.topicCategories) {
  enrichedVideo.topicCategories = videoData.topicCategories;
}
```

In `youtube.js` where video metadata is fetched (the `videos.list` response parsing), ensure `topicCategories` is extracted. Find where snippet/statistics are read and add:

```js
topicCategories: item.topicDetails?.topicCategories || [],
```

- [ ] **Step 5: Rebuild and run a cron pass**

```bash
docker compose build backend && docker compose up -d backend
curl -X POST http://localhost:3001/api/admin/cron/run
docker compose logs backend --tail=40
```

Expected: log lines showing tags being stored for approved videos.

- [ ] **Step 6: Verify tags in DB**

```bash
docker compose exec backend node -e "
const db = require('./src/db');
const rows = db.getDb().prepare('SELECT * FROM video_tags LIMIT 20').all();
console.log(rows);
"
```

Expected: tag rows like `{ video_id: 'abc123', tag: 'minecraft', weight: 1 }`.

- [ ] **Step 7: Commit**

```bash
git add backend/src/cron.js backend/src/youtube.js
git commit -m "feat: wire tag extraction into ingest — Haiku stores tags on approved videos, passes child profile context"
```

---

### Task 8: Engagement signal endpoints

**Files:**
- Modify: `backend/src/server.js`
- Modify: `backend/src/db.js` (add `applyReactionToInterests`)

- [ ] **Step 1: Add `applyReactionToInterests` helper to db.js**

Add to `backend/src/db.js` before module.exports:

```js
const REACTION_DELTAS = {
  like:          +1.5,
  dislike:       -0.8,
  'not-interested': -1.0,
};

function applyReactionToInterests(profileId, videoId, reaction) {
  const delta = REACTION_DELTAS[reaction];
  if (delta == null) return;

  const tags = getVideoTags(videoId);
  for (const tag of tags) {
    upsertProfileInterest(profileId, tag, delta, 'behavior');
  }

  // Write insight
  insertProfileInsight(profileId, `${reaction === 'like' ? 'Liked' : 'Disliked'} video (${videoId})`, reaction);
}
```

Add `applyReactionToInterests` to module.exports.

- [ ] **Step 2: Add reaction endpoints to server.js**

In `backend/src/server.js`, after the `not-interested` endpoint, add:

```js
// Kid-facing like/dislike reaction
app.post('/api/video/:videoId/react', (req, res) => {
  const { videoId } = req.params;
  const { profile_id, reaction } = req.body;
  if (!profile_id || !reaction || !['like', 'dislike'].includes(reaction)) {
    return res.status(400).json({ error: 'profile_id and reaction (like|dislike) required' });
  }
  db.applyReactionToInterests(parseInt(profile_id), videoId, reaction);
  res.json({ ok: true });
});

// Parent admin like/dislike reaction (same logic, separate route for clarity)
app.post('/api/admin/video/:videoId/react', (req, res) => {
  const { videoId } = req.params;
  const { profile_id, reaction } = req.body;
  if (!profile_id || !reaction || !['like', 'dislike'].includes(reaction)) {
    return res.status(400).json({ error: 'profile_id and reaction (like|dislike) required' });
  }
  db.applyReactionToInterests(parseInt(profile_id), videoId, reaction);
  res.json({ ok: true });
});
```

- [ ] **Step 3: Rebuild and test endpoints**

```bash
docker compose build backend && docker compose up -d backend
```

Test with curl (use a real video_id and profile_id from your DB):
```bash
curl -X POST http://localhost:3001/api/video/TEST_VIDEO_ID/react \
  -H "Content-Type: application/json" \
  -d '{"profile_id": 5, "reaction": "like"}'
```

Expected: `{"ok":true}`

Verify interests updated:
```bash
docker compose exec backend node -e "
const db = require('./src/db');
console.log(db.getDb().prepare('SELECT * FROM profile_interests WHERE profile_id = 5').all());
"
```

- [ ] **Step 4: Wire "Not Interested" into interest decay**

The existing `POST /api/not-interested` endpoint in `server.js` only blocks and removes from history. Update it to also apply the −1.0 interest signal. Find the handler and add after the `db.blockVideo` call:

```js
app.post('/api/not-interested', (req, res) => {
  const { profile_id, video_id } = req.body;
  if (!profile_id || !video_id) return res.status(400).json({ error: 'Missing fields' });
  db.blockVideo(parseInt(profile_id), video_id);
  db.removeFromHistory(parseInt(profile_id), video_id);
  db.applyReactionToInterests(parseInt(profile_id), video_id, 'not-interested'); // ← add this
  res.json({ ok: true });
});
```

- [ ] **Step 5: Commit**

```bash
git add backend/src/server.js backend/src/db.js
git commit -m "feat: add /api/video/:id/react and /api/admin/video/:id/react endpoints, update profile_interests on reaction; wire not-interested into interest decay"
```

---

### Task 9: Wire watch completion → interest signals

**Files:**
- Modify: `backend/src/server.js`
- Modify: `backend/src/db.js`

- [ ] **Step 1: Add `applyCompletionToInterests` to db.js**

Add to `backend/src/db.js` before module.exports:

```js
function applyCompletionToInterests(profileId, videoId, progressSeconds, durationSeconds) {
  if (!durationSeconds || durationSeconds <= 0) return;

  const ratio = progressSeconds / durationSeconds;
  if (ratio < 0.8) return; // Only signal on 80%+ completion

  let delta;
  if      (durationSeconds > 300) delta = 1.0;  // > 5 min: strong signal
  else if (durationSeconds > 120) delta = 0.5;  // 2–5 min: medium signal
  else                            delta = 0.3;  // < 2 min: weak signal

  const tags = getVideoTags(videoId);
  for (const tag of tags) {
    upsertProfileInterest(profileId, tag, delta, 'behavior');
  }
}
```

Add `applyCompletionToInterests` to module.exports.

- [ ] **Step 2: Call it from the watch-history endpoint**

In `backend/src/server.js`, update the `POST /api/watch-history` handler:

```js
app.post('/api/watch-history', (req, res) => {
  const { profile_id, video_id, progress_seconds, duration_seconds } = req.body;
  if (!profile_id || !video_id) return res.status(400).json({ error: 'Missing required fields' });

  const profileId       = parseInt(profile_id);
  const progressSecs    = Math.floor(progress_seconds || 0);
  const durationSecs    = Math.floor(duration_seconds || 0);

  db.upsertWatchHistory(profileId, video_id, progressSecs, durationSecs);
  db.applyCompletionToInterests(profileId, video_id, progressSecs, durationSecs);

  res.json({ ok: true });
});
```

- [ ] **Step 3: Rebuild and verify**

```bash
docker compose build backend && docker compose up -d backend
```

Watch a video past 80% on the frontend, then check interests:
```bash
docker compose exec backend node -e "
const db = require('./src/db');
console.log(db.getDb().prepare('SELECT * FROM profile_interests ORDER BY weight DESC LIMIT 10').all());
"
```

Expected: interest rows with weights > 0 for video tags.

- [ ] **Step 4: Commit**

```bash
git add backend/src/server.js backend/src/db.js
git commit -m "feat: apply completion-based interest signals from watch-history endpoint (80%+ threshold)"
```

---

### Task 10: Wire Like/Dislike buttons in Watch.jsx

**Files:**
- Modify: `frontend/src/pages/Watch.jsx`

- [ ] **Step 1: Add reaction state and handler to Watch.jsx**

In `frontend/src/pages/Watch.jsx`, add state for the current reaction and a handler:

```jsx
const [reaction, setReaction] = useState(null); // null | 'like' | 'dislike'

const handleReact = (r) => {
  const next = reaction === r ? null : r; // toggle off if same
  setReaction(next);
  if (!profileId || !videoId) return;
  fetch(`/api/video/${videoId}/react`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ profile_id: profileId, reaction: next || r }),
  }).catch(() => {});
};
```

Reset reaction when video changes — add to the `useEffect` that calls `openVideo`:

```jsx
useEffect(() => {
  if (videoId && videoId !== activeVideoId) openVideo(videoId);
  setVideoEnded(false);
  setReaction(null); // reset on new video
}, [videoId]);
```

- [ ] **Step 2: Update the Like and Dislike buttons to use the handler and show active state**

Find the Like/Dislike pill in Watch.jsx (the `bg-yt-card rounded-full` div). Replace the two buttons:

```jsx
<div className="flex items-center bg-yt-card rounded-full flex-shrink-0">
  <button
    className={`flex items-center gap-1.5 pl-4 pr-3 py-2 transition-colors ${reaction === 'like' ? 'text-yt-text' : 'text-yt-muted'}`}
    onClick={() => handleReact('like')}
  >
    <svg viewBox="0 0 24 24" className={`w-[18px] h-[18px] flex-shrink-0 ${reaction === 'like' ? 'fill-yt-text' : 'fill-yt-muted'}`}>
      <path d="M1 21h4V9H1v12zm22-11c0-1.1-.9-2-2-2h-6.31l.95-4.57.03-.32c0-.41-.17-.79-.44-1.06L14.17 1 7.59 7.59C7.22 7.95 7 8.45 7 9v10c0 1.1.9 2 2 2h9c.83 0 1.54-.5 1.84-1.22l3.02-7.05c.09-.23.14-.47.14-.73v-2z"/>
    </svg>
    <span className="text-sm font-medium">Like</span>
  </button>
  <div className="w-px h-5 bg-yt-border flex-shrink-0" />
  <button
    className="flex items-center px-3 py-2"
    onClick={() => handleReact('dislike')}
  >
    <svg viewBox="0 0 24 24" className={`w-[18px] h-[18px] flex-shrink-0 ${reaction === 'dislike' ? 'fill-yt-text' : 'fill-yt-muted'}`}>
      <path d="M15 3H6c-.83 0-1.54.5-1.84 1.22l-3.02 7.05c-.09.23-.14.47-.14.73v2c0 1.1.9 2 2 2h6.31l-.95 4.57-.03.32c0 .41.17.79.44 1.06L9.83 23l6.59-6.59c.36-.36.58-.86.58-1.41V5c0-1.1-.9-2-2-2zm4 0v12h4V3h-4z"/>
    </svg>
  </button>
</div>
```

- [ ] **Step 3: Rebuild frontend and verify**

```bash
docker compose build frontend && docker compose up -d frontend
```

Open a video, tap Like. Check that the icon highlights and a network request fires to `/api/video/:id/react`.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/Watch.jsx
git commit -m "feat: wire Like/Dislike buttons to /api/video/:id/react, toggle active state"
```

---

### Task 11: Recommendation scoring engine

**Files:**
- Create: `backend/src/recommendations.js`
- Create: `backend/tests/recommendations.test.js`

- [ ] **Step 1: Write failing tests**

Create `backend/tests/recommendations.test.js`:

```js
// Must set DB_PATH before requiring db
const { setupTestDb, seedProfile, seedVideo, seedTag, seedInterest } = require('./helpers/testDb');

let db;
let getRecommendedVideos;

beforeAll(() => {
  db = setupTestDb();
  getRecommendedVideos = require('../src/recommendations').getRecommendedVideos;

  seedProfile(db, { id: 1, name: 'Child1' });

  // Videos
  seedVideo(db, { video_id: 'v1', channel_id: 'ch1', title: 'Space documentary', duration_seconds: 600 });
  seedVideo(db, { video_id: 'v2', channel_id: 'ch2', title: 'Minecraft build', duration_seconds: 500 });
  seedVideo(db, { video_id: 'v3', channel_id: 'ch1', title: 'Saturn rings', duration_seconds: 700 });
  seedVideo(db, { video_id: 'v4', channel_id: 'ch3', title: 'Cooking show', duration_seconds: 400 });

  // Tags
  seedTag(db, 'v1', 'outer-space');
  seedTag(db, 'v1', 'planets');
  seedTag(db, 'v3', 'outer-space');
  seedTag(db, 'v3', 'saturn');
  seedTag(db, 'v2', 'minecraft');
  seedTag(db, 'v4', 'cooking');

  // Profile interests — strong space interest
  seedInterest(db, 1, 'outer-space', 3.0);
  seedInterest(db, 1, 'planets', 1.5);
  seedInterest(db, 1, 'minecraft', 0.5);
});

test('returns recommended videos ordered by score', () => {
  const results = getRecommendedVideos(db, 'v1', 1);
  // v3 has outer-space (3.0) + saturn (0) = 3.0, plus same channel bonus 0.3 = 3.3
  // v2 has minecraft (0.5) = 0.5
  expect(results[0].video_id).toBe('v3');
  expect(results[1].video_id).toBe('v2');
});

test('excludes the current video', () => {
  const results = getRecommendedVideos(db, 'v1', 1);
  expect(results.map(v => v.video_id)).not.toContain('v1');
});

test('falls back to recency when profile has no interests', () => {
  seedProfile(db, { id: 2, name: 'Child2' });
  const results = getRecommendedVideos(db, 'v1', 2);
  expect(results.length).toBeGreaterThan(0);
  // Should not throw, should return videos in some order
});

test('does not exceed limit', () => {
  const results = getRecommendedVideos(db, 'v1', 1, 2);
  expect(results.length).toBeLessThanOrEqual(2);
});
```

- [ ] **Step 2: Run tests, verify they fail**

```bash
cd backend && npm test -- --testPathPattern=recommendations
```

Expected: `Cannot find module '../src/recommendations'`

- [ ] **Step 3: Implement recommendations.js**

Create `backend/src/recommendations.js`:

```js
'use strict';

/**
 * Returns recommended videos for a given video and profile.
 * Scores approved videos by tag overlap with profile interests.
 * Falls back to recency order when the profile has no interest data.
 *
 * @param {object} db        - db module (passed in for testability)
 * @param {string} videoId   - current video being watched
 * @param {number} profileId - profile to personalise for
 * @param {number} limit     - max results (default 15)
 * @returns {Array} video rows with optional `score` field
 */
function getRecommendedVideos(db, videoId, profileId, limit = 15) {
  // Get current video's channel for same-channel bonus
  const current = db.getDb().prepare(
    `SELECT channel_id FROM videos WHERE video_id = ?`
  ).get(videoId);
  const channelId = current?.channel_id || '';

  // Check if this profile has any interest data at all
  const hasInterests = db.getDb().prepare(
    `SELECT 1 FROM profile_interests WHERE profile_id = ? LIMIT 1`
  ).get(profileId);

  if (!hasInterests) {
    return db.getDb().prepare(`
      SELECT v.*, c.thumbnail_url as channel_thumbnail_img
      FROM videos v
      LEFT JOIN (SELECT channel_id, thumbnail_url FROM channels GROUP BY channel_id) c
        ON v.channel_id = c.channel_id
      WHERE v.status = 'approved'
        AND v.video_id != ?
        AND v.video_id NOT IN (
          SELECT value FROM filter_rules
          WHERE rule_type = 'video_block'
            AND (profile_id = ? OR profile_id IS NULL)
        )
        AND v.video_id NOT IN (
          SELECT video_id FROM watch_history
          WHERE profile_id = ?
            AND CAST(progress_seconds AS REAL) / NULLIF(duration_seconds, 0) > 0.8
        )
      ORDER BY v.published_at DESC
      LIMIT ?
    `).all(videoId, profileId, profileId, limit);
  }

  return db.getDb().prepare(`
    SELECT v.*, c.thumbnail_url as channel_thumbnail_img,
      SUM(pi.weight) +
      CASE WHEN v.channel_id = ? THEN 0.3 ELSE 0.0 END AS score
    FROM videos v
    JOIN video_tags vt ON v.video_id = vt.video_id
    JOIN profile_interests pi ON vt.tag = pi.tag AND pi.profile_id = ?
    LEFT JOIN (SELECT channel_id, thumbnail_url FROM channels GROUP BY channel_id) c
      ON v.channel_id = c.channel_id
    WHERE v.status = 'approved'
      AND v.video_id != ?
      AND v.video_id NOT IN (
        SELECT value FROM filter_rules
        WHERE rule_type = 'video_block'
          AND (profile_id = ? OR profile_id IS NULL)
      )
      AND v.video_id NOT IN (
        SELECT video_id FROM watch_history
        WHERE profile_id = ?
          AND CAST(progress_seconds AS REAL) / NULLIF(duration_seconds, 0) > 0.8
      )
    GROUP BY v.video_id
    ORDER BY score DESC
    LIMIT ?
  `).all(channelId, profileId, videoId, profileId, profileId, limit);
}

module.exports = { getRecommendedVideos };
```

- [ ] **Step 4: Run tests, verify they pass**

```bash
cd backend && npm test -- --testPathPattern=recommendations
```

Expected: all 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend/src/recommendations.js backend/tests/recommendations.test.js
git commit -m "feat: add scored recommendation engine (tag overlap + channel bonus + recency fallback)"
```

---

### Task 12: Wire recommendations into the related endpoint

**Files:**
- Modify: `backend/src/server.js`

- [ ] **Step 1: Update `/api/related/:videoId` to use recommendations.js**

In `backend/src/server.js`, add import at the top:

```js
const recommendations = require('./recommendations');
```

Find the `GET /api/related/:videoId` handler and replace it:

```js
// Get related/up-next videos for a video
app.get('/api/related/:videoId', (req, res) => {
  const { videoId } = req.params;
  const profileId = parseInt(req.query.profile_id);

  if (profileId) {
    const videos = recommendations.getRecommendedVideos(db, videoId, profileId);
    return res.json({ videos });
  }

  // Fallback: no profile context — use legacy related query
  const videos = db.getRelatedVideos(videoId);
  res.json({ videos });
});
```

- [ ] **Step 2: Update Watch.jsx to pass profileId to the related fetch**

In `frontend/src/pages/Watch.jsx`, find the `useEffect` that fetches `/api/related/:videoId` and update the URL:

```jsx
useEffect(() => {
  if (!videoId) return;
  fetch(`/api/related/${videoId}?profile_id=${profileId}`)
    .then(r => r.json())
    .then(data => {
      const videos = data.videos || [];
      setRelated(videos);
      setRelatedFilter('all');
      if (videos.length > 0) setNextVideo(videos[0]);
    })
    .catch(() => {});
}, [videoId, setNextVideo]);
```

- [ ] **Step 3: Rebuild both containers and test**

```bash
docker compose build && docker compose up -d
```

Open a video that has tags. The Up Next sidebar should now show topic-matched videos instead of same-channel-only results.

- [ ] **Step 4: Commit**

```bash
git add backend/src/server.js frontend/src/pages/Watch.jsx
git commit -m "feat: wire /api/related/:videoId to scored recommendation engine, pass profile_id from Watch.jsx"
```

---

### Task 13: Daily insights pass + interest decay

**Files:**
- Create: `backend/src/insights.js`

- [ ] **Step 1: Create insights.js**

Create `backend/src/insights.js`:

```js
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
```

- [ ] **Step 2: Schedule the daily pass in cron.js**

In `backend/src/cron.js`, add import:

```js
const { runDailyInsightsPass } = require('./insights');
```

In the `scheduleJob` function, add a second cron job after the existing one:

```js
function scheduleJob() {
  const schedule = process.env.CRON_SCHEDULE || '0 2 * * *';
  console.log(`Cron job scheduled: ${schedule}`);
  cron.schedule(schedule, () => {
    console.log('[Cron] Triggered by schedule');
    runNightlyJob().catch(err => console.error('[Cron] Unhandled error:', err));
  });

  // Daily insights pass — 3am, after main ingest
  cron.schedule('0 3 * * *', () => {
    console.log('[Insights] Triggered by schedule');
    runDailyInsightsPass().catch(err => console.error('[Insights] Unhandled error:', err));
  });
}
```

- [ ] **Step 3: Expose manual trigger in server.js**

In `backend/src/server.js`, add import and endpoint:

```js
const { runDailyInsightsPass } = require('./insights');

// Manual trigger for daily insights pass
app.post('/api/admin/insights/run', async (req, res) => {
  try {
    await runDailyInsightsPass();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
```

- [ ] **Step 4: Rebuild and manually trigger to test**

```bash
docker compose build backend && docker compose up -d backend
curl -X POST http://localhost:3001/api/admin/insights/run
```

Expected: `{"ok":true}` and log output showing profile pass results.

Verify insights in DB:
```bash
docker compose exec backend node -e "
const db = require('./src/db');
console.log(db.getDb().prepare('SELECT * FROM profile_insights ORDER BY created_at DESC LIMIT 10').all());
"
```

- [ ] **Step 5: Commit**

```bash
git add backend/src/insights.js backend/src/cron.js backend/src/server.js
git commit -m "feat: daily insights pass — tag engagement aggregation, session-gated decay, 3am schedule"
```

---

### Task 14: Child profile module

**Files:**
- Create: `backend/src/childProfile.js`

- [ ] **Step 1: Create childProfile.js**

Create `backend/src/childProfile.js`:

```js
'use strict';

const Anthropic = require('@anthropic-ai/sdk');
const db = require('./db');

/**
 * Generate an initial child profile markdown from guided interview answers.
 *
 * @param {string} profileName - e.g. "Child1"
 * @param {{ ageGrade, loves, avoid, tone, other }} answers
 * @returns {Promise<string>} markdown profile text
 */
async function generateChildProfile(profileName, answers) {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const userMessage = [
    `Child name: ${profileName}`,
    `Age / grade: ${answers.ageGrade}`,
    `Loves: ${answers.loves}`,
    `Avoid: ${answers.avoid}`,
    `Acceptable tone: ${answers.tone}`,
    answers.other ? `Other notes: ${answers.other}` : null,
  ].filter(Boolean).join('\n');

  const response = await client.messages.create({
    model:      'claude-haiku-4-5',
    max_tokens: 300,
    system: `Generate a concise child profile in markdown for a kids' content recommendation and moderation system.
Write in second person addressing the system — what it should know about this child and how to evaluate content for them.
Keep it under 120 words. Cover: age, interests, things to avoid, and tone guidelines.
Do not include headers or bullet points — write it as a short paragraph.`,
    messages: [{ role: 'user', content: userMessage }],
  });

  return (response.content[0]?.text || '').trim();
}

/**
 * Extract topic tags from a child profile markdown for use as parent-floor interests.
 * Returns an array of lowercase hyphenated tag strings.
 *
 * @param {string} markdown
 * @returns {Promise<string[]>}
 */
async function extractParentTags(markdown) {
  if (!markdown) return [];

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const response = await client.messages.create({
    model:      'claude-haiku-4-5',
    max_tokens: 100,
    system: 'Extract topic interest tags from a child profile. Return ONLY a JSON array of 3–8 lowercase hyphenated tags representing topics the child LIKES (not dislikes). Example: ["minecraft","outer-space","animals"]',
    messages: [{ role: 'user', content: markdown }],
  });

  try {
    const text = response.content[0]?.text || '[]';
    const match = text.match(/\[[\s\S]*\]/);
    if (!match) return [];
    const tags = JSON.parse(match[0]);
    return Array.isArray(tags) ? tags.map(t => String(t).toLowerCase().trim()) : [];
  } catch {
    return [];
  }
}

/**
 * Refresh the parent-source interest rows from the current child profile markdown.
 * Called after every profile save (manual or consolidation).
 *
 * @param {number} profileId
 * @param {string} markdown
 */
async function refreshParentInterests(profileId, markdown) {
  const tags = await extractParentTags(markdown);

  // Remove old parent interests
  db.deleteParentInterests(profileId);

  // Insert new ones at baseline weight 0.5
  for (const tag of tags) {
    db.setParentInterest(profileId, tag, 0.5);
  }
}

module.exports = { generateChildProfile, extractParentTags, refreshParentInterests };
```

- [ ] **Step 2: Add child profile API endpoints to server.js**

In `backend/src/server.js`, add import:

```js
const childProfile = require('./childProfile');
```

Add these endpoints after the admin section:

```js
// ── Child Profile Routes ──────────────────────────────────────────────────────

// Get child profile for a profile
app.get('/api/admin/child-profile/:profileId', (req, res) => {
  const profileId = parseInt(req.params.profileId);
  const profile = db.getChildProfile(profileId);
  res.json({ profile: profile || null });
});

// Save child profile (manual edit by parent)
app.post('/api/admin/child-profile/:profileId', async (req, res) => {
  const profileId = parseInt(req.params.profileId);
  const { markdown } = req.body;
  if (!markdown) return res.status(400).json({ error: 'markdown required' });

  db.saveChildProfile(profileId, markdown, 'parent');
  await childProfile.refreshParentInterests(profileId, markdown).catch(() => {});
  res.json({ ok: true });
});

// Generate initial child profile from interview answers
app.post('/api/admin/child-profile/:profileId/generate', async (req, res) => {
  const profileId = parseInt(req.params.profileId);
  const { profileName, answers } = req.body;

  if (!profileName || !answers) {
    return res.status(400).json({ error: 'profileName and answers required' });
  }

  try {
    const markdown = await childProfile.generateChildProfile(profileName, answers);
    db.saveChildProfile(profileId, markdown, 'parent');
    await childProfile.refreshParentInterests(profileId, markdown).catch(() => {});
    res.json({ ok: true, markdown });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get recent insights for a profile
app.get('/api/admin/insights/:profileId', (req, res) => {
  const profileId = parseInt(req.params.profileId);
  const days = parseInt(req.query.days) || 7;
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const insights = db.getDb().prepare(`
    SELECT * FROM profile_insights
    WHERE profile_id = ? AND created_at > ?
    ORDER BY created_at DESC
    LIMIT 50
  `).all(profileId, cutoff);
  res.json({ insights });
});
```

- [ ] **Step 3: Rebuild and test generate endpoint**

```bash
docker compose build backend && docker compose up -d backend
```

```bash
curl -X POST http://localhost:3001/api/admin/child-profile/5/generate \
  -H "Content-Type: application/json" \
  -d '{
    "profileName": "Child1",
    "answers": {
      "ageGrade": "8 years old, 3rd grade",
      "loves": "Minecraft, outer space, planets, building games",
      "avoid": "violence, scary content",
      "tone": "silly humor is fine, no yelling or trash talk",
      "other": ""
    }
  }'
```

Expected: `{"ok":true,"markdown":"Child1 is 8 years old..."}` and parent interests in profile_interests table.

- [ ] **Step 4: Commit**

```bash
git add backend/src/childProfile.js backend/src/server.js
git commit -m "feat: child profile module — generate from interview, save, extract parent interest tags"
```

---

### Task 15: Admin UI — child profile setup interview

**Files:**
- Modify: `frontend/src/pages/Admin.jsx`

- [ ] **Step 1: Add a ChildProfileSetup component inside Admin.jsx**

In `frontend/src/pages/Admin.jsx`, add this component definition before the main `Admin` export:

```jsx
const INTERVIEW_QUESTIONS = [
  { key: 'ageGrade',  label: 'How old is {name} and what grade are they in?',  placeholder: 'e.g. 8 years old, 3rd grade' },
  { key: 'loves',     label: 'What topics or subjects does {name} love?',       placeholder: 'e.g. Minecraft, outer space, cooking, animals' },
  { key: 'avoid',     label: 'What topics or content should we avoid?',          placeholder: 'e.g. violence, scary content, adult humor' },
  { key: 'tone',      label: 'How would you describe acceptable tone?',          placeholder: 'e.g. silly humor is fine, no yelling or trash talk' },
  { key: 'other',     label: 'Anything else we should know about {name}?',       placeholder: 'Optional — leave blank to skip' },
];

function ChildProfileSetup({ profile, onComplete }) {
  const [step, setStep]       = useState(0);
  const [answers, setAnswers] = useState({});
  const [loading, setLoading] = useState(false);

  const question = INTERVIEW_QUESTIONS[step];
  const label    = question.label.replace(/{name}/g, profile.name);

  const handleNext = async () => {
    if (step < INTERVIEW_QUESTIONS.length - 1) {
      setStep(s => s + 1);
      return;
    }
    // Final step — generate profile
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/child-profile/${profile.id}/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profileName: profile.name, answers }),
      });
      const data = await res.json();
      if (data.ok) onComplete(data.markdown);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-yt-card rounded-xl p-5 space-y-4">
      <p className="text-yt-muted text-xs uppercase tracking-wider">
        Setting up {profile.name}'s profile — {step + 1} of {INTERVIEW_QUESTIONS.length}
      </p>
      <p className="text-yt-text font-medium">{label}</p>
      <textarea
        className="w-full bg-yt-surface border border-yt-border rounded-lg px-3 py-2 text-yt-text text-sm resize-none focus:outline-none focus:border-yt-muted"
        rows={3}
        placeholder={question.placeholder}
        value={answers[question.key] || ''}
        onChange={e => setAnswers(a => ({ ...a, [question.key]: e.target.value }))}
      />
      <button
        onClick={handleNext}
        disabled={loading || (!answers[question.key] && question.key !== 'other')}
        className="px-4 py-2 bg-yt-red text-white rounded-lg text-sm font-medium disabled:opacity-50"
      >
        {loading ? 'Generating…' : step < INTERVIEW_QUESTIONS.length - 1 ? 'Next →' : 'Generate Profile'}
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Add ChildProfileSection component**

Add this component to `Admin.jsx` as well:

```jsx
function ChildProfileSection({ profile }) {
  const [profileData, setProfileData] = useState(null);
  const [editing, setEditing]         = useState(false);
  const [draft, setDraft]             = useState('');
  const [saving, setSaving]           = useState(false);
  const [insights, setInsights]       = useState([]);

  useEffect(() => {
    fetch(`/api/admin/child-profile/${profile.id}`)
      .then(r => r.json())
      .then(d => {
        setProfileData(d.profile);
        if (d.profile) setDraft(d.profile.markdown);
      })
      .catch(() => {});

    fetch(`/api/admin/insights/${profile.id}?days=7`)
      .then(r => r.json())
      .then(d => setInsights(d.insights || []))
      .catch(() => {});
  }, [profile.id]);

  const handleSave = async () => {
    setSaving(true);
    await fetch(`/api/admin/child-profile/${profile.id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ markdown: draft }),
    }).catch(() => {});
    setProfileData(p => ({ ...p, markdown: draft, updated_by: 'parent', updated_at: new Date().toISOString() }));
    setEditing(false);
    setSaving(false);
  };

  if (!profileData) {
    return (
      <ChildProfileSetup
        profile={profile}
        onComplete={(markdown) => setProfileData({ markdown, updated_by: 'parent', updated_at: new Date().toISOString() })}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="bg-yt-card rounded-xl p-5">
        <div className="flex items-center justify-between mb-3">
          <p className="text-yt-text font-medium text-sm">{profile.name}'s Profile</p>
          <span className="text-yt-muted text-xs">
            Updated {new Date(profileData.updated_at).toLocaleDateString()} by {profileData.updated_by}
          </span>
        </div>
        {editing ? (
          <>
            <textarea
              className="w-full bg-yt-surface border border-yt-border rounded-lg px-3 py-2 text-yt-text text-sm resize-none focus:outline-none focus:border-yt-muted"
              rows={6}
              value={draft}
              onChange={e => setDraft(e.target.value)}
            />
            <div className="flex gap-2 mt-2">
              <button onClick={handleSave} disabled={saving} className="px-4 py-1.5 bg-yt-red text-white rounded-lg text-sm disabled:opacity-50">
                {saving ? 'Saving…' : 'Save'}
              </button>
              <button onClick={() => { setEditing(false); setDraft(profileData.markdown); }} className="px-4 py-1.5 bg-yt-card border border-yt-border text-yt-text rounded-lg text-sm">
                Cancel
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="text-yt-muted text-sm leading-relaxed">{profileData.markdown}</p>
            <button onClick={() => setEditing(true)} className="mt-3 px-4 py-1.5 bg-yt-card border border-yt-border text-yt-text rounded-lg text-sm">
              Edit
            </button>
          </>
        )}
      </div>

      {insights.length > 0 && (
        <div className="bg-yt-card rounded-xl p-5">
          <p className="text-yt-muted text-xs uppercase tracking-wider mb-3">Recent Observations (7 days)</p>
          <ul className="space-y-1">
            {insights.map(i => (
              <li key={i.id} className="text-yt-text text-sm">
                <span className="text-yt-muted text-xs mr-2">
                  {new Date(i.created_at).toLocaleDateString()}
                </span>
                {i.insight}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Add the ChildProfileSection to the Admin page for each profile**

Inside the main `Admin` component, add a "Child Profiles" section. Find where profiles are rendered in Admin.jsx and add after the existing profile sections:

```jsx
{/* Child Profiles */}
<section className="mt-8">
  <h2 className="text-yt-text font-semibold text-base mb-4">Child Profiles</h2>
  <div className="space-y-6">
    {profiles.map(profile => (
      <div key={profile.id}>
        <p className="text-yt-muted text-xs uppercase tracking-wider mb-2">{profile.name}</p>
        <ChildProfileSection profile={profile} />
      </div>
    ))}
  </div>
</section>
```

Make sure `profiles` state is loaded in Admin — check if it's already fetched; if not, add:

```jsx
const [profiles, setProfiles] = useState([]);

useEffect(() => {
  fetch('/api/profiles')
    .then(r => r.json())
    .then(d => setProfiles(d.profiles || []))
    .catch(() => {});
}, []);
```

- [ ] **Step 4: Rebuild frontend and verify**

```bash
docker compose build frontend && docker compose up -d frontend
```

Navigate to admin panel. You should see a "Child Profiles" section. For profiles without a profile doc, the 5-question interview appears. Answering it generates and saves a profile.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/Admin.jsx
git commit -m "feat: admin child profile UI — guided setup interview + view/edit + recent insights shelf"
```

---

### Task 16: Weekly consolidation pass

**Files:**
- Modify: `backend/src/insights.js`
- Modify: `backend/src/cron.js`
- Modify: `backend/src/server.js`

- [ ] **Step 1: Add `runWeeklyConsolidationPass` to insights.js**

Add to `backend/src/insights.js` (add Anthropic import at top):

```js
const Anthropic = require('@anthropic-ai/sdk');
const childProfile = require('./childProfile');
```

Add function before `module.exports`:

```js
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
```

Update module.exports:

```js
module.exports = { runDailyInsightsPass, runWeeklyConsolidationPass };
```

- [ ] **Step 2: Schedule weekly pass in cron.js**

In `backend/src/cron.js`, update import:

```js
const { runDailyInsightsPass, runWeeklyConsolidationPass } = require('./insights');
```

In `scheduleJob`, add after the daily insights schedule:

```js
  // Weekly consolidation pass — Sunday at 4am
  cron.schedule('0 4 * * 0', () => {
    console.log('[Consolidation] Triggered by schedule');
    runWeeklyConsolidationPass().catch(err => console.error('[Consolidation] Unhandled error:', err));
  });
```

- [ ] **Step 3: Add manual trigger endpoint to server.js**

In `backend/src/server.js`, update import:

```js
const { runDailyInsightsPass, runWeeklyConsolidationPass } = require('./insights');
```

Add manual trigger endpoint:

```js
// Manual trigger for weekly consolidation pass
app.post('/api/admin/consolidation/run', async (req, res) => {
  try {
    await runWeeklyConsolidationPass();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
```

- [ ] **Step 4: Add "Run consolidation now" button to Admin.jsx**

In the `ChildProfileSection` component in `Admin.jsx`, add a consolidation trigger below the profile card:

```jsx
const [consolidating, setConsolidating] = useState(false);

const handleConsolidate = async () => {
  setConsolidating(true);
  await fetch('/api/admin/consolidation/run', { method: 'POST' }).catch(() => {});
  // Refresh profile and insights
  const [pd, ins] = await Promise.all([
    fetch(`/api/admin/child-profile/${profile.id}`).then(r => r.json()),
    fetch(`/api/admin/insights/${profile.id}?days=7`).then(r => r.json()),
  ]).catch(() => [{}, {}]);
  if (pd?.profile) { setProfileData(pd.profile); setDraft(pd.profile.markdown); }
  if (ins?.insights) setInsights(ins.insights);
  setConsolidating(false);
};
```

Add button below the insights shelf:

```jsx
<button
  onClick={handleConsolidate}
  disabled={consolidating}
  className="px-4 py-1.5 bg-yt-card border border-yt-border text-yt-muted rounded-lg text-sm"
>
  {consolidating ? 'Running…' : 'Run consolidation now'}
</button>
```

- [ ] **Step 5: Rebuild both containers and run end-to-end test**

```bash
docker compose build && docker compose up -d
```

Trigger insights pass, then consolidation:
```bash
curl -X POST http://localhost:3001/api/admin/insights/run
curl -X POST http://localhost:3001/api/admin/consolidation/run
```

Check Admin panel — the child profile should show "Updated by consolidation" with a refreshed timestamp.

- [ ] **Step 6: Commit**

```bash
git add backend/src/insights.js backend/src/cron.js backend/src/server.js frontend/src/pages/Admin.jsx
git commit -m "feat: weekly consolidation pass — Haiku updates child profile from insights, refreshes parent interests, Sunday 4am schedule"
```

- [ ] **Step 7: Push all changes**

```bash
git push origin main
```

---

## Verification Checklist

After all tasks complete, verify the full loop works:

- [ ] Shorts are being rejected (check filter log in admin panel for "YouTube Short" reasons)
- [ ] LLM rejections appear in filter log
- [ ] New approved videos have rows in `video_tags`
- [ ] Watching a video past 80% creates/updates `profile_interests` rows
- [ ] Liking/disliking a video on Watch page updates `profile_interests`
- [ ] Up Next sidebar shows different results than before (no longer same-channel-only)
- [ ] Admin panel shows Child Profiles section with setup interview for new profiles
- [ ] Running consolidation updates the child profile markdown
- [ ] Child profile "Updated by consolidation" label appears after consolidation run
