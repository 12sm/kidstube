# KidsTube Recommendation Algorithm — Design Spec
**Date:** 2026-03-30
**Status:** Approved
**Scope:** Smarter ingest filtering, per-profile interest tracking, session-aware recommendation ranking, living child profile system

---

## Overview

The current pipeline ingests videos from whitelisted channels, runs a keyword filter, and (broken — never wired) an LLM appropriateness check. Related videos are pulled from the same channel only. Watch history is recorded but never read back for recommendations. This spec replaces that with a full interest-graph-driven recommendation system while keeping the approved content pool locked to already-curated channels (no new channel discovery in this phase).

**What this is not:** cross-channel discovery, embedding-based semantic search, or real-time content ingestion. Those are Phase 2+ upgrades explicitly designed to layer on top of this work.

---

## Data Model

Four new tables. No existing tables modified.

### `video_tags`
Topic tags extracted per video at ingest time.
```sql
CREATE TABLE video_tags (
  video_id  TEXT NOT NULL REFERENCES videos(video_id) ON DELETE CASCADE,
  tag       TEXT NOT NULL,
  weight    REAL NOT NULL DEFAULT 1.0,
  PRIMARY KEY (video_id, tag)
);
CREATE INDEX idx_video_tags_tag ON video_tags(tag);
```

### `profile_interests`
Decaying per-profile topic weights. The session trend and long-term interest model in one table.
```sql
CREATE TABLE profile_interests (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  profile_id  INTEGER NOT NULL REFERENCES profiles(id),
  tag         TEXT NOT NULL,
  weight      REAL NOT NULL DEFAULT 1.0,
  source      TEXT NOT NULL DEFAULT 'behavior', -- 'behavior' | 'parent'
  last_seen   DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(profile_id, tag, source)
);
CREATE INDEX idx_profile_interests_profile ON profile_interests(profile_id);
```

`source = 'parent'` rows are written by the weekly consolidation pass from the child profile markdown. They carry a fixed baseline weight of **0.5** and are **exempt from decay**. `source = 'behavior'` rows decay normally. Recommendation scoring sums both sources — the parent floor ensures a topic never disappears from the feed even if behavior weight decays to zero.

### `profile_insights`
Daily pass output. Staging area for observations before weekly consolidation.
```sql
CREATE TABLE profile_insights (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  profile_id   INTEGER NOT NULL REFERENCES profiles(id),
  insight      TEXT NOT NULL,
  source       TEXT NOT NULL, -- 'watch_behavior' | 'like' | 'dislike' | 'parent_admin'
  created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
  consolidated INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_profile_insights_profile ON profile_insights(profile_id, consolidated);
```

### `child_profiles`
The living markdown context file per profile.
```sql
CREATE TABLE child_profiles (
  profile_id  INTEGER PRIMARY KEY REFERENCES profiles(id),
  markdown    TEXT NOT NULL DEFAULT '',
  updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_by  TEXT NOT NULL DEFAULT 'parent' -- 'parent' | 'consolidation'
);
```

---

## Ingest Pipeline Changes

### Pass 0 — Shorts detection (new, runs before all other passes)

Multi-signal check on RSS/early metadata. Any one signal firing rejects immediately.

| Signal | Rule |
|--------|------|
| Duration | `duration_seconds <= 60` |
| Self-labelled | `#shorts` or `#short` in title, tags, or description (case-insensitive) |
| yt-dlp flag | `is_short === true` |
| Aspect ratio | `height > width` (vertical video) from yt-dlp metadata |

Runs before yt-dlp fetch for signals available from RSS, after yt-dlp fetch for aspect ratio and `is_short`. Reject reason: `'YouTube Short'`.

### Pass 1 — Keyword filter
No changes.

### Pass 2 — LLM appropriateness + tag extraction (fix + upgrade)

**Fix:** `runLlmCheck` was never called in `processVideo`. Wire it in after keyword filter passes and yt-dlp data is merged.

**Upgrade — combined prompt.** Single Haiku call replaces the current appropriateness-only call. Returns three fields:

```json
{ "approved": true, "reason": null, "tags": ["outer-space", "planets", "saturn"] }
```

**Prompt inputs:**
- Child profile markdown (injected as system context per profile being processed)
- YouTube `topicDetails.topicCategories` (Wikipedia topic URLs) — add `topicDetails` to `youtube.js` `videos.list` call
- Creator-provided tags from yt-dlp
- Title
- Description (first 300 chars)
- Transcript: smart-sampled as first 1000 + middle 1000 + last 1000 chars for videos >3 min; full transcript for videos ≤3 min

**System prompt change:** Replace the current generic "ages 7-8" description with the profile's `child_profiles.markdown` content. When no profile exists yet (setup not complete), fall back to the current generic prompt.

**Tag extraction guidance in prompt:** "Using the YouTube topic categories and creator tags as context, extract 3–5 clean semantic tags that describe what this video is about. Use lowercase hyphenated format (e.g. outer-space, minecraft, cooking). Prefer specific over generic."

**On approval:** write tags to `video_tags`. On rejection: no tags needed.

**YouTube API change:** Add `topicDetails` to the `part` parameter in `youtube.js` `videos.list`. Parse `topicDetails.topicCategories` (array of Wikipedia URLs) and extract the article slug as a readable topic string (e.g. `https://en.wikipedia.org/wiki/Minecraft` → `Minecraft`).

### Cost estimate

| Videos/night | Cost/night | Cost/month |
|---|---|---|
| 50 | $0.045 | $1.35 |
| 200 | $0.18 | $5.40 |
| 500 | $0.45 | $13.50 |

Based on ~715 input tokens + 25 output tokens per video at Haiku 4.5 pricing ($0.80/$4.00 per M). Adding tags to the response adds ~15 output tokens — negligible.

**Safety valve:** cap LLM calls at 300 per cron run. If the cap is hit, remaining videos are approved without LLM check and flagged with `llm_skipped = 1` for a follow-up pass.

---

## Engagement Signal Wiring

### New API endpoints

**`POST /api/video/:id/react`** — kid-facing like/dislike from Watch page
**`POST /api/admin/video/:id/react`** — parent thumbs up/down from admin panel

Both accept `{ profile_id, reaction: 'like' | 'dislike' }`. Both do:
1. Write a row to `profile_insights`
2. Update `profile_interests` weights for all of that video's tags

### Weight adjustments

| Signal | Tag weight delta |
|--------|----------------|
| Like (kid or parent) | +1.5 |
| Dislike (kid or parent) | −0.8 |
| Watched 80%+ of video >5 min | +1.0 |
| Watched 80%+ of video 2–5 min | +0.5 |
| Watched 80%+ of video <2 min | +0.3 |
| "Not Interested" (existing) | −1.0 |

Watch completion signals fire from the existing `POST /api/watch-history` endpoint. It already receives `progress_seconds` and `duration_seconds` — completion ratio is computable there with no frontend changes needed.

Explicit like/dislike from the kid is a **strong signal** — kids rarely tap it, so when they do it counts. Parent reactions carry the same weight.

### Interest weight upsert

On each signal, for every tag belonging to that video:
```sql
INSERT INTO profile_interests (profile_id, tag, weight, source, last_seen)
VALUES (?, ?, MAX(0, ? + delta), 'behavior', CURRENT_TIMESTAMP)
ON CONFLICT(profile_id, tag, source) DO UPDATE SET
  weight   = MAX(0, weight + delta),
  last_seen = CURRENT_TIMESTAMP
```
Weight floor is 0 — no negative weights.

---

## Interest Decay

Decay runs at the end of the **daily insights pass**, not on a wall-clock timer.

**Rule:** decay only fires if the profile had at least one watch session that day. If no session occurred (child didn't use the app), all weights are frozen — absence is neutral, not penalizing.

**When session occurred:** for every `source = 'behavior'` row in `profile_interests` for that profile where `last_seen` is not today, apply:
```
new_weight = weight × 0.85
```
Rows with `source = 'parent'` are never decayed. The parent-defined floor persists indefinitely until the parent removes it from the child profile.

---

## Recommendation Ranking

Replaces `getRelatedVideos` in `db.js`. The `/api/related/:videoId` endpoint passes `profileId` into the new query.

```sql
SELECT v.*,
  SUM(pi.weight) +
  CASE WHEN v.channel_id = :currentChannelId THEN 0.3 ELSE 0 END AS score
FROM videos v
JOIN video_tags vt ON v.video_id = vt.video_id
JOIN profile_interests pi
  ON vt.tag = pi.tag AND pi.profile_id = :profileId
WHERE v.status = 'approved'
  AND v.video_id != :currentVideoId
  AND v.video_id NOT IN (
    SELECT value FROM filter_rules
    WHERE rule_type = 'video_block'
      AND (profile_id = :profileId OR profile_id IS NULL)
  )
  AND v.video_id NOT IN (
    SELECT video_id FROM watch_history
    WHERE profile_id = :profileId
      AND CAST(progress_seconds AS REAL) / NULLIF(duration_seconds, 0) > 0.8
  )
GROUP BY v.video_id
ORDER BY score DESC
LIMIT 15
```

**Fallback:** videos with zero tag overlap (profile has no interest data yet, or tags simply don't match) fall back to `ORDER BY published_at DESC`. The feed never runs dry.

**Session drift is automatic.** Watch.jsx already re-fetches `/api/related/:videoId` on every `videoId` change. Since each watch event updates `profile_interests` in real-time, by the 3rd space video the space weights are higher and the 4th call naturally surfaces more space content. No separate session state endpoint needed.

---

## Two Memory Passes

### Daily insights pass — 3:00am

Runs after the main 2:00am ingest cron. Pure SQL aggregation, no LLM. One pass per profile.

Queries `watch_history` and reactions for the last 24h. Groups by tag. Writes observations to `profile_insights`:

- "Completed N/M [tag] videos (avg X% completion)"
- "Thumbed down N [tag] videos"
- "No session today"
- "Liked N [tag] videos"

Also triggers decay (see above) if session occurred.

### Weekly consolidation pass — Sunday 4:00am

One Haiku call per profile. Reads all `consolidated = 0` insights plus current `child_profiles.markdown`.

Prompt: *"Given these observations and the current profile, return an updated version of the profile. Promote confirmed patterns into the profile, strengthen existing ones, remove things that are no longer true. Keep it concise — the profile is a system context document, not a diary."*

After update:
- Write new markdown to `child_profiles` with `updated_by = 'consolidation'`
- Mark processed insights `consolidated = 1`
- Re-extract `source = 'parent'` interest tags from the new markdown and upsert into `profile_interests`
- Delete `source = 'parent'` rows for tags no longer mentioned in the profile

Cost: one Haiku call per profile per week — essentially free (~$0.002/profile/week).

---

## Child Profile System

### Initial setup — guided interview

Shown in admin panel when `child_profiles` row doesn't exist for a profile. Five questions, one at a time:

1. How old is [name] and what grade are they in?
2. What topics or subjects do they love? *(chip suggestions: gaming, animals, science, Minecraft, cooking, sports, art — plus freeform)*
3. What topics or content should we avoid? *(freeform)*
4. How would you describe acceptable tone? *(e.g. "calm and educational is fine, silly humor is great, no yelling or competitive trash talk")*
5. Anything else we should know about [name]?

Answers sent to Haiku: *"Generate a concise child profile in markdown for a kids' content recommendation and moderation system. Write in second person addressing the system. Include the child's age, interests, topics to avoid, and tone guidelines."*

Example output:
```
Child1 is 8 years old (3rd grade). He loves outer space, planets, Minecraft,
and building games. Avoid violent or scary content entirely. Competitive gaming
is fine but creators who yell, trash-talk, or call people names should be
rejected — tone matters more than topic. Silly humor is welcome.
Educational content gets a boost.
```

### Ongoing management — admin panel

- Textarea showing current markdown, directly editable and saveable
- "Last updated" timestamp with source: *by you* or *by weekly consolidation*
- Recent insights shelf: last 7 days of `profile_insights` shown as a readable list
- "Run consolidation now" button for manual trigger
- Profile injected verbatim as system context into every Haiku appropriateness check

---

## Implementation Phases

This is a multi-session build. Suggested order:

1. **Shorts detection (Pass 0)** — quick win, standalone, fixes existing data quality issue
2. **Wire Haiku pass** — fix the dead code, get LLM filtering actually running
3. **Data model migrations** — add four new tables
4. **YouTube `topicDetails` + combined Haiku prompt** — tag extraction at ingest
5. **Engagement signal endpoints** — `/react` endpoints, completion signal in watch-history
6. **Interest decay + daily insights pass** — new cron job
7. **Recommendation ranking query** — replace `getRelatedVideos`
8. **Child profile setup + admin UI** — guided interview, textarea, insights shelf
9. **Weekly consolidation pass** — final cron job, closes the loop

---

## Future Upgrade Path (Phase 2)

Once the tag system is stable and the video library has grown:

- Generate embeddings for each video using title + description + extracted tags as input
- Store as blob in SQLite (no vector DB needed at this scale)
- Cosine similarity ranking replaces or augments the tag-score query
- Session trend becomes a weighted average embedding rather than a tag weight sum
- Both systems can run in parallel during transition; embeddings take over when validated
- Retroactive batch embedding of the full existing library is straightforward since all videos already have tags
