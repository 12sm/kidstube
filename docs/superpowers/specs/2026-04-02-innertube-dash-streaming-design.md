# Innertube DASH Streaming Design

## Goal

Replace yt-dlp stream URL fetching with YouTube's Innertube API to deliver full-quality DASH video (up to 1080p) to the KidsTube Roku channel — without downloading or caching video files.

## Architecture

The backend calls YouTube's Innertube API via `youtubei.js`, deciphers adaptive format URLs, generates a DASH MPD manifest, and serves it to the Roku. The Roku media player fetches the manifest from the backend over LAN, then pulls video and audio segments directly from YouTube's CDN over the internet. The Roku handles A/V sync and ABR natively.

**Tech Stack:** Node.js/Express (existing), `youtubei.js` v17+, MPEG-DASH `isoff-on-demand` profile

---

## Data Flow

```
Roku VideoPlayer
  → GET /api/stream/:videoId
      → innertube.js: getBasicInfo(videoId, { client: 'TV' })
          → youtubei.js deciphers adaptive format URLs
      ← { url: "http://{backendHost}/api/manifest/{videoId}.mpd", type: "dash" }
  → GET /api/manifest/{videoId}.mpd   (fetched by Roku media player automatically)
      → dash.js: buildManifest(cachedFormats, durationMs)
      ← DASH MPD XML (Content-Type: application/dash+xml)
  → Roku fetches video segments directly from YouTube CDN
  → Roku fetches audio segments directly from YouTube CDN
  → Roku handles ABR and A/V sync natively
```

The Roku makes two requests to the backend (JSON + manifest). All segment traffic flows directly between Roku and YouTube's CDN — the backend is not in the streaming path.

---

## Backend: `innertube.js` (new file)

**Responsibility:** Own the `youtubei.js` lifecycle and expose a single stream-info function.

**Innertube client initialization (once at startup):**
- `client_type: 'TV'` (TVHTML5 — Samsung TV spoof)
- `generate_session_locally: true` (skips sw.js_data network round-trip)
- `cache: new UniversalCache(true, '/data/yt-cache')` (disk-backed, persists across restarts)
- Single instance reused across all requests — never recreated per call

**Exported function: `getStreamInfo(videoId)`**
- Calls `yt.getBasicInfo(videoId, { client: 'TV' })`
- If `playability_status.status !== 'OK'`: throws with `playability_status.reason`
- Deciphers all adaptive format URLs: `await format.decipher(yt.session.player)`
- If every format in `adaptive_formats` has `drm_families` set (paid/premium content): throws `"DRM content not supported"`
- Returns `{ formats: Format[], durationMs: number }`
- Results cached in-memory (Map) for 4 hours — YouTube CDN URLs expire at ~6 hours; 4h provides margin
- Cache key: `videoId`

**DRM note:** Regular YouTube videos (the content KidsTube targets) do not have `drm_families` set. Widevine DRM only applies to YouTube Premium exclusives and paid rentals/purchases. If `drm_families` is present on all formats, the video is out of scope and gets an error response.

---

## Backend: `dash.js` (new file)

**Responsibility:** Build a DASH MPD XML string from deciphered adaptive formats.

**Exported function: `buildManifest(formats, durationMs)`**

**Video selection:**
- Filter: `has_video=true, has_audio=false, height<=1080`
- Sort: height descending
- Take: up to 3 representations (e.g. 1080p, 720p, 480p) — gives Roku ABR options
- Codec: extracted from `mime_type` via `/codecs="([^"]+)"/`

**Audio selection:**
- Filter: `has_audio=true, has_video=false`
- Sort: `bitrate` descending
- Take: 1 representation (best quality)

**Manifest profile:** `urn:mpeg:dash:profile:isoff-on-demand:2011`
This is correct for YouTube's fMP4 streams, which are single files with a byte-range index rather than chunked segments.

**Manifest structure:**
```xml
<?xml version="1.0" encoding="UTF-8"?>
<MPD xmlns="urn:mpeg:dash:schema:mpd:2011"
     profiles="urn:mpeg:dash:profile:isoff-on-demand:2011"
     type="static"
     mediaPresentationDuration="PT{seconds}S"
     minBufferTime="PT1.5S">
  <Period duration="PT{seconds}S">

    <AdaptationSet id="1" contentType="video" segmentAlignment="true" bitstreamSwitching="true">
      <!-- One Representation per selected quality level -->
      <Representation id="v-{height}" mimeType="video/mp4" codecs="{codec}"
                      bandwidth="{bitrate}" width="{width}" height="{height}" frameRate="{fps}">
        <BaseURL>{deciphered_cdn_url}</BaseURL>
        <SegmentBase indexRange="{index_range.start}-{index_range.end}">
          <Initialization range="{init_range.start}-{init_range.end}"/>
        </SegmentBase>
      </Representation>
    </AdaptationSet>

    <AdaptationSet id="2" contentType="audio" segmentAlignment="true">
      <Representation id="a-1" mimeType="audio/mp4" codecs="{codec}"
                      bandwidth="{bitrate}" audioSamplingRate="{audio_sample_rate}">
        <BaseURL>{deciphered_cdn_url}</BaseURL>
        <SegmentBase indexRange="{index_range.start}-{index_range.end}">
          <Initialization range="{init_range.start}-{init_range.end}"/>
        </SegmentBase>
      </Representation>
    </AdaptationSet>

  </Period>
</MPD>
```

**Throws** if no valid video format or no valid audio format can be selected.

---

## Backend: `server.js` (modified)

**Updated: `GET /api/stream/:videoId`**

Replace the `getStreamUrl` yt-dlp call:
```js
const { formats, durationMs } = await innertube.getStreamInfo(videoId);
// formats cached internally by innertube.js for 4h
const manifestUrl = `http://${req.headers.host}/api/manifest/${videoId}.mpd`;
res.json({ url: manifestUrl, type: 'dash' });
```

The `host` header is used so the manifest URL is correct for whatever IP/port the Roku is using — no hardcoded addresses.

**New: `GET /api/manifest/:videoId.mpd`**

```js
app.get('/api/manifest/:videoId.mpd', async (req, res) => {
  const { videoId } = req.params;
  const cached = innertube.getCached(videoId); // reads from the 4h cache
  if (!cached) return res.status(404).json({ error: 'Stream info not cached — call /api/stream first' });
  const mpd = dash.buildManifest(cached.formats, cached.durationMs);
  res.set('Content-Type', 'application/dash+xml');
  res.send(mpd);
});
```

The manifest endpoint never calls Innertube directly — it only reads from the cache populated by `/api/stream/`. This keeps the Roku's two requests fast: the first call pays the Innertube latency cost (~1-2s), the manifest fetch is instant from cache.

**Error handling in `/api/stream/:videoId`:**
- `playability_status !== 'OK'`: 404 with reason
- All formats DRM-protected: 404 with `"DRM content not supported"`
- Innertube network error: 500 → Roku shows "Video unavailable" and auto-dismisses after 2s (existing behavior)

---

## Roku: `VideoPlayer.brs` (minimal change)

The existing code already does:
```brightscript
content.streamFormat = parsed.type
```

When `parsed.type = "dash"`, the Roku `Video` node handles DASH natively — no additional ContentNode fields are required for non-DRM content. No functional changes needed.

The `backendUrl` stored in `m.global.backendUrl` is already used to call `/api/stream/:videoId`. The manifest URL returned uses the same host, so no Roku configuration changes are needed.

---

## `docker-compose.yml` (modified)

Add `/data/yt-cache` to the backend container's volume mounts so `youtubei.js`'s disk cache (player JS + session data) persists across container restarts:

The `./data` directory is already bind-mounted to `/data` in the backend container (for the SQLite DB). The `UniversalCache` path `/data/yt-cache` will be created automatically as a subdirectory — no additional volume entry is needed in `docker-compose.yml`.

---

## `backend/package.json` (modified)

Add: `"youtubei.js": "^17.0.0"`

---

## What Does NOT Change

- `backend/src/ytdlp.js` — untouched. yt-dlp continues to handle all metadata fetching in the nightly batch (`fetchVideoData`). Only `getStreamUrl` is effectively replaced (it remains in the file but the stream endpoint no longer calls it).
- All other API routes in `server.js`
- All Roku components except `VideoPlayer.brs` (and that change may be zero lines)
- The PWA frontend — entirely unaffected

---

## Out of Scope

- Widevine license proxying (paid/premium content — not in KidsTube's feed)
- HLS fallback for live streams (KidsTube only serves VOD)
- Using the Innertube stream pipeline for the PWA player (noted as a future phase)
- `po_token` / BotGuard attestation — TV client is less scrutinized; add if rate limiting becomes an issue
