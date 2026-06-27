const { setupTestDb, seedProfile, seedVideo, seedTag, seedInterest, teardownTestDb } = require('./helpers/testDb');
const dietMonitor = require('../src/dietMonitor');
const feedComposer = require('../src/feedComposer');

let db;
beforeAll(() => { db = setupTestDb(); });
afterEach(() => { teardownTestDb(db); });

// Reproduce the route's composition logic against a seeded DB to prove the
// pieces compose: a heavy-gaming diet yields an escalated enrichment ratio and
// the composer surfaces enrichment videos.
test('all-gaming diet escalates ratio and composer injects enrichment', () => {
  seedProfile(db, { id: 6 });
  // whitelist a channel so getApprovedFeed has a pool
  db.getDb().prepare('INSERT INTO channels (channel_id, profile_id, channel_name, whitelisted) VALUES (?,?,?,1)').run('gc', 6, 'GameChan');
  db.getDb().prepare('INSERT INTO channels (channel_id, profile_id, channel_name, whitelisted) VALUES (?,?,?,1)').run('ec', 6, 'EnrichChan');

  // 10 gaming + 10 enrichment approved videos
  for (let i = 0; i < 10; i++) {
    seedVideo(db, { video_id: 'g' + i, channel_id: 'gc', title: 'Minecraft ' + i });
    seedTag(db, 'g' + i, 'minecraft');
    seedVideo(db, { video_id: 'e' + i, channel_id: 'ec', title: 'Space ' + i });
    seedTag(db, 'e' + i, 'educational');
  }
  // Watch history: 10 gaming videos → all-gaming diet
  for (let i = 0; i < 10; i++) db.upsertWatchHistory(6, 'g' + i, 10, 100);

  const info = dietMonitor.getEnrichmentRatio(6);
  expect(info.gamingFraction).toBeCloseTo(1.0);
  expect(info.ratio).toBeCloseTo(0.50);

  const raw = db.getApprovedFeed(6, 0, 100, []);
  const gamingSet = new Set(db.getGamingVideoIds(raw.map(v => v.video_id)));
  const out = feedComposer.composeFeed(raw, {
    ratio: info.ratio, limit: 10,
    isGaming: v => gamingSet.has(v.video_id),
    isGrowth: () => false,
    perChannelCap: 2,
  });
  // With a 0.50 ratio and per-channel cap 2, enrichment must appear.
  expect(out.filter(v => !gamingSet.has(v.video_id)).length).toBeGreaterThan(0);
});

test('merged enrichment pool lets composer surface enrichment even when getApprovedFeed is all-gaming', () => {
  seedProfile(db, { id: 7 });
  db.getDb().prepare('INSERT INTO channels (channel_id, profile_id, channel_name, whitelisted) VALUES (?,?,?,1)').run('gc', 7, 'GameChan');
  db.getDb().prepare('INSERT INTO channels (channel_id, profile_id, channel_name, whitelisted) VALUES (?,?,?,1)').run('ec', 7, 'EnrichChan');
  // heavy gaming interest so gaming dominates getApprovedFeed scoring
  seedInterest(db, 7, 'minecraft', 900);
  for (let i = 0; i < 30; i++) { seedVideo(db, { video_id: 'g' + i, channel_id: 'gc', title: 'Minecraft ' + i }); seedTag(db, 'g' + i, 'minecraft'); }
  for (let i = 0; i < 10; i++) { seedVideo(db, { video_id: 'e' + i, channel_id: 'ec', title: 'Space ' + i }); seedTag(db, 'e' + i, 'educational'); }
  for (let i = 0; i < 15; i++) db.upsertWatchHistory(7, 'g' + i, 10, 100); // all-gaming diet

  const limit = 18;
  const raw = db.getApprovedFeed(7, 0, limit * 5, []);
  const enrichmentPool = db.getEnrichmentCandidates(7, limit * 2, []);
  const seenInRaw = new Set(raw.map(v => v.video_id));
  const pool = [...raw, ...enrichmentPool.filter(v => !seenInRaw.has(v.video_id))];
  const gamingSet = new Set(db.getGamingVideoIds(pool.map(v => v.video_id)));
  const info = dietMonitor.getEnrichmentRatio(7);
  const out = feedComposer.composeFeed(pool, { ratio: info.ratio, limit, isGaming: v => gamingSet.has(v.video_id), isGrowth: () => false, perChannelCap: 2 });
  const enrichCount = out.filter(v => !gamingSet.has(v.video_id)).length;
  expect(enrichCount).toBeGreaterThan(0); // enrichment now actually appears
});
