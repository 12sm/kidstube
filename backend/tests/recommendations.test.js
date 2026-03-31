// Must set DB_PATH before requiring db
const { setupTestDb, seedProfile, seedVideo, seedTag, seedInterest, teardownTestDb } = require('./helpers/testDb');

let db;
let getRecommendedVideos;

beforeAll(() => {
  db = setupTestDb();
  getRecommendedVideos = require('../src/recommendations').getRecommendedVideos;

  seedProfile(db, { id: 1, name: 'Child1' });

  // Videos
  seedVideo(db, { video_id: 'v1', channel_id: 'ch1', title: 'Space documentary', duration_seconds: 600 });
  seedVideo(db, { video_id: 'v2', channel_id: 'ch2', title: 'Minecraft build', duration_seconds: 500 });
  seedVideo(db, { video_id: 'v3', channel_id: 'ch1', title: 'Saturn rings', duration_seconds: 700 });
  seedVideo(db, { video_id: 'v4', channel_id: 'ch3', title: 'Cooking show', duration_seconds: 400 });

  // Tags
  seedTag(db, 'v1', 'outer-space');
  seedTag(db, 'v1', 'planets');
  seedTag(db, 'v3', 'outer-space');
  seedTag(db, 'v3', 'saturn');
  seedTag(db, 'v2', 'minecraft');
  seedTag(db, 'v4', 'cooking');

  // Profile interests — strong space interest
  seedInterest(db, 1, 'outer-space', 3.0);
  seedInterest(db, 1, 'planets', 1.5);
  seedInterest(db, 1, 'minecraft', 0.5);
});

test('returns recommended videos ordered by score', () => {
  const results = getRecommendedVideos(db, 'v1', 1);
  // v3 has outer-space (3.0) + saturn (0) = 3.0, plus same channel bonus 0.3 = 3.3
  // v2 has minecraft (0.5) = 0.5
  expect(results[0].video_id).toBe('v3');
  expect(results[1].video_id).toBe('v2');
});

test('excludes the current video', () => {
  const results = getRecommendedVideos(db, 'v1', 1);
  expect(results.map(v => v.video_id)).not.toContain('v1');
});

test('falls back to recency when profile has no interests', () => {
  seedProfile(db, { id: 2, name: 'Child2' });
  const results = getRecommendedVideos(db, 'v1', 2);
  expect(results.length).toBeGreaterThan(0);
  // Should not throw, should return videos in some order
});

test('does not exceed limit', () => {
  const results = getRecommendedVideos(db, 'v1', 1, 2);
  expect(results.length).toBeLessThanOrEqual(2);
});
