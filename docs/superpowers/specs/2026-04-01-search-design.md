# KidsTube Search Design

## Goal

Add a YouTube-style search experience for kids that searches the approved library first, then falls back to the YouTube API scoped to whitelisted channels, so a child can always find videos from trusted channels even if they haven't been backfilled yet.

## Architecture

Search is a new `/search` route backed by three new API endpoints. No new npm dependencies required — it uses the existing YouTube Data API client, SQLite layer, and filter pipeline.

### Data Layer

**`search_queries` table** (new):
```sql
CREATE TABLE search_queries (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  profile_id  INTEGER NOT NULL REFERENCES profiles(id),
  query       TEXT NOT NULL,
  searched_at DATETIME NOT NULL DEFAULT (datetime('now')),
  UNIQUE(profile_id, query)
);
```
Upsert on `(profile_id, query)` — if the query already exists, update `searched_at` so it bubbles to the top of history. Keep the 20 most recent per profile (delete oldest on insert when count > 20).

**`needs_llm_review` column** (new on `videos`):
```sql
ALTER TABLE videos ADD COLUMN needs_llm_review INTEGER NOT NULL DEFAULT 0;
```
Set to `1` for any video imported via search. The nightly cron LLM pass picks up approved videos with `needs_llm_review = 1`, runs the LLM check, and either confirms (sets flag to `0`) or flips status to `rejected`.

### API Endpoints

**`GET /api/search?q=<query>&profile_id=<id>`**

1. Save query to `search_queries` (upsert).
2. Search `videos` table: `status = 'approved'` AND (`title LIKE ?` OR `channel_name LIKE ?` OR `description LIKE ?`), scoped to whitelisted channels for this profile (`channel_id IN (SELECT channel_id FROM channels WHERE profile_id = ? AND whitelisted = 1)`). Returns up to 20 results.
3. If fewer than 5 DB results: call YouTube Data API `search.list` with `q`, `type=video`, `maxResults=20`. Filter results to only videos whose `channelId` is in the profile's whitelisted channels.
4. For each API result not already in DB: run `isShort`, `isLive`, `runFilterPass`. If it passes all checks, insert as `status='approved'`, `needs_llm_review=1`.
5. Return merged array: DB results first, then newly imported API results. Deduplicate by `video_id`.

Response shape matches the existing approved feed: `{ results: [ { video_id, title, channel_name, thumbnail_url, duration_seconds, ... } ] }`.

**`GET /api/search/history?profile_id=<id>`**

Returns the 20 most recent search queries for the profile, newest first:
```json
{ "history": ["bluey full episodes", "peppa pig", "monster trucks"] }
```

### YouTube API Quota

`search.list` costs 100 quota units per call. Daily limit is 10,000 units. At 100 searches/day across both profiles the app stays well within limits. The API call only fires on form submit — not while the user is typing.

### Nightly Cron — LLM Review of Search Imports

Add a step to `runNightlyJob` that processes `needs_llm_review = 1` videos:
```sql
SELECT * FROM videos WHERE status = 'approved' AND needs_llm_review = 1
```
Run each through `runLlmCheck`. If approved: set `needs_llm_review = 0`, store tags. If rejected: set `status = 'rejected'`, `rejection_reason = 'LLM: ...'`, `needs_llm_review = 0`. This is the same logic as the existing Batch A backfill, folded into the nightly run.

## Frontend

### Entry Point

A magnifying glass icon (`SearchIcon`) in the top-right header of the main layout, visible on Home, Shorts, and Subscriptions pages. Tapping navigates to `/search` and auto-focuses the input.

The icon position matches the YouTube reference: top-right, alongside the cast/notification icons. On iPad it sits in the same top-right area of the wider layout.

### `/search` Route — `Search.jsx`

**Empty state (no query submitted yet):**
- Back arrow (top-left) → navigates back
- Focused search input (top-center), placeholder "Search YouTube"
- Recent searches list below: clock icon + query text + arrow-up-left icon to fill the input. Tap a row to re-run; X button to delete from history (calls `DELETE /api/search/history/:profileId/:query`).

**Results state:**
- Same video card grid as Home — thumbnail, title, channel name, duration
- Library hits appear first, newly imported videos follow
- No visual distinction between library and search-imported results (no "new" badge — kids don't care)
- Empty state: "No results for '[query]'"

**Loading state:**
- Brief spinner while the API call + import runs (typically 1–2 seconds)

### Bottom Nav

No change — search is accessed via the header icon, not a nav tab. Matches YouTube's pattern.

### Search History Deletion

`DELETE /api/search/history/:profileId/:query` — removes a single history entry. Called when the user taps X on a recent search row.

## File Changes

| File | Change |
|------|--------|
| `backend/src/db.js` | Add `search_queries` table to `migrate()`, add `needs_llm_review` column migration, add `saveSearchQuery`, `getSearchHistory`, `deleteSearchQuery`, `importSearchVideo` functions |
| `backend/src/server.js` | Add `GET /api/search`, `GET /api/search/history`, `DELETE /api/search/history/:profileId/:query` |
| `backend/src/youtube.js` | Add `searchVideos(query, channelIds, maxResults)` function using `search.list` |
| `backend/src/cron.js` | Add LLM review step for `needs_llm_review = 1` videos to `runNightlyJob` |
| `frontend/src/pages/Search.jsx` | New page — search input, history list, results grid |
| `frontend/src/App.jsx` | Add `/search` route, add search icon to header |
| `frontend/src/components/BottomNav.jsx` | No change |
