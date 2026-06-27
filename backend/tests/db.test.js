const { setupTestDb, seedProfile, seedVideo, seedTag, seedInterest, teardownTestDb } = require('./helpers/testDb');

let db;

beforeAll(() => {
  db = setupTestDb();
});

afterEach(() => {
  teardownTestDb(db);
});

// 1. All 4 new tables exist after migrate()
describe('migrations', () => {
  test('video_tags table exists', () => {
    const row = db.getDb().prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='video_tags'").get();
    expect(row).toBeTruthy();
  });

  test('profile_interests table exists', () => {
    const row = db.getDb().prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='profile_interests'").get();
    expect(row).toBeTruthy();
  });

  test('profile_insights table exists', () => {
    const row = db.getDb().prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='profile_insights'").get();
    expect(row).toBeTruthy();
  });

  test('child_profiles table exists', () => {
    const row = db.getDb().prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='child_profiles'").get();
    expect(row).toBeTruthy();
  });
});

// 2. insertVideoTags + getVideoTags round-trip
describe('video tags', () => {
  test('insertVideoTags and getVideoTags round-trip', () => {
    seedProfile(db, { id: 1 });
    seedVideo(db, { video_id: 'vid1' });
    db.insertVideoTags('vid1', ['minecraft', 'gaming', 'kids']);
    const tags = db.getVideoTags('vid1');
    expect(tags.sort()).toEqual(['gaming', 'kids', 'minecraft'].sort());
  });

  test('insertVideoTags is idempotent (INSERT OR IGNORE)', () => {
    seedProfile(db, { id: 1 });
    seedVideo(db, { video_id: 'vid1' });
    db.insertVideoTags('vid1', ['minecraft']);
    db.insertVideoTags('vid1', ['minecraft']); // should not throw
    const tags = db.getVideoTags('vid1');
    expect(tags).toEqual(['minecraft']);
  });

  test('getVideoTags returns empty array for unknown video', () => {
    const tags = db.getVideoTags('nonexistent');
    expect(tags).toEqual([]);
  });
});

// 3. upsertProfileInterest creates and updates a row (weight floor at 0)
describe('upsertProfileInterest', () => {
  test('creates a new interest row', () => {
    seedProfile(db, { id: 1 });
    db.upsertProfileInterest(1, 'minecraft', 2.0);
    const row = db.getDb().prepare(
      `SELECT * FROM profile_interests WHERE profile_id = 1 AND tag = 'minecraft' AND source = 'behavior'`
    ).get();
    expect(row).toBeTruthy();
    expect(row.weight).toBe(2.0);
  });

  test('updates weight on conflict', () => {
    seedProfile(db, { id: 1 });
    db.upsertProfileInterest(1, 'minecraft', 2.0);
    db.upsertProfileInterest(1, 'minecraft', 1.0);
    const row = db.getDb().prepare(
      `SELECT weight FROM profile_interests WHERE profile_id = 1 AND tag = 'minecraft' AND source = 'behavior'`
    ).get();
    expect(row.weight).toBe(3.0);
  });

  test('weight floor is 0 — negative delta cannot go below 0', () => {
    seedProfile(db, { id: 1 });
    db.upsertProfileInterest(1, 'minecraft', 1.0);
    db.upsertProfileInterest(1, 'minecraft', -5.0); // should floor at 0
    const row = db.getDb().prepare(
      `SELECT weight FROM profile_interests WHERE profile_id = 1 AND tag = 'minecraft' AND source = 'behavior'`
    ).get();
    expect(row.weight).toBe(0);
  });
});

// 4. setParentInterest creates a 'parent' source row
describe('setParentInterest', () => {
  test('creates a parent source row', () => {
    seedProfile(db, { id: 1 });
    db.setParentInterest(1, 'science', 5.0);
    const row = db.getDb().prepare(
      `SELECT * FROM profile_interests WHERE profile_id = 1 AND tag = 'science' AND source = 'parent'`
    ).get();
    expect(row).toBeTruthy();
    expect(row.weight).toBe(5.0);
    expect(row.source).toBe('parent');
  });

  test('overwrites weight on conflict', () => {
    seedProfile(db, { id: 1 });
    db.setParentInterest(1, 'science', 5.0);
    db.setParentInterest(1, 'science', 3.0);
    const row = db.getDb().prepare(
      `SELECT weight FROM profile_interests WHERE profile_id = 1 AND tag = 'science' AND source = 'parent'`
    ).get();
    expect(row.weight).toBe(3.0);
  });
});

// 5. deleteParentInterests removes only 'parent' rows
describe('deleteParentInterests', () => {
  test('removes only parent rows, leaves behavior rows intact', () => {
    seedProfile(db, { id: 1 });
    db.setParentInterest(1, 'science', 5.0);
    db.setParentInterest(1, 'math', 3.0);
    db.upsertProfileInterest(1, 'gaming', 2.0); // behavior row
    db.deleteParentInterests(1);

    const parentRows = db.getDb().prepare(
      `SELECT * FROM profile_interests WHERE profile_id = 1 AND source = 'parent'`
    ).all();
    expect(parentRows).toHaveLength(0);

    const behaviorRows = db.getDb().prepare(
      `SELECT * FROM profile_interests WHERE profile_id = 1 AND source = 'behavior'`
    ).all();
    expect(behaviorRows).toHaveLength(1);
    expect(behaviorRows[0].tag).toBe('gaming');
  });
});

// 6. applyDecayToProfile multiplies behavior weights by 0.85 but skips today's rows and 'parent' rows
describe('applyDecayToProfile', () => {
  test('decays behavior rows with old last_seen', () => {
    seedProfile(db, { id: 1 });
    // Insert a behavior row with yesterday's date
    db.getDb().prepare(`
      INSERT INTO profile_interests (profile_id, tag, weight, source, last_seen)
      VALUES (1, 'gaming', 10.0, 'behavior', date('now', '-1 day'))
    `).run();

    db.applyDecayToProfile(1, new Date().toISOString().slice(0, 10));

    const row = db.getDb().prepare(
      `SELECT weight FROM profile_interests WHERE profile_id = 1 AND tag = 'gaming'`
    ).get();
    expect(row.weight).toBeCloseTo(8.5, 5);
  });

  test('does not decay rows with today as last_seen', () => {
    seedProfile(db, { id: 1 });
    db.upsertProfileInterest(1, 'gaming', 10.0); // last_seen = today
    const today = new Date().toISOString().slice(0, 10);
    db.applyDecayToProfile(1, today);

    const row = db.getDb().prepare(
      `SELECT weight FROM profile_interests WHERE profile_id = 1 AND tag = 'gaming'`
    ).get();
    expect(row.weight).toBe(10.0);
  });

  test('does not decay parent rows', () => {
    seedProfile(db, { id: 1 });
    db.getDb().prepare(`
      INSERT INTO profile_interests (profile_id, tag, weight, source, last_seen)
      VALUES (1, 'science', 10.0, 'parent', date('now', '-1 day'))
    `).run();

    db.applyDecayToProfile(1, new Date().toISOString().slice(0, 10));

    const row = db.getDb().prepare(
      `SELECT weight FROM profile_interests WHERE profile_id = 1 AND tag = 'science'`
    ).get();
    expect(row.weight).toBe(10.0);
  });
});

// 7. profileHadSessionToday returns true when watch_history has a row for today
describe('profileHadSessionToday', () => {
  test('returns false when no watch history today', () => {
    seedProfile(db, { id: 1 });
    const today = new Date().toISOString().slice(0, 10);
    expect(db.profileHadSessionToday(1, today)).toBe(false);
  });

  test('returns true when watch history exists for today', () => {
    seedProfile(db, { id: 1 });
    seedVideo(db, { video_id: 'vid1' });
    db.upsertWatchHistory(1, 'vid1', 100, 300);
    const today = new Date().toISOString().slice(0, 10);
    expect(db.profileHadSessionToday(1, today)).toBe(true);
  });

  test('returns false for a different date', () => {
    seedProfile(db, { id: 1 });
    seedVideo(db, { video_id: 'vid1' });
    db.upsertWatchHistory(1, 'vid1', 100, 300);
    expect(db.profileHadSessionToday(1, '2000-01-01')).toBe(false);
  });
});

// 8. insertProfileInsight + getUnconsolidatedInsights + markInsightsConsolidated flow
describe('profile insights', () => {
  test('insertProfileInsight stores an insight', () => {
    seedProfile(db, { id: 1 });
    db.insertProfileInsight(1, 'Likes Minecraft videos', 'watch_behavior');
    const rows = db.getUnconsolidatedInsights(1);
    expect(rows).toHaveLength(1);
    expect(rows[0].insight).toBe('Likes Minecraft videos');
    expect(rows[0].source).toBe('watch_behavior');
  });

  test('getUnconsolidatedInsights returns only unconsolidated rows', () => {
    seedProfile(db, { id: 1 });
    db.insertProfileInsight(1, 'Insight 1', 'src');
    db.insertProfileInsight(1, 'Insight 2', 'src');
    db.markInsightsConsolidated(1);
    db.insertProfileInsight(1, 'Insight 3', 'src');

    const rows = db.getUnconsolidatedInsights(1);
    expect(rows).toHaveLength(1);
    expect(rows[0].insight).toBe('Insight 3');
  });

  test('markInsightsConsolidated marks all unconsolidated rows', () => {
    seedProfile(db, { id: 1 });
    db.insertProfileInsight(1, 'Insight A', 'src');
    db.insertProfileInsight(1, 'Insight B', 'src');
    db.markInsightsConsolidated(1);

    const rows = db.getUnconsolidatedInsights(1);
    expect(rows).toHaveLength(0);
  });
});

// 9. getChildProfile + saveChildProfile round-trip
describe('child profiles', () => {
  test('returns undefined when no child profile exists', () => {
    seedProfile(db, { id: 1 });
    expect(db.getChildProfile(1)).toBeUndefined();
  });

  test('saveChildProfile creates a record', () => {
    seedProfile(db, { id: 1 });
    db.saveChildProfile(1, '# Child1\nLoves Minecraft', 'parent');
    const row = db.getChildProfile(1);
    expect(row).toBeTruthy();
    expect(row.markdown).toBe('# Child1\nLoves Minecraft');
    expect(row.updated_by).toBe('parent');
  });

  test('saveChildProfile updates on conflict', () => {
    seedProfile(db, { id: 1 });
    db.saveChildProfile(1, 'first version', 'parent');
    db.saveChildProfile(1, 'second version', 'llm');
    const row = db.getChildProfile(1);
    expect(row.markdown).toBe('second version');
    expect(row.updated_by).toBe('llm');
  });
});

// 10. getTagStatsByDay returns correct counts
describe('getTagStatsByDay', () => {
  test('returns correct counts and completion stats', () => {
    seedProfile(db, { id: 1 });
    seedVideo(db, { video_id: 'vid1', duration_seconds: 100 });
    seedVideo(db, { video_id: 'vid2', duration_seconds: 100 });
    seedVideo(db, { video_id: 'vid3', duration_seconds: 100 });
    seedTag(db, 'vid1', 'minecraft');
    seedTag(db, 'vid2', 'minecraft');
    seedTag(db, 'vid3', 'cooking');

    // vid1: watched 90% (completed), vid2: watched 50% (not completed), vid3: watched 90% (completed)
    db.upsertWatchHistory(1, 'vid1', 90, 100);
    db.upsertWatchHistory(1, 'vid2', 50, 100);
    db.upsertWatchHistory(1, 'vid3', 90, 100);

    const today = new Date().toISOString().slice(0, 10);
    const stats = db.getTagStatsByDay(1, today);

    const minecraft = stats.find(s => s.tag === 'minecraft');
    const cooking = stats.find(s => s.tag === 'cooking');

    expect(minecraft).toBeTruthy();
    expect(minecraft.total).toBe(2);
    expect(minecraft.completed).toBe(1); // only vid1 >= 80%
    expect(minecraft.avg_completion).toBeCloseTo(0.70, 1); // (0.9 + 0.5) / 2

    expect(cooking).toBeTruthy();
    expect(cooking.total).toBe(1);
    expect(cooking.completed).toBe(1);
    expect(cooking.avg_completion).toBeCloseTo(0.90, 2);
  });

  test('returns empty array when no watch history for date', () => {
    seedProfile(db, { id: 1 });
    const stats = db.getTagStatsByDay(1, '2000-01-01');
    expect(stats).toEqual([]);
  });
});

// --- search history ---
describe('search history', () => {
  test('search_queries table exists after migrate', () => {
    const row = db.getDb().prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='search_queries'").get();
    expect(row).toBeTruthy();
  });

  test('needs_llm_review column exists on videos', () => {
    const row = db.getDb().prepare("SELECT 1 FROM pragma_table_info('videos') WHERE name='needs_llm_review'").get();
    expect(row).toBeTruthy();
  });

  test('saveSearchQuery upserts and getSearchHistory returns newest first', () => {
    seedProfile(db, { id: 1 });
    db.saveSearchQuery(1, 'bluey');
    db.saveSearchQuery(1, 'peppa pig');
    db.saveSearchQuery(1, 'bluey'); // re-searching bluey bumps it to top
    const history = db.getSearchHistory(1);
    expect(history[0]).toBe('bluey');
    expect(history[1]).toBe('peppa pig');
  });

  test('deleteSearchQuery removes the entry', () => {
    seedProfile(db, { id: 1 });
    db.saveSearchQuery(1, 'monster trucks');
    db.deleteSearchQuery(1, 'monster trucks');
    const history = db.getSearchHistory(1);
    expect(history).not.toContain('monster trucks');
  });

  test('getSearchHistory returns at most 20 entries', () => {
    seedProfile(db, { id: 1 });
    for (let i = 0; i < 25; i++) db.saveSearchQuery(1, `query ${i}`);
    const history = db.getSearchHistory(1);
    expect(history.length).toBeLessThanOrEqual(20);
  });
});

// --- channel_recommendations ---
describe('channel_recommendations', () => {
  beforeEach(() => {
    db.getDb().prepare('INSERT OR IGNORE INTO profiles (id, name) VALUES (5, ?)').run('Child1');
    db.getDb().prepare('INSERT OR IGNORE INTO channels (channel_id, profile_id, channel_name, whitelisted) VALUES (?, ?, ?, ?)').run('UCtest1', 5, 'Test Channel', 0);
  });

  test('upsertChannelRecommendation inserts a new rec', () => {
    db.upsertChannelRecommendation('UCtest1', 5, 'enable', 'Good STEM content');
    const recs = db.getChannelRecommendations(5);
    expect(recs).toHaveLength(1);
    expect(recs[0].recommendation).toBe('enable');
    expect(recs[0].reason).toBe('Good STEM content');
    expect(recs[0].dismissed).toBe(0);
    expect(recs[0].applied).toBe(0);
  });

  test('upsertChannelRecommendation updates on re-run', () => {
    db.upsertChannelRecommendation('UCtest1', 5, 'enable', 'First reason');
    db.upsertChannelRecommendation('UCtest1', 5, 'disable', 'Updated reason');
    // Use getAllChannelRecommendations — getChannelRecommendations filters for actionable recs
    // only (disable + whitelisted=1, or enable + whitelisted=0). UCtest1 has whitelisted=0 so
    // a 'disable' rec is not actionable, but the upsert itself should still have updated it.
    const recs = db.getAllChannelRecommendations(5);
    expect(recs).toHaveLength(1);
    expect(recs[0].recommendation).toBe('disable');
    expect(recs[0].reason).toBe('Updated reason');
  });

  test('getChannelRecommendations excludes dismissed and applied', () => {
    db.getDb().prepare('INSERT OR IGNORE INTO channels (channel_id, profile_id, channel_name, whitelisted) VALUES (?, ?, ?, ?)').run('UCtest2', 5, 'Dismissed Chan', 0);
    db.getDb().prepare('INSERT OR IGNORE INTO channels (channel_id, profile_id, channel_name, whitelisted) VALUES (?, ?, ?, ?)').run('UCtest3', 5, 'Applied Chan', 0);
    db.upsertChannelRecommendation('UCtest1', 5, 'enable', 'Active');
    db.upsertChannelRecommendation('UCtest2', 5, 'enable', 'Dismissed');
    db.upsertChannelRecommendation('UCtest3', 5, 'enable', 'Applied');
    db.dismissChannelRecommendation('UCtest2', 5);
    db.applyChannelRecommendation('UCtest3', 5);
    const recs = db.getChannelRecommendations(5);
    expect(recs).toHaveLength(1);
    expect(recs[0].channel_id).toBe('UCtest1');
  });

  test('applyChannelRecommendation flips whitelisted flag', () => {
    db.upsertChannelRecommendation('UCtest1', 5, 'enable', 'Good content');
    db.applyChannelRecommendation('UCtest1', 5);
    const channel = db.getDb().prepare('SELECT whitelisted FROM channels WHERE channel_id=? AND profile_id=?').get('UCtest1', 5);
    expect(channel.whitelisted).toBe(1);
    const rec = db.getDb().prepare('SELECT applied FROM channel_recommendations WHERE channel_id=? AND profile_id=?').get('UCtest1', 5);
    expect(rec.applied).toBe(1);
  });
});

// searchApprovedVideos — full-library, block-aware, per-word search
// Regression coverage for the search fix: repeat/off-whitelist searches must
// return results from the local approved library even without the live API.
describe('searchApprovedVideos', () => {
  const wl = (channelId, profileId, name, whitelisted) =>
    db.getDb().prepare(
      'INSERT OR IGNORE INTO channels (channel_id, profile_id, channel_name, whitelisted) VALUES (?,?,?,?)'
    ).run(channelId, profileId, name, whitelisted);

  test('finds an approved video whose channel is NOT whitelisted (the core fix)', () => {
    seedProfile(db, { id: 5 });
    // search-discovered video, channel has no row in channels at all
    seedVideo(db, { video_id: 'v1', channel_id: 'chX', channel_name: 'Maizen', title: 'JJ Babysitter Adventure' });
    const out = db.searchApprovedVideos(5, 'Babysitter');
    expect(out.map(v => v.video_id)).toContain('v1');
  });

  test('per-word matching: "JJ sitter" matches "Maizen JJ Babysitter"', () => {
    seedProfile(db, { id: 5 });
    seedVideo(db, { video_id: 'v1', channel_id: 'chX', channel_name: 'Maizen', title: 'Maizen JJ Babysitter' });
    expect(db.searchApprovedVideos(5, 'JJ sitter').map(v => v.video_id)).toContain('v1');
    // whole-phrase substring would NOT have matched
  });

  test('excludes videos in a channel the parent blocked (whitelisted = 0)', () => {
    seedProfile(db, { id: 5 });
    wl('chBlocked', 5, 'Blocked Chan', 0);
    seedVideo(db, { video_id: 'v1', channel_id: 'chBlocked', channel_name: 'Blocked Chan', title: 'Dinosaurs' });
    expect(db.searchApprovedVideos(5, 'Dinosaurs')).toHaveLength(0);
  });

  test('excludes per-profile video_block rules', () => {
    seedProfile(db, { id: 5 });
    seedVideo(db, { video_id: 'v1', channel_id: 'chX', channel_name: 'Chan', title: 'Dinosaurs' });
    db.blockVideo(5, 'v1');
    expect(db.searchApprovedVideos(5, 'Dinosaurs')).toHaveLength(0);
  });

  test('excludes non-approved videos', () => {
    seedProfile(db, { id: 5 });
    seedVideo(db, { video_id: 'v1', channel_id: 'chX', title: 'Pending Dino', status: 'pending' });
    seedVideo(db, { video_id: 'v2', channel_id: 'chX', title: 'Rejected Dino', status: 'rejected' });
    expect(db.searchApprovedVideos(5, 'Dino')).toHaveLength(0);
  });

  test('ranks whitelisted-channel hits ahead of the broader library', () => {
    seedProfile(db, { id: 5 });
    wl('chWL', 5, 'Whitelisted Chan', 1);
    seedVideo(db, { video_id: 'vOther', channel_id: 'chOther', channel_name: 'Other', title: 'Robot Cars' });
    seedVideo(db, { video_id: 'vWL', channel_id: 'chWL', channel_name: 'Whitelisted Chan', title: 'Robot Cars' });
    const out = db.searchApprovedVideos(5, 'Robot Cars');
    expect(out[0].video_id).toBe('vWL');
  });
});
