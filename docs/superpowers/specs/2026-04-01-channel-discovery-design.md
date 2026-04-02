# Channel Discovery Design

## Goal

Add an on-demand channel discovery tool to the Admin panel that suggests new channels for a profile based on its interest tags and existing whitelisted channels. A parent reviews and approves suggestions; approved channels are immediately whitelisted and backfilled with their 50 most recent videos.

## Architecture

Two independent pieces:

**1. Admin Channels UI refactor** — the Channels admin section gains a three-tab layout: **Recs** (channel recommendations, currently on the Dashboard), **Discover** (new), **Channels** (existing list). No backend changes required for the tab restructure.

**2. Channel Discovery backend + UI** — a new `POST /api/admin/discover/channels` endpoint builds a set of search queries from the profile's top interest tags and existing whitelisted channel names, fires `search.list?type=channel` once per query, merges and deduplicates results, filters out channels already in the profile, and returns up to 20 ranked candidates. Approve calls the existing `upsertChannel` + a new `backfillChannel` helper extracted from `runNightlyJob`. Results are ephemeral — not persisted between sessions.

## Data Layer

No new tables. Discovery results are returned live and held in frontend state. The existing `channels` table and `channel_recommendations` table are unchanged.

## API Endpoints

**`POST /api/admin/discover/channels`** (protected — requireAdmin)

Body: `{ profile_id: number }`

1. Load top 5 behavior interest tags for the profile from `profile_interests` (highest weight, `source = 'behavior'`).
2. Load top 5 whitelisted channel names for the profile from `channels`.
3. Build query list: tags + channel names (up to 10 queries total).
4. For each query: call `youtube.discoverChannels(query)` — `search.list?type=channel&q={query}&maxResults=10&safeSearch=strict`.
5. Merge all results, deduplicate by `channel_id`, filter out channels already in `channels` table for this profile.
6. Rank by `subscriber_count` descending, return top 20.

Response:
```json
{
  "candidates": [
    {
      "channel_id": "UCxxx",
      "channel_name": "Blippi",
      "thumbnail_url": "https://...",
      "subscriber_count": 12000000,
      "description": "Fun educational videos for kids..."
    }
  ]
}
```

**`POST /api/admin/discover/channels/approve`** (protected — requireAdmin)

Body: `{ profile_id: number, channel_id: string, channel_name: string, thumbnail_url: string }`

1. Call `db.upsertChannel({ channel_id, profile_id, channel_name, thumbnail_url, whitelisted: 1 })`.
2. Call `backfillChannel(channel, profileId)` — fetches up to 50 recent videos via `getChannelRecentVideos`, runs each through `processVideo`. Fires and returns immediately (async, does not block response).

Response: `{ ok: true }`

## YouTube API

**`discoverChannels(query)`** — new function in `youtube.js`:

```js
async function discoverChannels(query) {
  const yt = google.youtube({ version: 'v3', auth: process.env.YOUTUBE_API_KEY });
  const res = await yt.search.list({
    part: 'snippet',
    q: query,
    type: 'channel',
    maxResults: 10,
    safeSearch: 'strict',
  });
  return (res.data.items || []).map(item => ({
    channel_id:       item.snippet.channelId,
    channel_name:     item.snippet.channelTitle,
    thumbnail_url:    item.snippet.thumbnails?.medium?.url || item.snippet.thumbnails?.default?.url || null,
    description:      item.snippet.description || null,
    subscriber_count: null, // not in search.list — fetched in a follow-up channels.list call
  }));
}
```

After collecting all search results, a single `channels.list?part=statistics&id={ids}` call (up to 50 IDs) fetches subscriber counts for ranking.

**Quota:** 10 `search.list` calls × 100 units + 1 `channels.list` call × 1 unit = ~1,001 units per discovery run. Well within the 10,000/day limit.

## Cron Refactor

Extract single-channel backfill from `runNightlyJob` into a standalone `backfillChannel(channel, profileId)` function:

```js
async function backfillChannel(channel, profileId) {
  const filterRules = db.getFilterRules(profileId);
  const llmState = { calls: 0, cap: 50 }; // cap lower for on-demand
  const stats = { found: 0, approved: 0, rejected: 0, error: null };
  const apiVideos = await youtube.getChannelRecentVideos(channel.channel_id, 50);
  for (const v of apiVideos) {
    if (db.videoExists(v.video_id)) continue;
    v._profileId = profileId;
    v.channel_thumbnail = channel.thumbnail_url;
    await processVideo(v, filterRules, stats, false, null, llmState);
  }
  return stats;
}
```

Called fire-and-forget from the approve endpoint: `backfillChannel(...).catch(err => console.error(...))`.

## Frontend

### Admin Channels page — 3 tabs

Tab bar: **Recs | Discover | Channels**

- **Recs tab**: Moves the existing channel recommendations UI currently shown on the Admin Dashboard. No functional changes.
- **Channels tab**: The existing channel list/management UI. No functional changes.
- **Discover tab**: New UI described below.

### Discover tab

- Profile selector (Child1 / Child2) — defaults to first profile
- "Find Channels" button — triggers `POST /api/admin/discover/channels`, shows spinner during load (~3–5s)
- Results: card grid — channel thumbnail, name, subscriber count formatted (e.g. "1.2M subscribers"), description snippet (truncated to 2 lines)
- Each card has two actions:
  - **Add** — calls `POST /api/admin/discover/channels/approve`, card immediately shows "Added ✓" state, backfill runs in background
  - **Dismiss** — removes card from view for this session (no server call)
- No results state: "No new channels found — try after more watch history builds up"
- Error state: "Discovery failed — check YouTube API quota"
- Results are session-only; page reload clears them

## File Changes

| File | Change |
|------|--------|
| `frontend/src/pages/Admin.jsx` | Add Recs/Discover/Channels tab bar to Channels section; move recs UI there; add Discover tab |
| `backend/src/server.js` | Add `POST /api/admin/discover/channels` and `POST /api/admin/discover/channels/approve` |
| `backend/src/youtube.js` | Add `discoverChannels(query)` function |
| `backend/src/cron.js` | Extract `backfillChannel(channel, profileId)` from `runNightlyJob`; export it |
