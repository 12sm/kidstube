// Sets DB_PATH to :memory: so tests use an in-memory SQLite database.
// Must be required BEFORE db.js is loaded anywhere in the test file.
process.env.DB_PATH = ':memory:';

const db = require('../../src/db');

// NOTE: setupTestDb() returns the same db module reference every call within a test file.
// Call teardownTestDb(db) in afterEach/afterAll to clear state between tests.
function setupTestDb() {
  db.migrate();
  return db;
}

function seedProfile(db, { id = 1, name = 'Test' } = {}) {
  db.getDb().prepare(
    `INSERT OR IGNORE INTO profiles (id, name) VALUES (?, ?)`
  ).run(id, name);
}

function seedVideo(db, { video_id = 'vid1', channel_id = 'ch1', channel_name = 'Chan', title = 'Test', status = 'approved', duration_seconds = 300 } = {}) {
  db.getDb().prepare(`
    INSERT OR IGNORE INTO videos (video_id, channel_id, channel_name, title, status, duration_seconds, published_at)
    VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `).run(video_id, channel_id, channel_name, title, status, duration_seconds);
}

function seedTag(db, videoId, tag) {
  db.getDb().prepare(
    `INSERT OR IGNORE INTO video_tags (video_id, tag) VALUES (?, ?)`
  ).run(videoId, tag);
}

function seedInterest(db, profileId, tag, weight, source = 'behavior') {
  db.getDb().prepare(`
    INSERT OR REPLACE INTO profile_interests (profile_id, tag, weight, source, last_seen)
    VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
  `).run(profileId, tag, weight, source);
}

function teardownTestDb(db) {
  // Delete in FK-safe order (children before parents)
  db.getDb().prepare('DELETE FROM profile_interests').run();
  db.getDb().prepare('DELETE FROM profile_insights').run();
  db.getDb().prepare('DELETE FROM child_profiles').run();
  db.getDb().prepare('DELETE FROM video_tags').run();
  db.getDb().prepare('DELETE FROM watch_history').run();
  db.getDb().prepare('DELETE FROM channel_recommendations').run();
  db.getDb().prepare('DELETE FROM filter_rules').run();
  db.getDb().prepare('DELETE FROM videos').run();
  db.getDb().prepare('DELETE FROM channels').run();
  db.getDb().prepare('DELETE FROM profiles').run();
}

module.exports = { setupTestDb, seedProfile, seedVideo, seedTag, seedInterest, teardownTestDb };
