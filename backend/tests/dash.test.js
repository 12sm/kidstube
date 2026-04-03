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
