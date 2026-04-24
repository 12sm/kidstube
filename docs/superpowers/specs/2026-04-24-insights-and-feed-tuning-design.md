# Insights & Feed Tuning

**Date:** 2026-04-24
**Status:** Approved

## Overview

A new "Insights" tab in the admin panel combining:
1. Watch analytics (time by day/hour, top tags, trending tags)
2. Interest weight sliders with live feed preview
3. Home feed upgrade to interest-weighted ranking

## 1. Home Feed Ranking Upgrade

### Current State
`getApprovedFeed()` in db.js orders by `recency * watch_penalty * RANDOM()`. Interests only influence the related/up-next flow.

### New Scoring
```sql
score = (
    COALESCE(interest_score, 0.5)
    + CASE WHEN processed_at > datetime('now', '-60 days') THEN 1.0 ELSE 0.0 END
  )
  * (1.0 / (1.0 + COALESCE(watch_completion, 0) * 0.5))
  * (0.7 + 0.3 * (ABS(RANDOM()) / 9223372036854775807.0))
```

- `interest_score`: sum of effective weights for matching tags (capped at 4.0), using the same CTE as recommendations.js (raw_weight * multiplier, normalized to ceiling, capped by hard_cap)
- Floor of 0.5 for videos with no tag matches so untagged/unmatched content still appears
- Light randomness: 0.7-1.0 range
- Channel diversity: max 2 per channel per page (same as today)

### Fallback
If a profile has zero behavior interests, effective interest_score defaults to 0.5 for everything, degrading to recency + randomness (same as current behavior).

## 2. New API Endpoints

### `GET /api/admin/insights/:profileId`

Returns analytics data. Query params: `days` (default 30).

Response:
```json
{
  "watchTimeByDay": [
    { "date": "2026-04-23", "minutes": 47 }
  ],
  "watchTimeByHour": [
    { "hour": 14, "minutes": 120 }
  ],
  "topTags": [
    { "tag": "animals", "watchCount": 42, "totalMinutes": 180 }
  ],
  "trendingTags": [
    { "tag": "roblox", "recentCount": 15, "priorCount": 5, "trend": 2.0 }
  ],
  "totalWatchMinutes": 840,
  "totalVideosWatched": 188,
  "avgSessionMinutes": 22
}
```

- `watchTimeByDay`: aggregate progress_seconds per day over the period
- `watchTimeByHour`: aggregate by hour-of-day (0-23) to show when the kid watches
- `topTags`: join watch_history with video_tags, rank by watch count and total time
- `trendingTags`: compare last 7 days vs prior 7 days, compute ratio. Tags that appeared recently but not before trend highest.

### `POST /api/admin/feed-preview/:profileId`

Stateless preview endpoint. Accepts temporary weight overrides without persisting.

Request:
```json
{
  "overrides": {
    "animals": { "multiplier": 1.5 },
    "gaming": { "multiplier": 0.3 },
    "minecraft": { "multiplier": 0.0 }
  },
  "ceiling": 5.0
}
```

Response:
```json
{
  "videos": [
    {
      "video_id": "abc123",
      "title": "...",
      "thumbnail_url": "...",
      "channel_name": "...",
      "score": 3.42,
      "matchedTags": ["animals", "dogs"],
      "interestScore": 2.8
    }
  ]
}
```

- Runs the same scoring query as the upgraded home feed, but substitutes the override weights in place of persisted tag_settings
- Returns top 18 results (one page worth)
- Includes score breakdown for each video so the UI can annotate thumbnails
- Deterministic: no random factor in preview (always RANDOM seed = consistent ordering) — actually, use a fixed multiplier of 0.85 instead of random so the preview is stable across calls with the same overrides

## 3. Frontend: Insights Component

New file: `frontend/src/pages/Insights.jsx`

Added to Admin.jsx as a new nav tab at `/admin/insights`.

### Layout (single scrollable page, per-profile)

**Profile selector** at top (same pattern as other admin sections).

**Analytics section:**
- Watch time bar chart by day (last 30 days) — simple CSS bar chart, no charting library
- Watch time by hour heatmap — 24 boxes colored by intensity
- Top tags table — tag name, watch count, total minutes
- Trending tags — tags with rising usage, shown as pills with up/down arrows

**Feed Tuning section:**
- Section header: "Feed Tuning"
- List of all behavior interest tags for the selected profile, each with:
  - Tag name + current effective weight
  - Slider (0.0 to 3.0 multiplier, step 0.1, default from current tag_settings or 1.0)
  - Visual indicator when slider != persisted value (unsaved change)
- Global behavior ceiling slider
- "Save" button (persists to tag_settings endpoints) and "Reset" button (reverts to persisted values)
- Debounced: 300ms after any slider change, POST to feed-preview endpoint

**Feed Preview section:**
- Directly below the sliders
- 3-column grid of video cards (thumbnail + title + channel)
- Below each title: small muted text showing score, matched tags
- Updates live as sliders change (after debounce)
- Shows 18 videos (one page worth)

## 4. File Changes

| File | Change |
|------|--------|
| `backend/src/db.js` | Rewrite `getApprovedFeed()` with interest-weighted scoring; add `getInsightsAnalytics()`, `getFeedPreview()` |
| `backend/src/server.js` | Add `GET /api/admin/insights/:profileId`, `POST /api/admin/feed-preview/:profileId` |
| `frontend/src/pages/Insights.jsx` | New component (analytics + sliders + preview) |
| `frontend/src/pages/Admin.jsx` | Import Insights, add route + nav item |

## 5. No New Dependencies

- Analytics charts: pure CSS (bars = divs with percentage widths, heatmap = grid of colored boxes)
- No charting library needed for this scope
