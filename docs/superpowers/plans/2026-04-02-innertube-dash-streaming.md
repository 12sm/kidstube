# Innertube DASH Streaming Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace yt-dlp stream URL fetching with YouTube's Innertube API + DASH manifest generation to deliver full-quality video (up to 1080p) to the KidsTube Roku channel.

**Architecture:** A new `innertube.js` module calls YouTube's Innertube API via `youtubei.js` (TV client), deciphers adaptive format URLs, and caches them for 4 hours. A new `dash.js` module builds a MPEG-DASH MPD XML manifest from those formats. The `/api/stream/:videoId` endpoint now calls Innertube and returns a manifest URL; a new `/api/manifest/:videoId` endpoint serves the MPD. The Roku VideoPlayer sets `streamFormat="dash"` and the Roku media player fetches segments directly from YouTube CDN.

**Tech Stack:** Node.js/Express (existing), `youtubei.js` v17+, MPEG-DASH `isoff-on-demand` profile, Jest (existing test runner)

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `backend/package.json` | Modify | Add `youtubei.js` dependency |
| `backend/src/innertube.js` | Create | Innertube client singleton, `getStreamInfo()`, `getCached()`, 4h cache |
| `backend/src/dash.js` | Create | `buildManifest(formats, durationMs)` → DASH MPD XML string |
| `backend/tests/dash.test.js` | Create | Unit tests for `buildManifest` (pure function, no network) |
| `backend/src/server.js` | Modify | Replace `/api/stream/:videoId`, add `/api/manifest/:videoId` |

`roku-app/components/VideoPlayer.brs` requires **no changes** — it already does `content.streamFormat = parsed.type` which handles `"dash"` correctly.

---

### Task 1: Install youtubei.js

**Files:**
- Modify: `backend/package.json`

- [ ] **Step 1: Add the dependency**

```bash
cd /home/michael/projects/kidstube/backend
npm install youtubei.js
```

Expected output includes: `added N packages` with `youtubei.js` listed.

- [ ] **Step 2: Verify it installed**

```bash
node -e "import('youtubei.js').then(m => console.log('OK', Object.keys(m).slice(0,5)))"
```

Expected: `OK [ 'Innertube', 'UniversalCache', ... ]`

- [ ] **Step 3: Rebuild the Docker container to bake in the new dependency**

```bash
cd /home/michael/projects/kidstube
docker compose build backend 2>&1 | tail -8
docker compose up -d backend
```

Expected: `backend  Built` and `Container kidstube-backend  Started`

- [ ] **Step 4: Commit**

```bash
cd /home/michael/projects/kidstube
git add backend/package.json backend/package-lock.json
git commit -m "chore: add youtubei.js for Innertube API access"
```

---

### Task 2: Create dash.js with tests (TDD)

**Files:**
- Create: `backend/tests/dash.test.js`
- Create: `backend/src/dash.js`

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/dash.test.js`:

```js
'use strict';

const { buildManifest } = require('../src/dash');

function makeVideo(overrides = {}) {
  return {
    itag: 137,
    mime_type: 'video/mp4; codecs="avc1.640028"',
    bitrate: 4000000,
    width: 1920,
    height: 1080,
    fps: 30,
    has_video: true,
    has_audio: false,
    url: 'https://rr1.googlevideo.com/videoplayback?id=v1080',
    init_range: { start: 0, end: 739 },
    index_range: { start: 740, end: 1243 },
    ...overrides,
  };
}

function makeAudio(overrides = {}) {
  return {
    itag: 140,
    mime_type: 'audio/mp4; codecs="mp4a.40.2"',
    bitrate: 128000,
    audio_sample_rate: 44100,
    has_video: false,
    has_audio: true,
    url: 'https://rr1.googlevideo.com/videoplayback?id=audio',
    init_range: { start: 0, end: 595 },
    index_range: { start: 596, end: 1011 },
    ...overrides,
  };
}

describe('buildManifest', () => {
  test('produces valid DASH MPD with video and audio adaptation sets', () => {
    const mpd = buildManifest([makeVideo(), makeAudio()], 120000);
    expect(mpd).toContain('<?xml version="1.0"');
    expect(mpd).toContain('urn:mpeg:dash:profile:isoff-on-demand:2011');
    expect(mpd).toContain('PT120.000S');
    expect(mpd).toContain('contentType="video"');
    expect(mpd).toContain('contentType="audio"');
    expect(mpd).toContain('avc1.640028');
    expect(mpd).toContain('mp4a.40.2');
    expect(mpd).toContain('https://rr1.googlevideo.com/videoplayback?id=v1080');
    expect(mpd).toContain('https://rr1.googlevideo.com/videoplayback?id=audio');
  });

  test('includes SegmentBase with indexRange and Initialization range', () => {
    const mpd = buildManifest([makeVideo(), makeAudio()], 60000);
    expect(mpd).toContain('indexRange="740-1243"');
    expect(mpd).toContain('range="0-739"');
    expect(mpd).toContain('indexRange="596-1011"');
    expect(mpd).toContain('range="0-595"');
  });

  test('selects up to 3 video representations sorted by height descending', () => {
    const formats = [
      makeVideo({ height: 480, width: 854, bitrate: 1000000, url: 'https://cdn/480' }),
      makeVideo({ height: 1080, width: 1920, bitrate: 4000000, url: 'https://cdn/1080' }),
      makeVideo({ height: 720, width: 1280, bitrate: 2500000, url: 'https://cdn/720' }),
      makeVideo({ height: 360, width: 640, bitrate: 500000, url: 'https://cdn/360' }),
      makeAudio(),
    ];
    const mpd = buildManifest(formats, 60000);
    expect(mpd.indexOf('https://cdn/1080')).toBeLessThan(mpd.indexOf('https://cdn/720'));
    expect(mpd.indexOf('https://cdn/720')).toBeLessThan(mpd.indexOf('https://cdn/480'));
    expect(mpd).not.toContain('https://cdn/360');
  });

  test('excludes formats above 1080p', () => {
    const formats = [
      makeVideo({ height: 2160, width: 3840, url: 'https://cdn/4k' }),
      makeVideo({ height: 1080, width: 1920, url: 'https://cdn/1080' }),
      makeAudio(),
    ];
    const mpd = buildManifest(formats, 60000);
    expect(mpd).not.toContain('https://cdn/4k');
    expect(mpd).toContain('https://cdn/1080');
  });

  test('prefers avc1 over vp9 at the same height (de-duplicates by height)', () => {
    const formats = [
      makeVideo({ mime_type: 'video/webm; codecs="vp09.00.50.08"', height: 1080, url: 'https://cdn/vp9' }),
      makeVideo({ mime_type: 'video/mp4; codecs="avc1.640028"', height: 1080, url: 'https://cdn/avc1' }),
      makeAudio(),
    ];
    const mpd = buildManifest(formats, 60000);
    expect(mpd).toContain('https://cdn/avc1');
    expect(mpd).not.toContain('https://cdn/vp9');
  });

  test('throws when no usable video formats', () => {
    expect(() => buildManifest([makeAudio()], 60000)).toThrow('No usable video formats found');
  });

  test('throws when no usable audio formats', () => {
    expect(() => buildManifest([makeVideo()], 60000)).toThrow('No usable audio formats found');
  });

  test('escapes & in URLs', () => {
    const mpd = buildManifest(
      [makeVideo({ url: 'https://cdn/v?a=1&b=2' }), makeAudio()],
      60000
    );
    expect(mpd).toContain('https://cdn/v?a=1&amp;b=2');
  });

  test('excludes formats missing init_range or index_range', () => {
    const noRange = makeVideo({ init_range: undefined, index_range: undefined, url: 'https://cdn/norange' });
    const withRange = makeVideo({ height: 720, url: 'https://cdn/720' });
    const mpd = buildManifest([noRange, withRange, makeAudio()], 60000);
    expect(mpd).toContain('https://cdn/720');
    expect(mpd).not.toContain('https://cdn/norange');
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
cd /home/michael/projects/kidstube/backend
npm test -- --testPathPattern=dash
```

Expected: FAIL — `Cannot find module '../src/dash'`

- [ ] **Step 3: Implement dash.js**

Create `backend/src/dash.js`:

```js
'use strict';

function codecRank(mimeType) {
  const codec = (mimeType.match(/codecs="([^"]+)"/) || [])[1] || '';
  if (codec.startsWith('avc1')) return 0;
  if (codec.startsWith('vp09') || codec.startsWith('vp9')) return 1;
  return 2;
}

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function buildManifest(formats, durationMs) {
  const durationSec = (durationMs / 1000).toFixed(3);

  const videoFormats = formats
    .filter(f => f.has_video && !f.has_audio && f.height <= 1080 && f.init_range && f.index_range && f.url)
    .sort((a, b) => {
      const rankDiff = codecRank(a.mime_type) - codecRank(b.mime_type);
      if (rankDiff !== 0) return rankDiff;
      return b.height - a.height;
    });

  const seenHeights = new Set();
  const selectedVideo = [];
  for (const f of videoFormats) {
    if (!seenHeights.has(f.height)) {
      seenHeights.add(f.height);
      selectedVideo.push(f);
      if (selectedVideo.length === 3) break;
    }
  }

  if (selectedVideo.length === 0) throw new Error('No usable video formats found');

  const audioFormats = formats
    .filter(f => f.has_audio && !f.has_video && f.init_range && f.index_range && f.url)
    .sort((a, b) => b.bitrate - a.bitrate);

  if (audioFormats.length === 0) throw new Error('No usable audio formats found');

  const audio = audioFormats[0];

  const videoReps = selectedVideo.map((f, i) => {
    const codec = (f.mime_type.match(/codecs="([^"]+)"/) || [])[1] || '';
    const mimeBase = f.mime_type.split(';')[0].trim();
    return `      <Representation id="v${i}" mimeType="${esc(mimeBase)}" codecs="${esc(codec)}"
                      bandwidth="${f.bitrate}" width="${f.width}" height="${f.height}" frameRate="${f.fps || 30}">
        <BaseURL>${esc(f.url)}</BaseURL>
        <SegmentBase indexRange="${f.index_range.start}-${f.index_range.end}">
          <Initialization range="${f.init_range.start}-${f.init_range.end}"/>
        </SegmentBase>
      </Representation>`;
  }).join('\n');

  const audioCodec = (audio.mime_type.match(/codecs="([^"]+)"/) || [])[1] || '';
  const audioMime = audio.mime_type.split(';')[0].trim();
  const audioRep = `      <Representation id="a0" mimeType="${esc(audioMime)}" codecs="${esc(audioCodec)}"
                      bandwidth="${audio.bitrate}" audioSamplingRate="${audio.audio_sample_rate || 44100}">
        <BaseURL>${esc(audio.url)}</BaseURL>
        <SegmentBase indexRange="${audio.index_range.start}-${audio.index_range.end}">
          <Initialization range="${audio.init_range.start}-${audio.init_range.end}"/>
        </SegmentBase>
      </Representation>`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<MPD xmlns="urn:mpeg:dash:schema:mpd:2011"
     profiles="urn:mpeg:dash:profile:isoff-on-demand:2011"
     type="static"
     mediaPresentationDuration="PT${durationSec}S"
     minBufferTime="PT1.5S">
  <Period duration="PT${durationSec}S">
    <AdaptationSet id="1" contentType="video" segmentAlignment="true" bitstreamSwitching="true">
${videoReps}
    </AdaptationSet>
    <AdaptationSet id="2" contentType="audio" segmentAlignment="true">
${audioRep}
    </AdaptationSet>
  </Period>
</MPD>`;
}

module.exports = { buildManifest };
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
cd /home/michael/projects/kidstube/backend
npm test -- --testPathPattern=dash
```

Expected: PASS — 8 tests, 0 failures

- [ ] **Step 5: Commit**

```bash
cd /home/michael/projects/kidstube
git add backend/src/dash.js backend/tests/dash.test.js
git commit -m "feat: add DASH manifest builder with tests"
```

---

### Task 3: Create innertube.js

**Files:**
- Create: `backend/src/innertube.js`

No unit tests — this module requires a live network connection to YouTube. It will be exercised by the integration smoke test in Task 5.

- [ ] **Step 1: Create innertube.js**

Create `backend/src/innertube.js`:

```js
'use strict';

const CACHE_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours

const streamInfoCache = new Map();
let ytClient = null;

async function getClient() {
  if (ytClient) return ytClient;
  const { Innertube, UniversalCache } = await import('youtubei.js');
  ytClient = await Innertube.create({
    client_type: 'TV',
    generate_session_locally: true,
    cache: new UniversalCache(true, '/app/data/yt-cache'),
  });
  console.log('[innertube] Client initialized');
  return ytClient;
}

async function getStreamInfo(videoId) {
  const cached = streamInfoCache.get(videoId);
  if (cached && cached.expiresAt > Date.now()) {
    console.log(`[innertube] Cache hit for ${videoId}`);
    return { formats: cached.formats, durationMs: cached.durationMs };
  }

  const yt = await getClient();
  console.log(`[innertube] Fetching stream info for ${videoId}`);
  const info = await yt.getBasicInfo(videoId, { client: 'TV' });

  if (info.playability_status?.status !== 'OK') {
    throw new Error(info.playability_status?.reason || 'Video not playable');
  }

  const rawFormats = info.streaming_data?.adaptive_formats ?? [];
  if (rawFormats.length === 0) {
    throw new Error('No adaptive formats available');
  }

  const formats = await Promise.all(rawFormats.map(async (f) => ({
    itag: f.itag,
    mime_type: f.mime_type,
    url: await f.decipher(yt.session.player),
    bitrate: f.bitrate || 0,
    width: f.width,
    height: f.height,
    fps: f.fps,
    quality_label: f.quality_label,
    audio_quality: f.audio_quality,
    audio_sample_rate: f.audio_sample_rate,
    content_length: f.content_length,
    init_range: f.init_range,
    index_range: f.index_range,
    has_audio: f.has_audio,
    has_video: f.has_video,
    is_drm: (f.drm_families?.length ?? 0) > 0,
  })));

  const playable = formats.filter(f => !f.is_drm);
  if (playable.length === 0) {
    throw new Error('DRM content not supported');
  }

  // basic_info.duration is in seconds; approx_duration_ms is in ms
  const durationMs = info.basic_info?.duration
    ? info.basic_info.duration * 1000
    : (rawFormats[0]?.approx_duration_ms ?? 0);

  streamInfoCache.set(videoId, {
    formats: playable,
    durationMs,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });

  if (streamInfoCache.size > 100) {
    const now = Date.now();
    for (const [key, val] of streamInfoCache) {
      if (val.expiresAt < now) streamInfoCache.delete(key);
    }
  }

  console.log(`[innertube] OK ${videoId} — ${playable.length} formats, duration=${Math.round(durationMs/1000)}s`);
  return { formats: playable, durationMs };
}

function getCached(videoId) {
  const entry = streamInfoCache.get(videoId);
  if (entry && entry.expiresAt > Date.now()) {
    return { formats: entry.formats, durationMs: entry.durationMs };
  }
  return null;
}

module.exports = { getStreamInfo, getCached };
```

- [ ] **Step 2: Commit**

```bash
cd /home/michael/projects/kidstube
git add backend/src/innertube.js
git commit -m "feat: add innertube.js — Innertube TV client with 4h stream cache"
```

---

### Task 4: Update server.js

**Files:**
- Modify: `backend/src/server.js`

- [ ] **Step 1: Update the import line at the top of server.js**

Find this line (around line 16):
```js
const { fetchVideoData, getStreamUrl } = require('./ytdlp');
```

Replace with:
```js
const { fetchVideoData } = require('./ytdlp');
const innertube = require('./innertube');
const dash = require('./dash');
```

- [ ] **Step 2: Remove the old stream cache declarations**

Find and remove these two lines (around lines 21-22):
```js
const streamCache = new Map();
const STREAM_CACHE_TTL_MS = 25 * 60 * 1000;
```

(`innertube.js` owns the cache now with a 4h TTL.)

- [ ] **Step 3: Replace the /api/stream/:videoId handler**

Find the entire handler (lines ~220–245):
```js
// Get a direct stream URL for a video (used by Roku channel)
app.get('/api/stream/:videoId', async (req, res) => {
  const { videoId } = req.params;
  console.log(`[stream] Request for ${videoId}`);
  if (!/^[a-zA-Z0-9_-]{6,15}$/.test(videoId)) return res.status(400).json({ error: 'Invalid video ID' });
  const cached = streamCache.get(videoId);
  if (cached && cached.expiresAt > Date.now()) {
    console.log(`[stream] Cache hit for ${videoId}: type=${cached.type}`);
    return res.json({ url: cached.url, type: cached.type, cached: true });
  }
  try {
    console.log(`[stream] Fetching via yt-dlp for ${videoId}...`);
    const t0 = Date.now();
    const result = await getStreamUrl(videoId);
    console.log(`[stream] OK ${videoId} in ${Date.now()-t0}ms type=${result.type} url=${result.url.slice(0,80)}`);
    streamCache.set(videoId, { url: result.url, type: result.type, expiresAt: Date.now() + STREAM_CACHE_TTL_MS });
    if (streamCache.size > 200) {
      const now = Date.now();
      for (const [key, val] of streamCache) { if (val.expiresAt < now) streamCache.delete(key); }
    }
    res.json({ url: result.url, type: result.type, cached: false });
  } catch (err) {
    console.error(`[stream] Failed for ${videoId}:`, err.message);
    res.status(502).json({ error: 'Stream unavailable', detail: err.message });
  }
});
```

Replace it with:
```js
// Get a DASH manifest URL for a video (used by Roku channel)
app.get('/api/stream/:videoId', async (req, res) => {
  const { videoId } = req.params;
  console.log(`[stream] Request for ${videoId}`);
  if (!/^[a-zA-Z0-9_-]{6,15}$/.test(videoId)) return res.status(400).json({ error: 'Invalid video ID' });
  try {
    const t0 = Date.now();
    await innertube.getStreamInfo(videoId);
    console.log(`[stream] OK ${videoId} in ${Date.now() - t0}ms`);
    const manifestUrl = `http://${req.headers.host}/api/manifest/${videoId}`;
    res.json({ url: manifestUrl, type: 'dash' });
  } catch (err) {
    console.error(`[stream] Failed for ${videoId}:`, err.message);
    res.status(502).json({ error: 'Stream unavailable', detail: err.message });
  }
});

// Serve the DASH manifest for a video (Roku media player fetches this directly)
app.get('/api/manifest/:videoId', (req, res) => {
  const { videoId } = req.params;
  const cached = innertube.getCached(videoId);
  if (!cached) {
    return res.status(404).json({ error: 'Stream info not cached — call /api/stream first' });
  }
  try {
    const mpd = dash.buildManifest(cached.formats, cached.durationMs);
    res.set('Content-Type', 'application/dash+xml');
    res.send(mpd);
  } catch (err) {
    console.error(`[manifest] Build failed for ${videoId}:`, err.message);
    res.status(500).json({ error: 'Manifest generation failed', detail: err.message });
  }
});
```

- [ ] **Step 4: Run the existing test suite to make sure nothing broke**

```bash
cd /home/michael/projects/kidstube/backend
npm test
```

Expected: all existing tests pass (filter, db, youtube, recommendations, etc.). The stream endpoint tests don't exist yet, so `--passWithNoTests` covers the gap.

- [ ] **Step 5: Commit**

```bash
cd /home/michael/projects/kidstube
git add backend/src/server.js
git commit -m "feat: switch /api/stream to Innertube DASH, add /api/manifest endpoint"
```

---

### Task 5: Rebuild, smoke test, and deploy to Roku

**Files:**
- No file changes — this task validates the full pipeline end-to-end

- [ ] **Step 1: Rebuild and restart the backend container**

```bash
cd /home/michael/projects/kidstube
docker compose build backend 2>&1 | tail -8
docker compose up -d backend
```

Expected: `backend  Built`, `Container kidstube-backend  Started`

- [ ] **Step 2: Wait for the container to be healthy**

```bash
sleep 5 && docker compose ps backend
```

Expected: `Up` with `(healthy)` status

- [ ] **Step 3: Smoke test /api/stream with a known-good video ID**

Use a video ID that is known to be in the database. The Minecraft video `dQw4w9WgXcQ` is a known test, but use any videoId from the KidsTube feed. Pick one from the DB:

```bash
docker exec kidstube-backend sqlite3 /app/data/kidstube.db "SELECT video_id FROM videos LIMIT 1;"
```

Then hit the stream endpoint (replace `VIDEO_ID` with the result):

```bash
curl -s http://localhost:3001/api/stream/VIDEO_ID | python3 -m json.tool
```

Expected response shape:
```json
{
  "url": "http://localhost:3001/api/manifest/VIDEO_ID",
  "type": "dash"
}
```

If you get `"Stream unavailable"` with a reason, check `docker compose logs backend --tail=30` for the `[innertube]` log lines.

- [ ] **Step 4: Smoke test /api/manifest**

```bash
curl -s http://localhost:3001/api/manifest/VIDEO_ID | head -10
```

Expected: DASH MPD XML starting with `<?xml version="1.0"` and containing `AdaptationSet`.

- [ ] **Step 5: Repackage and deploy the Roku channel**

The Roku `VideoPlayer.brs` already handles `type="dash"` correctly via `content.streamFormat = parsed.type` — no BrightScript changes needed.

```bash
cd /home/michael/projects/kidstube/roku-app
zip -r ../roku-app.zip .
curl -s -S --user rokudev:(device password) --anyauth \
  -F "mysubmit=Install" \
  -F "archive=@../roku-app.zip" \
  http://192.168.1.37/plugin_install | grep -o '"text":"[^"]*"'
```

Expected: `"text":"Install Success."`

- [ ] **Step 6: Test on device**

On the Roku: launch KidsTube → pick a profile → select a video.

Watch `nc 192.168.1.37 8085` (BrightScript telnet console):

```
[VideoPlayer] got stream url type=dash
[VideoPlayer] state=buffering
[VideoPlayer] state=playing
VODStartComplete
```

If `state=error` appears instead, check the error string — common issues:
- `"unsupported format"`: the MPD codec isn't supported by this Roku model. Check the manifest with `curl http://localhost:3001/api/manifest/VIDEO_ID` to see which codecs are being served. If VP9, the video filter in `dash.js` is not preferring avc1 correctly.
- `"network error"`: the Roku can't reach the backend or YouTube CDN. Verify `m.global.backendUrl` in `main.brs` is still `http://LAN_IP:3001`.

- [ ] **Step 7: Final commit**

```bash
cd /home/michael/projects/kidstube
git add roku-app.zip  # if zip is tracked; otherwise skip
git commit -m "feat: Innertube DASH streaming — full pipeline wired up"
```

---

## Self-Review

**Spec coverage:**
- ✅ `innertube.js` singleton with TV client, disk cache, `getStreamInfo`, `getCached`
- ✅ `dash.js` `buildManifest` with SegmentBase, up to 3 video reps, best audio, avc1 preference
- ✅ `/api/stream/:videoId` updated, removes old streamCache
- ✅ `/api/manifest/:videoId` new endpoint
- ✅ `youtubei.js` installed
- ✅ `/app/data/yt-cache` path used (within existing `./data:/app/data` Docker volume)
- ✅ Roku VideoPlayer — confirmed no changes needed
- ✅ yt-dlp untouched for metadata

**Placeholder scan:** None found. All code is complete.

**Type consistency:**
- `getStreamInfo(videoId)` returns `{ formats, durationMs }` — used identically in server.js
- `getCached(videoId)` returns `{ formats, durationMs }` or `null` — used identically in server.js
- `buildManifest(formats, durationMs)` receives the same shape from both call sites
