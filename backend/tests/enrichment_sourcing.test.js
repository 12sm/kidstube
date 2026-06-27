const { setupTestDb, seedProfile, teardownTestDb } = require('./helpers/testDb');
const { sourceEnrichmentTopics } = require('../src/cron');

let db;
beforeAll(() => { db = setupTestDb(); });
afterEach(() => { teardownTestDb(db); });

test('inserts filter-surviving topic results as approved enrichment videos', async () => {
  seedProfile(db, { id: 6 });
  db.addEnrichmentSource({ profile_id: 6, type: 'topic', value: 'space for kids', label: 'Space' });

  const fakeVideos = [
    { video_id: 'ok1', channel_id: 'c1', channel_name: 'NASA Kids', title: 'Planets', description: '', thumbnail_url: null, published_at: null, duration_seconds: 300 },
    { video_id: 'bad', channel_id: 'c2', channel_name: 'X', title: 'Bad', description: '', thumbnail_url: null, published_at: null, duration_seconds: 300 },
  ];
  const deps = {
    db,
    youtube: { searchVideos: async () => fakeVideos },
    filter: {
      isShort: () => false,
      isLive: () => false,
      runFilterPass: (v) => ({ rejected: v.video_id === 'bad' }),
    },
  };
  const stats = { approved: 0, rejected: 0 };
  await sourceEnrichmentTopics({ id: 6 }, stats, deps);

  const row = db.getVideoById('ok1');
  expect(row).toBeTruthy();
  expect(row.status).toBe('approved');
  expect(row.discovery_source).toBe('enrichment');
  expect(db.getVideoById('bad')).toBeFalsy();
  expect(stats.approved).toBe(1);
});
