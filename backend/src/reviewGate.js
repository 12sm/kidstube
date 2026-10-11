'use strict';

// Review gate for videos that did NOT come from a parent-approved channel
// (open-YouTube search results and enrichment-topic searches).
//
// Such a video is playable for a child only after the LLM has approved it for
// THAT child's profile. Verdicts are cached per (video, profile) in
// video_reviews. Any LLM error or timeout leaves the video unplayable (fail
// closed); errors are not cached, so the next attempt retries.

const llm = require('./llm');

const GATED_SOURCES = new Set(['search', 'enrichment']);
const DEFAULT_TIMEOUT_MS = parseInt(process.env.REVIEW_GATE_TIMEOUT_MS, 10) || 8000;
const PROMPT_VERSION = 'gate-v1';
// Age used when a profile states no age and no other profile does either.
const FALLBACK_AGE = 5;

const KID_NOTICE = "Oops! That video isn't ready yet. Let's watch something else!";

function ensureSchema(dbModule) {
  dbModule.getDb().exec(`
    CREATE TABLE IF NOT EXISTS video_reviews (
      video_id       TEXT    NOT NULL,
      profile_id     INTEGER NOT NULL,
      verdict        TEXT    NOT NULL CHECK (verdict IN ('approved', 'rejected')),
      reason         TEXT,
      tags_json      TEXT,
      age            INTEGER,
      profile_source TEXT,
      prompt_version TEXT,
      reviewed_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (video_id, profile_id)
    );
    CREATE INDEX IF NOT EXISTS idx_video_reviews_profile ON video_reviews(profile_id, verdict);
  `);
}

const prepared = new WeakSet();
// Create the table on first use, so scripts and the cron work without a
// separate migration step (server.js also calls ensureSchema at startup).
function ready(dbModule) {
  const raw = dbModule.getDb();
  if (!prepared.has(raw)) { ensureSchema(dbModule); prepared.add(raw); }
  return raw;
}

function isGated(video) {
  if (!video) return true;
  return video.needs_llm_review === 1 || GATED_SOURCES.has(video.discovery_source);
}

// ── Profiles ────────────────────────────────────────────────────────────────

function childProfiles(dbModule) {
  return dbModule.getDb().prepare(`
    SELECT p.id AS profile_id, cp.markdown
    FROM profiles p
    LEFT JOIN child_profiles cp ON cp.profile_id = p.id
    ORDER BY p.id
  `).all().map(r => {
    const markdown = r.markdown && r.markdown.trim() ? r.markdown.trim() : null;
    return { profileId: r.profile_id, markdown, age: llm.ageFromProfile(markdown) };
  });
}

/**
 * The youngest child with a stated age, or null if no profile states one.
 */
function youngestProfile(dbModule) {
  const aged = childProfiles(dbModule).filter(p => p.age != null);
  if (aged.length === 0) return null;
  return aged.reduce((a, b) => (b.age < a.age ? b : a));
}

/**
 * Which profile text and age to judge a video against for `profileId`.
 * - the profile's own markdown when it has one;
 * - otherwise the youngest child's profile (fail safe, never an older default);
 * - otherwise no profile text, and the prompt's young-child fallback.
 * Age: stated in the profile, else the youngest stated age, else FALLBACK_AGE.
 */
function resolveReviewProfile(dbModule, profileId) {
  const all = childProfiles(dbModule);
  const youngest = youngestProfile(dbModule);
  const own = all.find(p => p.profileId === Number(profileId));

  if (own && own.markdown) {
    return {
      profileId: own.profileId,
      markdown: own.markdown,
      age: own.age ?? youngest?.age ?? FALLBACK_AGE,
      source: 'profile',
    };
  }
  if (youngest) {
    return { profileId: Number(profileId) || null, markdown: youngest.markdown, age: youngest.age, source: 'youngest' };
  }
  return { profileId: Number(profileId) || null, markdown: null, age: FALLBACK_AGE, source: 'fallback' };
}

// ── Verdict cache ───────────────────────────────────────────────────────────

function getVerdict(dbModule, videoId, profileId) {
  return ready(dbModule).prepare(
    'SELECT * FROM video_reviews WHERE video_id = ? AND profile_id = ?'
  ).get(videoId, profileId) || null;
}

function saveVerdict(dbModule, { videoId, profileId, verdict, reason, tags, age, profileSource }) {
  ready(dbModule).prepare(`
    INSERT INTO video_reviews (video_id, profile_id, verdict, reason, tags_json, age, profile_source, prompt_version, reviewed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(video_id, profile_id) DO UPDATE SET
      verdict = excluded.verdict, reason = excluded.reason, tags_json = excluded.tags_json,
      age = excluded.age, profile_source = excluded.profile_source,
      prompt_version = excluded.prompt_version, reviewed_at = CURRENT_TIMESTAMP
  `).run(videoId, profileId, verdict, reason || null, JSON.stringify(tags || []), age ?? null, profileSource || null, PROMPT_VERSION);
}

// ── Review ──────────────────────────────────────────────────────────────────

const inFlight = new Map();

/**
 * Review `video` for `profileId`, using the cached verdict when there is one.
 *
 * @returns {Promise<{ verdict: 'approved'|'rejected'|'error', reason: string|null, tags: string[], cached: boolean, error?: string }>}
 */
async function reviewForProfile(dbModule, video, profileId, opts = {}) {
  const { force = false, timeoutMs = DEFAULT_TIMEOUT_MS, review = llm.runLlmReviewStrict } = opts;
  if (!force) {
    const cached = getVerdict(dbModule, video.video_id, profileId);
    if (cached) {
      return { verdict: cached.verdict, reason: cached.reason, tags: JSON.parse(cached.tags_json || '[]'), cached: true };
    }
  }

  const key = `${video.video_id}|${profileId}|${force ? 'f' : ''}`;
  if (inFlight.has(key)) return inFlight.get(key);

  const p = (async () => {
    const who = resolveReviewProfile(dbModule, profileId);
    try {
      const result = await review(video, {
        childProfile: who.markdown,
        age: who.age,
        strict: true,
        timeoutMs,
      });
      const verdict = result.approved ? 'approved' : 'rejected';
      saveVerdict(dbModule, {
        videoId: video.video_id, profileId, verdict,
        reason: result.approved ? null : (result.reason || 'not appropriate'),
        tags: result.tags, age: who.age, profileSource: who.source,
      });
      if (result.approved && result.tags && result.tags.length > 0) {
        dbModule.insertVideoTags(video.video_id, result.tags);
      }
      return { verdict, reason: result.approved ? null : (result.reason || null), tags: result.tags || [], cached: false };
    } catch (err) {
      console.error(`[ReviewGate] review failed for ${video.video_id} (profile ${profileId}), keeping it unplayable:`, err.message);
      return { verdict: 'error', reason: null, tags: [], cached: false, error: err.message };
    } finally {
      inFlight.delete(key);
    }
  })();
  inFlight.set(key, p);
  return p;
}

/**
 * Can `profileId` play `videoId` right now? Runs a synchronous review when the
 * video is gated and has no verdict for this child yet.
 *
 * @returns {Promise<{ playable: boolean, reason?: 'not_found'|'not_approved'|'rejected'|'review_failed' }>}
 */
async function checkPlayable(dbModule, videoId, profileId, opts = {}) {
  const video = dbModule.getVideoById(videoId);
  if (!video) return { playable: false, reason: 'not_found' };
  if (video.status !== 'approved') return { playable: false, reason: 'not_approved' };
  if (!isGated(video)) return { playable: true };

  const r = await reviewForProfile(dbModule, video, profileId, opts);
  if (r.verdict === 'approved') return { playable: true };
  return { playable: false, reason: r.verdict === 'rejected' ? 'rejected' : 'review_failed' };
}

/**
 * Playable for this profile without calling the LLM (used to vet suggestions
 * and filter lists): approved, and either not gated or approved for this child.
 */
function isPlayableCached(dbModule, video, profileId) {
  if (!video || video.status !== 'approved') return false;
  if (!isGated(video)) return true;
  const v = getVerdict(dbModule, video.video_id, profileId);
  return !!v && v.verdict === 'approved';
}

/**
 * Drop videos this child has a cached 'rejected' verdict for. Unreviewed gated
 * videos stay listed; the play gate reviews them when tapped.
 */
function hideRejectedFor(dbModule, profileId, videos) {
  if (!profileId || !Array.isArray(videos) || videos.length === 0) return videos;
  const ids = videos.map(v => v.video_id);
  const ph = ids.map(() => '?').join(',');
  const rejected = new Set(ready(dbModule).prepare(
    `SELECT video_id FROM video_reviews WHERE profile_id = ? AND verdict = 'rejected' AND video_id IN (${ph})`
  ).all(profileId, ...ids).map(r => r.video_id));
  return rejected.size ? videos.filter(v => !rejected.has(v.video_id)) : videos;
}

/**
 * Review search results for the searching child before they're returned.
 * Gated results without a verdict are reviewed in parallel (bounded by
 * `budget` and `concurrency`); rejected and failed ones are dropped. Gated
 * results beyond the budget stay listed and are reviewed when tapped.
 */
async function gateSearchResults(dbModule, profileId, videos, opts = {}) {
  const { budget = 20, concurrency = 10 } = opts;
  const out = new Map(videos.map(v => [v.video_id, true]));
  const toReview = [];
  for (const v of videos) {
    const row = dbModule.getVideoById(v.video_id);
    if (!row || row.status !== 'approved') { out.set(v.video_id, false); continue; }
    if (!isGated(row)) continue;
    const cached = getVerdict(dbModule, row.video_id, profileId);
    if (cached) { out.set(v.video_id, cached.verdict === 'approved'); continue; }
    if (toReview.length < budget) toReview.push(row);
  }

  let i = 0;
  const worker = async () => {
    while (i < toReview.length) {
      const row = toReview[i++];
      const r = await reviewForProfile(dbModule, row, profileId, opts);
      out.set(row.video_id, r.verdict === 'approved');
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, toReview.length) }, worker));
  return videos.filter(v => out.get(v.video_id));
}

// ── Suggestion ──────────────────────────────────────────────────────────────

const STOPWORDS = new Set(('a an and are as at be by for from has have how i in is it its of on or that the this to was what when where who why will with you your my me we our new best video videos full episode part official ' +
  'kids kid funny vs').split(' '));

function titleKeywords(title) {
  return (title || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 3 && !STOPWORDS.has(w) && !/^\d+$/.test(w))
    .sort((a, b) => b.length - a.length)
    .slice(0, 4);
}

function parentBlocked(dbModule, profileId) {
  const raw = dbModule.getDb();
  const channels = new Set(raw.prepare(
    'SELECT channel_id FROM channels WHERE profile_id = ? AND whitelisted = 0'
  ).all(profileId).map(r => r.channel_id));
  const videos = new Set(raw.prepare(
    "SELECT value FROM filter_rules WHERE rule_type = 'video_block' AND (profile_id = ? OR profile_id IS NULL)"
  ).all(profileId).map(r => r.value));
  return { channels, videos };
}

function toCard(v) {
  return {
    video_id: v.video_id,
    title: v.title,
    channel_id: v.channel_id,
    channel_name: v.channel_name,
    thumbnail_url: v.thumbnail_url,
    duration_seconds: v.duration_seconds,
  };
}

/**
 * Pick one already-playable video for this child, on a similar topic to the
 * blocked one when possible. Never calls the LLM.
 */
function findSuggestion(dbModule, blockedVideoId, profileId) {
  const raw = dbModule.getDb();
  const blocked = dbModule.getVideoById(blockedVideoId);
  const blocks = parentBlocked(dbModule, profileId);

  const ok = (v) => v && v.video_id !== blockedVideoId
    && !blocks.channels.has(v.channel_id)
    && !blocks.videos.has(v.video_id)
    && isPlayableCached(dbModule, v, profileId);

  // Prefer parent-approved channels: they never depend on a cached verdict.
  const rank = (rows) => rows.sort((a, b) => (isGated(a) ? 1 : 0) - (isGated(b) ? 1 : 0));

  // 1. Shared topic tags (the blocked video's own tags, or tags the reviewer gave it).
  const tags = new Set(dbModule.getVideoTags(blockedVideoId));
  const verdict = getVerdict(dbModule, blockedVideoId, profileId);
  if (verdict && verdict.tags_json) {
    try { JSON.parse(verdict.tags_json).forEach(t => tags.add(t)); } catch { /* ignore */ }
  }
  if (tags.size > 0) {
    const tagList = [...tags];
    const ph = tagList.map(() => '?').join(',');
    const rows = raw.prepare(`
      SELECT v.*, COUNT(*) AS shared
      FROM video_tags vt JOIN videos v ON v.video_id = vt.video_id
      WHERE vt.tag IN (${ph}) AND v.status = 'approved' AND v.video_id != ?
      GROUP BY v.video_id
      ORDER BY shared DESC, RANDOM()
      LIMIT 60
    `).all(...tagList, blockedVideoId);
    const hit = rank(rows.filter(ok))[0];
    if (hit) return toCard(hit);
  }

  // 2. Title keywords against the approved library.
  for (const word of titleKeywords(blocked?.title)) {
    const rows = dbModule.searchApprovedVideos(profileId, word)
      .map(r => dbModule.getVideoById(r.video_id));
    const hit = rank(rows.filter(ok))[0];
    if (hit) return toCard(hit);
  }

  // 3. Anything from the child's own feed.
  const feed = dbModule.getApprovedFeed(profileId, 0, 30, [blockedVideoId]);
  const hit = rank(feed.filter(ok))[0];
  return hit ? toCard(hit) : null;
}

module.exports = {
  KID_NOTICE,
  PROMPT_VERSION,
  ensureSchema,
  isGated,
  youngestProfile,
  resolveReviewProfile,
  getVerdict,
  saveVerdict,
  reviewForProfile,
  checkPlayable,
  isPlayableCached,
  hideRejectedFor,
  gateSearchResults,
  findSuggestion,
  titleKeywords,
};
