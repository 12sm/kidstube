jest.mock('axios');
const axios = require('axios');
const { searchVideosInvidious } = require('../src/youtube');

afterEach(() => jest.clearAllMocks());

const invidiousPayload = [
  { type: 'video', videoId: 'abc123', title: 'Space for Kids', author: 'NASA Kids', authorId: 'UCnasa',
    videoThumbnails: [ { quality: 'high', url: 'http://t/high.jpg' }, { quality: 'medium', url: 'http://t/med.jpg' } ],
    description: 'planets', published: 1700000000, lengthSeconds: 120, liveNow: false },
  { type: 'channel', author: 'Some Channel', authorId: 'UCx' }, // must be filtered out
  { type: 'video', videoId: 'live1', title: 'Live Stream', author: 'C2', authorId: 'UC2',
    videoThumbnails: [], lengthSeconds: 300, liveNow: true },
];

test('maps Invidious video results to the standard shape (channels filtered out)', async () => {
  axios.get.mockResolvedValue({ data: invidiousPayload });
  const out = await searchVideosInvidious('space for kids', 20);
  expect(out).toHaveLength(2); // 2 videos, channel dropped
  const v = out[0];
  expect(v.video_id).toBe('abc123');
  expect(v.channel_id).toBe('UCnasa');
  expect(v.channel_name).toBe('NASA Kids');
  expect(v.thumbnail_url).toBe('http://t/med.jpg'); // prefers medium
  expect(v.duration_seconds).toBe(120);
  expect(v.is_live).toBe(false);
  expect(out[1].is_live).toBe(true); // liveNow mapped
});

test('respects maxResults', async () => {
  axios.get.mockResolvedValue({ data: invidiousPayload });
  const out = await searchVideosInvidious('q', 1);
  expect(out).toHaveLength(1);
});

test('returns [] when Invidious is unreachable', async () => {
  axios.get.mockRejectedValue(new Error('ECONNREFUSED'));
  const out = await searchVideosInvidious('q', 20);
  expect(out).toEqual([]);
});
