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
