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

  console.log(`[innertube] OK ${videoId} — ${playable.length} formats, duration=${Math.round(durationMs / 1000)}s`);
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
