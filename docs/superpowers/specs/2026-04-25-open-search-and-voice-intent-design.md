# Open YouTube Search & Voice-to-Intent

**Date:** 2026-04-25
**Status:** Approved

## Problem

Search is limited to whitelisted channels, so most queries return few or no results. This frustrates kids who want to find specific content. Additionally, the 4-year-old (Child2) uses voice search but speaks in natural sentences ("I want to watch the one with the dog") rather than search keywords, producing poor YouTube search results.

## Design

### 1. Open YouTube Search

**Current flow:** Search queries the local DB for approved videos from whitelisted channels. If < 5 results, queries YouTube API but still filtered to whitelisted channel IDs only.

**New flow:**

1. Search approved videos from whitelisted channels (existing `searchApprovedVideos`)
2. Always query YouTube API openly — remove channel ID filter — with `safeSearch: 'strict'`
3. Run keyword/channel block filter on YouTube results (existing `runFilterPass`)
4. Filter out shorts and livestreams (existing `isShort`, `isLive`)
5. Insert passing videos with `status: 'approved'`, `needs_llm_review: 1`, `discovery_source: 'search'`
6. Return merged results: whitelisted DB hits first, then open YouTube results, deduped, seamless list (no visual divider)
7. Nightly cron LLM review picks up `needs_llm_review: 1` videos — if rejected, they disappear from future results

**Moderation model:** Play immediately, moderate async. YouTube's `safeSearch: 'strict'` and the keyword filter block obvious problems in real-time. The LLM reviews everything within 24 hours. Parents see search-discovered content flagged in admin.

### 2. Voice-to-Intent

**Flow:**

1. Kid taps mic, browser Speech API captures utterance (existing)
2. Frontend POSTs raw transcript to `POST /api/search/voice-intent` with `{ text, profile_id }`
3. Backend calls Haiku with system prompt:
   ```
   You extract YouTube search queries from children's speech.
   The child is describing a video they want to watch.
   Return ONLY the search keywords, nothing else.
   2-6 words. No quotes, no explanation.
   ```
   User message: the raw transcript
4. Backend logs both raw speech and extracted query in `search_queries` table
5. Returns `{ query: "extracted keywords" }` to frontend
6. Frontend populates search bar with extracted query and fires normal search

**Latency:** ~300-500ms for Haiku. Combined with Speech API finalization time, total feels natural.

**Fallback:** If LLM call fails (timeout, rate limit, error), use raw transcript as-is. Degraded but functional.

**UI:** Match native YouTube voice search interface. Screenshots to be provided during implementation.

### 3. Search Logging & Admin Visibility

**Schema changes:**

- `search_queries` table: add `raw_speech TEXT` column (null for typed searches, stores original voice transcript)
- `videos` table: add `discovery_source TEXT DEFAULT 'subscription'` — values: `'subscription'`, `'search'`, `'recommendation'`

**Admin panel additions:**

- Search activity view: recent searches by profile showing query, raw speech (if voice), timestamp, which videos were played from each search
- Videos list: filterable by `discovery_source` to see all search-discovered videos and their LLM review status
- Channels appearing repeatedly via search but not whitelisted surface as "trending from search" candidates for parent to approve/block

**Watch logging:** Already handled — `watch_history` records plays. Combined with `discovery_source: 'search'` on the video, ties back to search activity.

## Files Affected

| File | Changes |
|------|---------|
| `backend/src/server.js` | New `/api/search/voice-intent` endpoint, modify `/api/search` to open YouTube query |
| `backend/src/youtube.js` | Modify `searchVideos` to support open search (no channel filter) |
| `backend/src/db.js` | Migration for `discovery_source` column, `raw_speech` column, update insert functions |
| `backend/src/llm.js` | New `extractSearchQuery(text)` function for voice-to-intent |
| `frontend/src/pages/Search.jsx` | Voice flow routes through intent endpoint before searching, UI updates |
| `frontend/src/pages/Admin.jsx` | Search activity view, discovery_source filter on videos |

## Out of Scope

- Real-time LLM gating before playback (decided against — too slow)
- Client-side LLM calls (API key must stay server-side)
- Changes to the nightly cron LLM review pipeline (it already handles `needs_llm_review`)
