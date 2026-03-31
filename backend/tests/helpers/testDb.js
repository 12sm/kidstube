// Sets DB_PATH to :memory: so tests use an in-memory SQLite database.
// Must be required BEFORE db.js is loaded anywhere in the test file.
process.env.DB_PATH = ':memory:';

const db = require('../../src/db');

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

module.exports = { setupTestDb, seedProfile, seedVideo, seedTag, seedInterest };
