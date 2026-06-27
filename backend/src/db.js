const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const { normalizeTag, normalizeTags, CANONICAL_TAGS, ALIAS_MAP, TAG_CATEGORIES, TAG_TO_CATEGORY } = require('./tags');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'kidstube.db');

// Ensure data directory exists
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

let db;

function getDb() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
  }
  return db;
}

function migrate() {
  const db = getDb();

  db.exec(`
    CREATE TABLE IF NOT EXISTS profiles (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      name                TEXT NOT NULL,
      google_access_token TEXT,
      google_refresh_token TEXT,
      created_at          DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS channels (
      channel_id    TEXT PRIMARY KEY,
      profile_id    INTEGER NOT NULL REFERENCES profiles(id),
      channel_name  TEXT,
      thumbnail_url TEXT,
      whitelisted   BOOLEAN DEFAULT 1,
      last_synced   DATETIME
    );

    CREATE TABLE IF NOT EXISTS videos (
      video_id         TEXT PRIMARY KEY,
      channel_id       TEXT REFERENCES channels(channel_id),
      channel_name     TEXT,
      channel_thumbnail TEXT,
      title            TEXT,
      description      TEXT,
      thumbnail_url    TEXT,
      transcript       TEXT,
      duration_seconds INTEGER,
      published_at     DATETIME,
      status           TEXT DEFAULT 'pending',
      rejection_reason TEXT,
      is_recommended   BOOLEAN DEFAULT 0,
      source_video_id  TEXT,
      processed_at     DATETIME
    );

    CREATE TABLE IF NOT EXISTS filter_rules (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      profile_id INTEGER REFERENCES profiles(id),
      rule_type  TEXT NOT NULL,
      value      TEXT NOT NULL,
      scope      TEXT DEFAULT 'all',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS cron_runs (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      started_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
      finished_at      DATETIME,
      videos_found     INTEGER DEFAULT 0,
      videos_approved  INTEGER DEFAULT 0,
      videos_rejected  INTEGER DEFAULT 0,
      error_message    TEXT
    );

    CREATE TABLE IF NOT EXISTS watch_history (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      profile_id       INTEGER NOT NULL REFERENCES profiles(id),
      video_id         TEXT NOT NULL,
      progress_seconds INTEGER DEFAULT 0,
      duration_seconds INTEGER DEFAULT 0,
      watched_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(profile_id, video_id)
    );

    CREATE TABLE IF NOT EXISTS view_count_local (
      video_id TEXT PRIMARY KEY,
      views    INTEGER DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_videos_status ON videos(status);
    CREATE INDEX IF NOT EXISTS idx_videos_channel ON videos(channel_id);
    CREATE INDEX IF NOT EXISTS idx_videos_published ON videos(published_at);
    CREATE INDEX IF NOT EXISTS idx_videos_recommended ON videos(is_recommended, source_video_id);
    CREATE INDEX IF NOT EXISTS idx_channels_profile ON channels(profile_id);
    CREATE INDEX IF NOT EXISTS idx_rules_profile ON filter_rules(profile_id);
    CREATE INDEX IF NOT EXISTS idx_watch_history_profile ON watch_history(profile_id, watched_at DESC);

    CREATE TABLE IF NOT EXISTS video_tags (
      video_id  TEXT NOT NULL REFERENCES videos(video_id) ON DELETE CASCADE,
      tag       TEXT NOT NULL,
      weight    REAL NOT NULL DEFAULT 1.0,
      PRIMARY KEY (video_id, tag)
    );

    CREATE TABLE IF NOT EXISTS profile_interests (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      profile_id  INTEGER NOT NULL REFERENCES profiles(id),
      tag         TEXT NOT NULL,
      weight      REAL NOT NULL DEFAULT 1.0,
      source      TEXT NOT NULL DEFAULT 'behavior',
      last_seen   DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(profile_id, tag, source)
    );

    CREATE TABLE IF NOT EXISTS profile_insights (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      profile_id   INTEGER NOT NULL REFERENCES profiles(id),
      insight      TEXT NOT NULL,
      source       TEXT NOT NULL,
      created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
      consolidated INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS child_profiles (
      profile_id  INTEGER PRIMARY KEY REFERENCES profiles(id),
      markdown    TEXT NOT NULL DEFAULT '',
      updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_by  TEXT NOT NULL DEFAULT 'parent'
    );

    CREATE INDEX IF NOT EXISTS idx_video_tags_tag ON video_tags(tag);
    CREATE INDEX IF NOT EXISTS idx_profile_interests_profile ON profile_interests(profile_id);
    CREATE INDEX IF NOT EXISTS idx_profile_insights_profile ON profile_insights(profile_id, consolidated);

    CREATE TABLE IF NOT EXISTS channel_recommendations (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      channel_id     TEXT NOT NULL,
      profile_id     INTEGER NOT NULL REFERENCES profiles(id),
      recommendation TEXT NOT NULL,
      reason         TEXT NOT NULL,
      dismissed      INTEGER NOT NULL DEFAULT 0,
      applied        INTEGER NOT NULL DEFAULT 0,
      created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(channel_id, profile_id)
    );
    CREATE INDEX IF NOT EXISTS idx_channel_recs_profile ON channel_recommendations(profile_id, dismissed, applied);

    CREATE TABLE IF NOT EXISTS search_queries (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      profile_id  INTEGER NOT NULL REFERENCES profiles(id),
      query       TEXT NOT NULL,
      searched_at DATETIME NOT NULL DEFAULT (datetime('now')),
      UNIQUE(profile_id, query)
    );
    CREATE INDEX IF NOT EXISTS idx_search_queries_profile ON search_queries(profile_id, searched_at DESC);
  `);

  // Fix videos.channel_id FK — channel_id is no longer a unique key in channels after composite-key migration
  const videosDef = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='videos'").get();
  if (videosDef && videosDef.sql.includes('REFERENCES channels(channel_id)')) {
    db.exec(`
      CREATE TABLE videos_new (
        video_id         TEXT PRIMARY KEY,
        channel_id       TEXT,
        channel_name     TEXT,
        channel_thumbnail TEXT,
        title            TEXT,
        description      TEXT,
        thumbnail_url    TEXT,
        transcript       TEXT,
        duration_seconds INTEGER,
        published_at     DATETIME,
        status           TEXT DEFAULT 'pending',
        rejection_reason TEXT,
        is_recommended   BOOLEAN DEFAULT 0,
        source_video_id  TEXT,
        processed_at     DATETIME
      );
      INSERT OR IGNORE INTO videos_new SELECT * FROM videos;
      DROP TABLE videos;
      ALTER TABLE videos_new RENAME TO videos;
      CREATE INDEX IF NOT EXISTS idx_videos_status      ON videos(status);
      CREATE INDEX IF NOT EXISTS idx_videos_channel     ON videos(channel_id);
      CREATE INDEX IF NOT EXISTS idx_videos_published   ON videos(published_at);
      CREATE INDEX IF NOT EXISTS idx_videos_recommended ON videos(is_recommended, source_video_id);
    `);
    console.log('Videos table: removed broken channel_id FK constraint');
  }

  // Migrate: add view_count to videos
  const hasViewCount = db.prepare("SELECT 1 FROM pragma_table_info('videos') WHERE name='view_count'").get();
  if (!hasViewCount) {
    db.exec('ALTER TABLE videos ADD COLUMN view_count INTEGER');
    console.log('Videos table: added view_count column');
  }

  // Migrate: add enrichment columns to channels
  const hasDescription = db.prepare("SELECT 1 FROM pragma_table_info('channels') WHERE name='description'").get();
  if (!hasDescription) {
    db.exec(`
      ALTER TABLE channels ADD COLUMN description TEXT;
      ALTER TABLE channels ADD COLUMN subscriber_count INTEGER;
      ALTER TABLE channels ADD COLUMN custom_url TEXT;
    `);
    console.log('Channels table: added enrichment columns');
  }

  // Migrate channels table to support the same channel across multiple profiles
  const hasCompositeKey = db.prepare("SELECT 1 FROM pragma_table_info('channels') WHERE name='id'").get();
  if (!hasCompositeKey) {
    db.exec(`
      CREATE TABLE channels_new (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        channel_id       TEXT NOT NULL,
        profile_id       INTEGER NOT NULL REFERENCES profiles(id),
        channel_name     TEXT,
        thumbnail_url    TEXT,
        whitelisted      BOOLEAN DEFAULT 1,
        last_synced      DATETIME,
        description      TEXT,
        subscriber_count INTEGER,
        custom_url       TEXT,
        UNIQUE(channel_id, profile_id)
      );
      INSERT OR IGNORE INTO channels_new (channel_id, profile_id, channel_name, thumbnail_url, whitelisted, last_synced, description, subscriber_count, custom_url)
        SELECT channel_id, profile_id, channel_name, thumbnail_url, whitelisted, last_synced, description, subscriber_count, custom_url FROM channels;
      DROP TABLE channels;
      ALTER TABLE channels_new RENAME TO channels;
      CREATE INDEX IF NOT EXISTS idx_channels_profile ON channels(profile_id);
    `);
    console.log('Channels table migrated to composite (channel_id, profile_id) key');
  }

  // Migrate: add needs_llm_review to videos
  const hasNeedsLlmReview = db.prepare("SELECT 1 FROM pragma_table_info('videos') WHERE name='needs_llm_review'").get();
  if (!hasNeedsLlmReview) {
    db.exec('ALTER TABLE videos ADD COLUMN needs_llm_review INTEGER NOT NULL DEFAULT 0');
    console.log('Videos table: added needs_llm_review column');
  }

  // Migrate: add behavior_weight_ceiling to profiles
  const profileCols = db.pragma('table_info(profiles)').map(c => c.name);
  if (!profileCols.includes('behavior_weight_ceiling')) {
    db.exec(`ALTER TABLE profiles ADD COLUMN behavior_weight_ceiling REAL NOT NULL DEFAULT 10.0`);
    console.log('Profiles table: added behavior_weight_ceiling column');
  }

  // Migrate: interest_tag_settings table
  db.exec(`
    CREATE TABLE IF NOT EXISTS interest_tag_settings (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      profile_id  INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      tag         TEXT NOT NULL,
      multiplier  REAL NOT NULL DEFAULT 1.0,
      hard_cap    REAL,
      created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(profile_id, tag)
    );
    CREATE INDEX IF NOT EXISTS idx_tag_settings_profile ON interest_tag_settings(profile_id);
  `);

  // tag_category_map — populated from tags.js on every startup
  db.exec(`
    CREATE TABLE IF NOT EXISTS tag_category_map (
      tag      TEXT PRIMARY KEY,
      category TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_tcm_category ON tag_category_map(category);
  `);
  {
    const upsert = db.prepare(
      'INSERT INTO tag_category_map (tag, category) VALUES (?, ?) ON CONFLICT(tag) DO UPDATE SET category = excluded.category'
    );
    const insertAll = db.transaction((entries) => {
      for (const [tag, category] of entries) upsert.run(tag, category);
    });
    const entries = [];
    for (const [category, tags] of Object.entries(TAG_CATEGORIES)) {
      for (const tag of tags) entries.push([tag, category]);
    }
    insertAll(entries);
  }

  // Migrate: normalize existing tags (one-time)
  db.exec(`CREATE TABLE IF NOT EXISTS migrations (key TEXT PRIMARY KEY, ran_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
  const hasTagNorm = db.prepare("SELECT 1 FROM migrations WHERE key = 'tag_normalization_v1'").get();
  if (!hasTagNorm) {
    const aliasEntries = Object.entries(ALIAS_MAP);
    console.log(`Tag normalization: migrating ${aliasEntries.length} aliases...`);

    db.transaction(() => {
      // 1. video_tags: delete alias rows where canonical already exists for same video, rename the rest
      const deleteVtDupe = db.prepare(
        `DELETE FROM video_tags WHERE tag = ? AND video_id IN (SELECT video_id FROM video_tags WHERE tag = ?)`
      );
      const renameVt = db.prepare(`UPDATE video_tags SET tag = ? WHERE tag = ?`);

      // 2. profile_interests: merge alias weight into existing canonical row, then delete alias row.
      //    If no canonical row exists, just rename the alias row.
      const findPiAlias = db.prepare(
        `SELECT id, profile_id, weight, source, last_seen FROM profile_interests WHERE tag = ?`
      );
      const findPiCanonical = db.prepare(
        `SELECT id FROM profile_interests WHERE profile_id = ? AND tag = ? AND source = ?`
      );
      const addWeightPi = db.prepare(
        `UPDATE profile_interests SET weight = weight + ?, last_seen = MAX(last_seen, ?) WHERE id = ?`
      );
      const deletePiById = db.prepare(`DELETE FROM profile_interests WHERE id = ?`);
      const renamePiById = db.prepare(`UPDATE profile_interests SET tag = ? WHERE id = ?`);

      // 3. interest_tag_settings: delete alias rows where canonical exists for same profile, rename rest
      const deleteTsDupe = db.prepare(
        `DELETE FROM interest_tag_settings WHERE tag = ? AND profile_id IN (SELECT profile_id FROM interest_tag_settings WHERE tag = ?)`
      );
      const renameTs = db.prepare(`UPDATE interest_tag_settings SET tag = ? WHERE tag = ?`);

      for (const [alias, canonical] of aliasEntries) {
        // video_tags
        deleteVtDupe.run(alias, canonical);
        renameVt.run(canonical, alias);

        // profile_interests: per-row merge
        const aliasRows = findPiAlias.all(alias);
        for (const row of aliasRows) {
          const existing = findPiCanonical.get(row.profile_id, canonical, row.source);
          if (existing) {
            addWeightPi.run(row.weight, row.last_seen, existing.id);
            deletePiById.run(row.id);
          } else {
            renamePiById.run(canonical, row.id);
          }
        }

        // interest_tag_settings
        deleteTsDupe.run(alias, canonical);
        renameTs.run(canonical, alias);
      }

      db.prepare("INSERT INTO migrations (key) VALUES ('tag_normalization_v1')").run();
    })();

    // Count remaining unique tags
    const tagCount = db.prepare('SELECT COUNT(DISTINCT tag) as cnt FROM video_tags').get();
    const interestCount = db.prepare('SELECT COUNT(DISTINCT tag) as cnt FROM profile_interests').get();
    console.log(`Tag normalization complete: ${tagCount.cnt} unique video tags, ${interestCount.cnt} unique interest tags`);
  }

  // Migrate: add discovery_source to videos
  const hasDiscoverySource = db.prepare("SELECT 1 FROM pragma_table_info('videos') WHERE name='discovery_source'").get();
  if (!hasDiscoverySource) {
    db.exec("ALTER TABLE videos ADD COLUMN discovery_source TEXT DEFAULT 'subscription'");
    console.log('Videos table: added discovery_source column');
  }

  // Migrate: add raw_speech to search_queries
  const hasRawSpeech = db.prepare("SELECT 1 FROM pragma_table_info('search_queries') WHERE name='raw_speech'").get();
  if (!hasRawSpeech) {
    db.exec('ALTER TABLE search_queries ADD COLUMN raw_speech TEXT');
    console.log('Search queries table: added raw_speech column');
  }

  console.log('Database migrated successfully');
}

// --- Profile queries ---
function createProfile(name) {
  return getDb().prepare(
    'INSERT INTO profiles (name) VALUES (?) RETURNING *'
  ).get(name);
}

function getProfiles() {
  return getDb().prepare('SELECT * FROM profiles ORDER BY id').all();
}

function getProfile(id) {
  return getDb().prepare('SELECT * FROM profiles WHERE id = ?').get(id);
}

function updateProfileTokens(id, accessToken, refreshToken) {
  getDb().prepare(
    'UPDATE profiles SET google_access_token = ?, google_refresh_token = ? WHERE id = ?'
  ).run(accessToken, refreshToken, id);
}

// --- Channel queries ---
function upsertChannel(channel) {
  return getDb().prepare(`
    INSERT INTO channels (channel_id, profile_id, channel_name, thumbnail_url, whitelisted, last_synced)
    VALUES (@channel_id, @profile_id, @channel_name, @thumbnail_url, @whitelisted, CURRENT_TIMESTAMP)
    ON CONFLICT(channel_id, profile_id) DO UPDATE SET
      channel_name  = excluded.channel_name,
      thumbnail_url = excluded.thumbnail_url,
      last_synced   = CURRENT_TIMESTAMP
  `).run(channel);
}

function getChannelsForProfile(profileId) {
  return getDb().prepare(
    'SELECT * FROM channels WHERE profile_id = ? ORDER BY channel_name'
  ).all(profileId);
}

function getWhitelistedChannels(profileId) {
  return getDb().prepare(
    'SELECT * FROM channels WHERE profile_id = ? AND whitelisted = 1 ORDER BY channel_name'
  ).all(profileId);
}

function getAllChannels() {
  return getDb().prepare('SELECT * FROM channels ORDER BY channel_name').all();
}

function updateChannelEnrichment(channelId, data) {
  getDb().prepare(`
    UPDATE channels SET
      description      = ?,
      subscriber_count = ?,
      custom_url       = ?
    WHERE channel_id = ?
  `).run(data.description || null, data.subscriber_count || null, data.custom_url || null, channelId);
}

function updateChannelWhitelist(channelId, profileId, whitelisted) {
  getDb().prepare(
    'UPDATE channels SET whitelisted = ? WHERE channel_id = ? AND profile_id = ?'
  ).run(whitelisted ? 1 : 0, channelId, profileId);
}

// --- Video queries ---
function videoExists(videoId) {
  return !!getDb().prepare('SELECT 1 FROM videos WHERE video_id = ?').get(videoId);
}

function insertVideo(video) {
  if (!video.discovery_source) video.discovery_source = 'subscription';
  getDb().prepare(`
    INSERT INTO videos
      (video_id, channel_id, channel_name, channel_thumbnail, title, description,
       thumbnail_url, transcript, duration_seconds, published_at,
       status, is_recommended, source_video_id, view_count, needs_llm_review, discovery_source)
    VALUES
      (@video_id, @channel_id, @channel_name, @channel_thumbnail, @title, @description,
       @thumbnail_url, @transcript, @duration_seconds, @published_at,
       @status, @is_recommended, @source_video_id, @view_count, @needs_llm_review, @discovery_source)
    ON CONFLICT(video_id) DO UPDATE SET
      title            = COALESCE(excluded.title, title),
      description      = COALESCE(excluded.description, description),
      thumbnail_url    = COALESCE(excluded.thumbnail_url, thumbnail_url),
      transcript       = COALESCE(excluded.transcript, transcript),
      duration_seconds = COALESCE(excluded.duration_seconds, duration_seconds),
      published_at     = COALESCE(excluded.published_at, published_at),
      channel_name     = COALESCE(excluded.channel_name, channel_name),
      channel_thumbnail = COALESCE(excluded.channel_thumbnail, channel_thumbnail),
      view_count       = COALESCE(excluded.view_count, view_count)
  `).run(video);
}

function updateVideoStatus(videoId, status, rejectionReason = null) {
  getDb().prepare(
    'UPDATE videos SET status = ?, rejection_reason = ?, processed_at = CURRENT_TIMESTAMP WHERE video_id = ?'
  ).run(status, rejectionReason, videoId);
}

function getApprovedFeed(profileId, page = 0, limit = 20, excludeIds = []) {
  const channels = getWhitelistedChannels(profileId);
  if (channels.length === 0) return [];

  const channelIds = channels.map(c => c.channel_id);
  const placeholders = channelIds.map(() => '?').join(',');
  const offset = page * limit;
  const excludePlaceholders = excludeIds.length ? excludeIds.map(() => '?').join(',') : null;

  return getDb().prepare(`
    WITH raw_interests AS (
      SELECT pi.tag,
        pi.weight * COALESCE(its.multiplier, its_cat.multiplier, 1.0)  AS scaled,
        COALESCE(its.hard_cap, its_cat.hard_cap, NULL)                 AS hard_cap,
        p.behavior_weight_ceiling                                       AS ceiling
      FROM profile_interests pi
      JOIN profiles p ON p.id = pi.profile_id
      LEFT JOIN tag_category_map tcm ON tcm.tag = pi.tag
      LEFT JOIN interest_tag_settings its
        ON its.profile_id = pi.profile_id AND its.tag = pi.tag
      LEFT JOIN interest_tag_settings its_cat
        ON its_cat.profile_id = pi.profile_id AND its_cat.tag = tcm.category
      WHERE pi.profile_id = ? AND pi.source = 'behavior'
    ),
    effective_interests AS (
      SELECT tag, scaled, hard_cap, ceiling,
        (SELECT MAX(scaled) FROM raw_interests) AS max_scaled
      FROM raw_interests
    ),
    eff_weights AS (
      SELECT tag,
        CASE WHEN max_scaled > 0
          THEN MIN((scaled / max_scaled) * ceiling,
                   COALESCE(hard_cap, ceiling))
          ELSE 0 END AS effective_weight
      FROM effective_interests
    ),
    zeroed_tags AS (
      SELECT its.tag FROM interest_tag_settings its
      WHERE its.profile_id = ? AND its.multiplier = 0
      UNION
      SELECT tcm.tag FROM tag_category_map tcm
      JOIN interest_tag_settings its ON its.profile_id = ? AND its.tag = tcm.category AND its.multiplier = 0
      LEFT JOIN interest_tag_settings ov ON ov.profile_id = ? AND ov.tag = tcm.tag
      WHERE ov.id IS NULL
    ),
    int_scores AS (
      SELECT vt.video_id,
        SUM(ew.effective_weight) AS interest_score
      FROM video_tags vt
      JOIN eff_weights ew ON vt.tag = ew.tag
      GROUP BY vt.video_id
    ),
    watch_comp AS (
      SELECT video_id,
        SUM(CASE WHEN duration_seconds > 0
              THEN MIN(CAST(progress_seconds AS REAL) / duration_seconds, 1.0)
              ELSE 0 END) AS total_completed
      FROM watch_history
      WHERE profile_id = ? AND watched_at > datetime('now', '-30 days')
      GROUP BY video_id
    )
    SELECT v.*, c.thumbnail_url AS channel_thumbnail_img
    FROM videos v
    LEFT JOIN (SELECT channel_id, thumbnail_url FROM channels GROUP BY channel_id) c
      ON v.channel_id = c.channel_id
    LEFT JOIN int_scores ON v.video_id = int_scores.video_id
    LEFT JOIN watch_comp ON v.video_id = watch_comp.video_id
    WHERE v.channel_id IN (${placeholders})
      AND v.status = 'approved'
      AND v.video_id NOT IN (
        SELECT value FROM filter_rules
        WHERE rule_type = 'video_block'
          AND (profile_id = ? OR profile_id IS NULL)
      )
      AND v.video_id NOT IN (
        SELECT video_id FROM video_tags WHERE tag IN (SELECT tag FROM zeroed_tags)
      )
      ${excludePlaceholders ? `AND v.video_id NOT IN (${excludePlaceholders})` : ''}
    ORDER BY
      (COALESCE(int_scores.interest_score, 0.5)
        + CASE WHEN v.processed_at > datetime('now', '-60 days') THEN 1.0 ELSE 0.0 END)
      * (1.0 / (1.0 + COALESCE(watch_comp.total_completed, 0) * 0.5))
      * (0.7 + 0.3 * (ABS(RANDOM()) / 9223372036854775807.0))
      DESC
    LIMIT ? OFFSET ?
  `).all([profileId, profileId, profileId, profileId, profileId, ...channelIds, profileId, ...excludeIds, limit, offset]);
}

function blockVideo(profileId, videoId) {
  getDb().prepare(
    `INSERT OR IGNORE INTO filter_rules (profile_id, rule_type, value, scope)
     VALUES (?, 'video_block', ?, 'profile')`
  ).run(profileId, videoId);
}

function removeFromHistory(profileId, videoId) {
  getDb().prepare(
    'DELETE FROM watch_history WHERE profile_id = ? AND video_id = ?'
  ).run(profileId, videoId);
}

function getApprovedVideosByChannel(channelId, page = 0, limit = 20) {
  const offset = page * limit;
  return getDb().prepare(`
    SELECT v.*, c.thumbnail_url as channel_thumbnail_img
    FROM videos v
    LEFT JOIN (SELECT channel_id, thumbnail_url FROM channels GROUP BY channel_id) c ON v.channel_id = c.channel_id
    WHERE v.channel_id = ? AND v.status = 'approved'
    ORDER BY v.published_at DESC
    LIMIT ? OFFSET ?
  `).all(channelId, limit, offset);
}

function getRelatedVideos(videoId) {
  // First try source-based relations
  const sourced = getDb().prepare(`
    SELECT v.*, c.thumbnail_url as channel_thumbnail_img
    FROM videos v
    LEFT JOIN (SELECT channel_id, thumbnail_url FROM channels GROUP BY channel_id) c ON v.channel_id = c.channel_id
    WHERE v.source_video_id = ? AND v.status = 'approved'
    ORDER BY v.published_at DESC
    LIMIT 15
  `).all(videoId);
  if (sourced.length > 0) return sourced;

  // Fall back: other approved videos from the same channel, randomized
  const row = getDb().prepare('SELECT channel_id FROM videos WHERE video_id = ?').get(videoId);
  if (!row) return [];
  return getDb().prepare(`
    SELECT v.*, c.thumbnail_url as channel_thumbnail_img
    FROM videos v
    LEFT JOIN (SELECT channel_id, thumbnail_url FROM channels GROUP BY channel_id) c ON v.channel_id = c.channel_id
    WHERE v.channel_id = ? AND v.video_id != ? AND v.status = 'approved'
    ORDER BY RANDOM()
    LIMIT 15
  `).all(row.channel_id, videoId);
}

function getVideoById(videoId) {
  return getDb().prepare(`
    SELECT v.*, c.thumbnail_url as channel_thumbnail_img, c.channel_name as channel_display_name
    FROM videos v
    LEFT JOIN (SELECT channel_id, thumbnail_url, channel_name FROM channels GROUP BY channel_id) c ON v.channel_id = c.channel_id
    WHERE v.video_id = ?
  `).get(videoId);
}

function getPendingVideos() {
  return getDb().prepare(
    "SELECT * FROM videos WHERE status = 'pending' ORDER BY published_at DESC"
  ).all();
}

function getRejectedVideos(limit = 50) {
  return getDb().prepare(`
    SELECT v.*, c.channel_name as ch_name
    FROM videos v
    LEFT JOIN (SELECT channel_id, channel_name FROM channels GROUP BY channel_id) c ON v.channel_id = c.channel_id
    WHERE v.status = 'rejected'
    ORDER BY v.processed_at DESC
    LIMIT ?
  `).all(limit);
}

function getVideoLibrary({ status = 'all', page = 0, limit = 25, search = '', profileId = null, rejectionFilter = 'all' } = {}) {
  const rawDb = getDb();
  const conditions = [];
  const params = [];

  if (profileId) {
    conditions.push('v.channel_id IN (SELECT channel_id FROM channels WHERE profile_id = ?)');
    params.push(profileId);
  }
  if (status !== 'all') {
    conditions.push('v.status = ?');
    params.push(status);
  }
  if (status === 'rejected' && rejectionFilter !== 'all') {
    if (rejectionFilter === 'shorts') {
      conditions.push("v.rejection_reason = 'YouTube Short'");
    } else if (rejectionFilter === 'live') {
      conditions.push("(v.rejection_reason = 'YouTube Live' OR v.rejection_reason LIKE 'Keyword: \"LIVE\"%')");
    } else if (rejectionFilter === 'keyword') {
      conditions.push("v.rejection_reason LIKE 'Keyword:%' AND v.rejection_reason NOT LIKE 'Keyword: \"LIVE\"%'");
    } else if (rejectionFilter === 'llm') {
      conditions.push("v.rejection_reason LIKE 'LLM:%'");
    } else if (rejectionFilter === 'manual') {
      conditions.push("v.rejection_reason LIKE 'Manual%'");
    }
  }
  if (search) {
    conditions.push('(v.title LIKE ? OR v.channel_name LIKE ?)');
    params.push(`%${search}%`, `%${search}%`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const { n: total } = rawDb.prepare(`SELECT COUNT(*) as n FROM videos v ${where}`).get(...params);

  const videos = rawDb.prepare(`
    SELECT v.video_id, v.title, v.channel_id, v.channel_name, v.thumbnail_url,
           v.duration_seconds, v.published_at, v.processed_at, v.status, v.rejection_reason,
           v.description,
           GROUP_CONCAT(vt.tag, ', ') as tags
    FROM videos v
    LEFT JOIN video_tags vt ON v.video_id = vt.video_id
    ${where}
    GROUP BY v.video_id
    ORDER BY v.published_at DESC
    LIMIT ? OFFSET ?
  `).all(...params, limit, page * limit);

  return { videos, total, page, pages: Math.ceil(total / limit) };
}

function getApprovedVideosForRelated(profileId, limit = 50) {
  const channels = getWhitelistedChannels(profileId);
  if (channels.length === 0) return [];
  const channelIds = channels.map(c => c.channel_id);
  const placeholders = channelIds.map(() => '?').join(',');

  return getDb().prepare(`
    SELECT video_id, channel_id, title
    FROM videos
    WHERE channel_id IN (${placeholders})
      AND status = 'approved'
      AND is_recommended = 0
    ORDER BY processed_at DESC
    LIMIT ?
  `).all([...channelIds, limit]);
}

// --- Watch history queries ---
function upsertWatchHistory(profileId, videoId, progressSeconds, durationSeconds) {
  getDb().prepare(`
    INSERT INTO watch_history (profile_id, video_id, progress_seconds, duration_seconds, watched_at)
    VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(profile_id, video_id) DO UPDATE SET
      progress_seconds = excluded.progress_seconds,
      duration_seconds = CASE WHEN excluded.duration_seconds > 0
                         THEN excluded.duration_seconds
                         ELSE duration_seconds END,
      watched_at       = CURRENT_TIMESTAMP
  `).run(profileId, videoId, progressSeconds, durationSeconds);
}

function getWatchHistory(profileId, limit = 50) {
  return getDb().prepare(`
    SELECT wh.video_id, wh.progress_seconds, wh.duration_seconds, wh.watched_at,
           v.title, v.thumbnail_url, v.channel_name, v.channel_id, v.channel_thumbnail
    FROM watch_history wh
    JOIN videos v ON wh.video_id = v.video_id
    WHERE wh.profile_id = ?
    ORDER BY wh.watched_at DESC
    LIMIT ?
  `).all(profileId, limit);
}

function getWatchHistoryMap(profileId, videoIds) {
  if (!videoIds || videoIds.length === 0) return {};
  const placeholders = videoIds.map(() => '?').join(',');
  const rows = getDb().prepare(`
    SELECT video_id, progress_seconds, duration_seconds
    FROM watch_history
    WHERE profile_id = ? AND video_id IN (${placeholders})
  `).all(profileId, ...videoIds);
  const map = {};
  for (const r of rows) map[r.video_id] = r;
  return map;
}

// --- Filter rule queries ---
function getFilterRules(profileId = null) {
  if (profileId !== null) {
    return getDb().prepare(
      'SELECT * FROM filter_rules WHERE profile_id IS NULL OR profile_id = ? ORDER BY created_at'
    ).all(profileId);
  }
  return getDb().prepare('SELECT * FROM filter_rules ORDER BY created_at').all();
}

function addFilterRule(rule) {
  return getDb().prepare(
    'INSERT INTO filter_rules (profile_id, rule_type, value, scope) VALUES (?, ?, ?, ?) RETURNING *'
  ).get(rule.profile_id || null, rule.rule_type, rule.value, rule.scope || 'all');
}

function deleteFilterRule(id) {
  getDb().prepare('DELETE FROM filter_rules WHERE id = ?').run(id);
}

// --- Cron run queries ---
function createCronRun() {
  return getDb().prepare(
    'INSERT INTO cron_runs (started_at) VALUES (CURRENT_TIMESTAMP) RETURNING id'
  ).get().id;
}

function finishCronRun(id, stats) {
  getDb().prepare(`
    UPDATE cron_runs SET
      finished_at     = CURRENT_TIMESTAMP,
      videos_found    = ?,
      videos_approved = ?,
      videos_rejected = ?,
      error_message   = ?
    WHERE id = ?
  `).run(stats.found, stats.approved, stats.rejected, stats.error || null, id);
}

function getLastCronRun() {
  return getDb().prepare(
    'SELECT * FROM cron_runs ORDER BY started_at DESC LIMIT 1'
  ).get();
}

function getStats() {
  const db = getDb();
  const last = getLastCronRun();
  const total = db.prepare("SELECT COUNT(*) as count FROM videos WHERE status = 'approved'").get();
  return {
    last_run: last?.finished_at || last?.started_at || null,
    last_approved: last?.videos_approved ?? null,
    last_rejected: last?.videos_rejected ?? null,
    total_videos: total?.count ?? 0
  };
}

// --- Video tags ---

function insertVideoTags(videoId, tags) {
  const normalized = normalizeTags(tags);
  const insert = getDb().prepare(
    `INSERT OR IGNORE INTO video_tags (video_id, tag) VALUES (?, ?)`
  );
  const insertMany = getDb().transaction((tags) => {
    for (const tag of tags) insert.run(videoId, tag);
  });
  insertMany(normalized);
}

function getVideoTags(videoId) {
  return getDb().prepare(
    `SELECT tag FROM video_tags WHERE video_id = ?`
  ).all(videoId).map(r => r.tag);
}

// --- Profile interests ---

function upsertProfileInterest(profileId, tag, delta, source = 'behavior') {
  const t = normalizeTag(tag);
  getDb().prepare(`
    INSERT INTO profile_interests (profile_id, tag, weight, source, last_seen)
    VALUES (?, ?, MAX(0.0, ?), ?, CURRENT_TIMESTAMP)
    ON CONFLICT(profile_id, tag, source) DO UPDATE SET
      weight    = MAX(0.0, weight + ?),
      last_seen = CURRENT_TIMESTAMP
  `).run(profileId, t, Math.max(0, delta), source, delta);
}

function setParentInterest(profileId, tag, weight) {
  const t = normalizeTag(tag);
  getDb().prepare(`
    INSERT INTO profile_interests (profile_id, tag, weight, source, last_seen)
    VALUES (?, ?, ?, 'parent', CURRENT_TIMESTAMP)
    ON CONFLICT(profile_id, tag, source) DO UPDATE SET
      weight    = ?,
      last_seen = CURRENT_TIMESTAMP
  `).run(profileId, t, weight, weight);
}

function deleteParentInterests(profileId) {
  getDb().prepare(
    `DELETE FROM profile_interests WHERE profile_id = ? AND source = 'parent'`
  ).run(profileId);
}

function applyDecayToProfile(profileId, today) {
  getDb().prepare(`
    UPDATE profile_interests
    SET weight = MAX(0.0, weight * 0.85)
    WHERE profile_id = ?
      AND source = 'behavior'
      AND DATE(last_seen) != ?
  `).run(profileId, today);
}

function profileHadSessionToday(profileId, today) {
  const row = getDb().prepare(`
    SELECT COUNT(*) as count FROM watch_history
    WHERE profile_id = ? AND DATE(watched_at) = ?
  `).get(profileId, today);
  return row.count > 0;
}

// --- Interest tag settings (parent-configured ceilings / multipliers) ---

function getProfileBehaviorCeiling(profileId) {
  const row = getDb().prepare(
    'SELECT behavior_weight_ceiling FROM profiles WHERE id = ?'
  ).get(profileId);
  return row ? row.behavior_weight_ceiling : 10.0;
}

function setProfileBehaviorCeiling(profileId, ceiling) {
  getDb().prepare(
    'UPDATE profiles SET behavior_weight_ceiling = ? WHERE id = ?'
  ).run(ceiling, profileId);
}

function getTagSettings(profileId) {
  const rows = getDb().prepare(
    'SELECT tag, multiplier, hard_cap FROM interest_tag_settings WHERE profile_id = ?'
  ).all(profileId);
  const map = {};
  for (const r of rows) map[r.tag] = { multiplier: r.multiplier, hard_cap: r.hard_cap };
  return map;
}

function upsertTagSetting(profileId, tag, multiplier, hardCap) {
  getDb().prepare(`
    INSERT INTO interest_tag_settings (profile_id, tag, multiplier, hard_cap, updated_at)
    VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(profile_id, tag) DO UPDATE SET
      multiplier = excluded.multiplier,
      hard_cap   = excluded.hard_cap,
      updated_at = CURRENT_TIMESTAMP
  `).run(profileId, tag, multiplier, hardCap ?? null);
}

function deleteTagSetting(profileId, tag) {
  getDb().prepare(
    'DELETE FROM interest_tag_settings WHERE profile_id = ? AND tag = ?'
  ).run(profileId, tag);
}

function getEffectiveInterests(profileId) {
  const ceiling  = getProfileBehaviorCeiling(profileId);
  const settings = getTagSettings(profileId);

  const rows = getDb().prepare(`
    SELECT tag, weight, source, last_seen
    FROM profile_interests
    WHERE profile_id = ?
    ORDER BY weight DESC
  `).all(profileId);

  // Resolve setting for a tag: tag-specific first, then category fallback
  const resolve = (tag) => settings[tag]
    || (TAG_TO_CATEGORY[tag] ? settings[TAG_TO_CATEGORY[tag]] : null);

  // Compute scaled weights for behavior tags first so we can normalize.
  // Include ALL tags in the baseline so that adding a cap to one tag
  // doesn't cause a normalization cliff that shifts every other tag.
  const behaviorScaled = [];
  for (const row of rows) {
    if (row.source !== 'behavior') continue;
    const s = resolve(row.tag);
    const multiplier = s?.multiplier ?? 1.0;
    behaviorScaled.push({ tag: row.tag, scaled: row.weight * multiplier });
  }
  const maxScaled = behaviorScaled.reduce((m, r) => Math.max(m, r.scaled), 0);

  return rows.map(row => {
    if (row.source !== 'behavior') {
      // Parent-set interests pass through unchanged
      return { ...row, effective_weight: row.weight };
    }
    const s = resolve(row.tag);
    const multiplier = s?.multiplier ?? 1.0;
    const hardCap    = s?.hard_cap ?? null;
    const scaled     = row.weight * multiplier;
    // Normalize so the top behavior tag always sits at the ceiling,
    // preserving relative ranking regardless of absolute accumulation.
    const normalized = maxScaled > 0 ? (scaled / maxScaled) * ceiling : 0;
    const effective  = hardCap !== null ? Math.min(normalized, hardCap) : normalized;
    return { ...row, effective_weight: effective };
  }).sort((a, b) => b.effective_weight - a.effective_weight);
}

// --- Profile insights ---

function insertProfileInsight(profileId, insight, source) {
  getDb().prepare(
    `INSERT INTO profile_insights (profile_id, insight, source) VALUES (?, ?, ?)`
  ).run(profileId, insight, source);
}

function getUnconsolidatedInsights(profileId) {
  return getDb().prepare(`
    SELECT insight, source, created_at
    FROM profile_insights
    WHERE profile_id = ? AND consolidated = 0
    ORDER BY created_at ASC
  `).all(profileId);
}

function markInsightsConsolidated(profileId) {
  getDb().prepare(
    `UPDATE profile_insights SET consolidated = 1 WHERE profile_id = ? AND consolidated = 0`
  ).run(profileId);
}

// --- Child profiles ---

function getChildProfile(profileId) {
  return getDb().prepare(
    `SELECT * FROM child_profiles WHERE profile_id = ?`
  ).get(profileId);
}

function saveChildProfile(profileId, markdown, updatedBy = 'parent') {
  getDb().prepare(`
    INSERT INTO child_profiles (profile_id, markdown, updated_at, updated_by)
    VALUES (?, ?, CURRENT_TIMESTAMP, ?)
    ON CONFLICT(profile_id) DO UPDATE SET
      markdown   = excluded.markdown,
      updated_at = CURRENT_TIMESTAMP,
      updated_by = excluded.updated_by
  `).run(profileId, markdown, updatedBy);
}

function getTagStatsByDay(profileId, dateStr) {
  return getDb().prepare(`
    SELECT vt.tag,
      COUNT(*) as total,
      SUM(CASE WHEN CAST(wh.progress_seconds AS REAL) / NULLIF(wh.duration_seconds, 0) >= 0.8 THEN 1 ELSE 0 END) as completed,
      AVG(CAST(wh.progress_seconds AS REAL) / NULLIF(wh.duration_seconds, 0)) as avg_completion
    FROM watch_history wh
    JOIN video_tags vt ON wh.video_id = vt.video_id
    WHERE wh.profile_id = ? AND DATE(wh.watched_at) = ?
    GROUP BY vt.tag
    ORDER BY total DESC
  `).all(profileId, dateStr);
}

const REACTION_DELTAS = {
  like:             +1.5,
  dislike:          -0.8,
  'not-interested': -1.0,
};

function applyReactionToInterests(profileId, videoId, reaction) {
  const delta = REACTION_DELTAS[reaction];
  if (delta == null) return;

  const tags = getVideoTags(videoId);
  for (const tag of tags) {
    upsertProfileInterest(profileId, tag, delta, 'behavior');
  }

  insertProfileInsight(
    profileId,
    `${reaction === 'like' ? 'Liked' : reaction === 'dislike' ? 'Disliked' : 'Not interested in'} video (${videoId})`,
    reaction
  );
}

function applyCompletionToInterests(profileId, videoId, progressSeconds, durationSeconds) {
  if (!durationSeconds || durationSeconds <= 0) return;

  const ratio = progressSeconds / durationSeconds;
  if (ratio < 0.8) return; // Only signal on 80%+ completion

  let delta;
  if      (durationSeconds > 300) delta = 1.0;  // > 5 min: strong signal
  else if (durationSeconds > 120) delta = 0.5;  // 2–5 min: medium signal
  else                            delta = 0.3;  // < 2 min: weak signal

  const tags = getVideoTags(videoId);
  for (const tag of tags) {
    upsertProfileInterest(profileId, tag, delta, 'behavior');
  }
}

// --- Channel recommendations ---

function upsertChannelRecommendation(channelId, profileId, recommendation, reason) {
  getDb().prepare(`
    INSERT INTO channel_recommendations (channel_id, profile_id, recommendation, reason, updated_at)
    VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(channel_id, profile_id) DO UPDATE SET
      recommendation = excluded.recommendation,
      reason         = excluded.reason,
      dismissed      = 0,
      applied        = 0,
      updated_at     = CURRENT_TIMESTAMP
  `).run(channelId, profileId, recommendation, reason);
}

function getChannelRecommendations(profileId) {
  // Only return actionable recs: ones where the recommendation differs from current state.
  // (enable + currently disabled) or (disable + currently enabled)
  return getDb().prepare(`
    SELECT cr.*, c.channel_name, c.thumbnail_url, c.subscriber_count, c.whitelisted, c.custom_url
    FROM channel_recommendations cr
    JOIN channels c ON cr.channel_id = c.channel_id AND cr.profile_id = c.profile_id
    WHERE cr.profile_id = ? AND cr.dismissed = 0 AND cr.applied = 0
      AND ((cr.recommendation = 'enable'  AND c.whitelisted = 0)
        OR (cr.recommendation = 'disable' AND c.whitelisted = 1))
    ORDER BY cr.updated_at DESC
  `).all(profileId);
}

// Returns ALL recs (including redundant ones) keyed by channel_id — used by channel list chips.
function getAllChannelRecommendations(profileId) {
  return getDb().prepare(`
    SELECT cr.channel_id, cr.recommendation, cr.reason, cr.dismissed, cr.applied
    FROM channel_recommendations cr
    WHERE cr.profile_id = ? AND cr.dismissed = 0 AND cr.applied = 0
  `).all(profileId);
}

function dismissChannelRecommendation(channelId, profileId) {
  getDb().prepare(`
    UPDATE channel_recommendations SET dismissed = 1, updated_at = CURRENT_TIMESTAMP
    WHERE channel_id = ? AND profile_id = ?
  `).run(channelId, profileId);
}

function applyChannelRecommendation(channelId, profileId) {
  const rec = getDb().prepare(
    'SELECT recommendation FROM channel_recommendations WHERE channel_id = ? AND profile_id = ?'
  ).get(channelId, profileId);
  if (!rec) return;

  const newWhitelisted = rec.recommendation === 'enable' ? 1 : 0;
  getDb().prepare('UPDATE channels SET whitelisted = ? WHERE channel_id = ? AND profile_id = ?')
    .run(newWhitelisted, channelId, profileId);
  getDb().prepare(`
    UPDATE channel_recommendations SET applied = 1, updated_at = CURRENT_TIMESTAMP
    WHERE channel_id = ? AND profile_id = ?
  `).run(channelId, profileId);
}

// --- Search queries ---

function saveSearchQuery(profileId, query, rawSpeech = null) {
  const rawDb = getDb();
  rawDb.prepare(`
    INSERT INTO search_queries (profile_id, query, raw_speech, searched_at)
    VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT(profile_id, query) DO UPDATE SET searched_at = datetime('now'), raw_speech = COALESCE(?, raw_speech)
  `).run(profileId, query, rawSpeech, rawSpeech);

  // Trim to 20 most recent
  rawDb.prepare(`
    DELETE FROM search_queries
    WHERE profile_id = ?
      AND id NOT IN (
        SELECT id FROM search_queries
        WHERE profile_id = ?
        ORDER BY searched_at DESC
        LIMIT 20
      )
  `).run(profileId, profileId);
}

function getSearchHistory(profileId) {
  return getDb().prepare(`
    SELECT query, raw_speech, searched_at FROM search_queries
    WHERE profile_id = ?
    ORDER BY searched_at DESC
    LIMIT 20
  `).all(profileId);
}

function getSearchHistoryQueries(profileId) {
  return getSearchHistory(profileId).map(r => r.query);
}

function deleteSearchQuery(profileId, query) {
  getDb().prepare(
    'DELETE FROM search_queries WHERE profile_id = ? AND query = ?'
  ).run(profileId, query);
}

function searchApprovedVideos(profileId, q) {
  const like = `%${q}%`;
  return getDb().prepare(`
    SELECT v.video_id, v.title, v.channel_id, v.channel_name, v.thumbnail_url,
           v.duration_seconds, v.published_at
    FROM videos v
    WHERE v.status = 'approved'
      AND v.channel_id IN (
        SELECT channel_id FROM channels WHERE profile_id = ? AND whitelisted = 1
      )
      AND (v.title LIKE ? OR v.channel_name LIKE ? OR v.description LIKE ?)
    ORDER BY
      CASE WHEN v.title LIKE ? THEN 0
           WHEN v.channel_name LIKE ? THEN 1
           ELSE 2 END,
      v.published_at DESC
    LIMIT 20
  `).all(profileId, like, like, like, like, like);
}

// Lightweight suggestions for as-you-type autocomplete.
// Returns up to 5 distinct video titles and 3 channel names matching the prefix.
function getSearchSuggestions(profileId, q) {
  const like = `${q}%`;
  const titleRows = getDb().prepare(`
    SELECT DISTINCT title as text, 'video' as type
    FROM videos
    WHERE status = 'approved'
      AND channel_id IN (SELECT channel_id FROM channels WHERE profile_id = ? AND whitelisted = 1)
      AND title LIKE ?
    ORDER BY published_at DESC
    LIMIT 5
  `).all(profileId, like);

  const channelRows = getDb().prepare(`
    SELECT DISTINCT channel_name as text, 'channel' as type
    FROM channels
    WHERE profile_id = ? AND whitelisted = 1 AND channel_name LIKE ?
    LIMIT 3
  `).all(profileId, like);

  return [...channelRows, ...titleRows];
}

// Bulk apply: if channelIds provided applies only those, otherwise applies all actionable pending recs.
function getApprovedVideoCountByChannel(channelIds) {
  if (!channelIds || channelIds.length === 0) return {};
  const placeholders = channelIds.map(() => '?').join(', ');
  const rows = getDb().prepare(`
    SELECT channel_id, COUNT(*) as n
    FROM videos
    WHERE channel_id IN (${placeholders}) AND status = 'approved'
    GROUP BY channel_id
  `).all(...channelIds);
  const map = {};
  for (const row of rows) map[row.channel_id] = row.n;
  return map;
}

function bulkApplyChannelRecommendations(profileId, channelIds = null) {
  const rawDb = getDb();

  let recs;
  if (channelIds && channelIds.length > 0) {
    const placeholders = channelIds.map(() => '?').join(',');
    recs = rawDb.prepare(`
      SELECT cr.channel_id, cr.recommendation
      FROM channel_recommendations cr
      JOIN channels c ON cr.channel_id = c.channel_id AND cr.profile_id = c.profile_id
      WHERE cr.profile_id = ? AND cr.dismissed = 0 AND cr.applied = 0
        AND cr.channel_id IN (${placeholders})
    `).all(profileId, ...channelIds);
  } else {
    // All actionable (rec ≠ current state)
    recs = rawDb.prepare(`
      SELECT cr.channel_id, cr.recommendation
      FROM channel_recommendations cr
      JOIN channels c ON cr.channel_id = c.channel_id AND cr.profile_id = c.profile_id
      WHERE cr.profile_id = ? AND cr.dismissed = 0 AND cr.applied = 0
        AND ((cr.recommendation = 'enable'  AND c.whitelisted = 0)
          OR (cr.recommendation = 'disable' AND c.whitelisted = 1))
    `).all(profileId);
  }

  if (recs.length === 0) return 0;

  const updateChannel = rawDb.prepare(
    'UPDATE channels SET whitelisted = ? WHERE channel_id = ? AND profile_id = ?'
  );
  const markApplied = rawDb.prepare(
    'UPDATE channel_recommendations SET applied = 1, updated_at = CURRENT_TIMESTAMP WHERE channel_id = ? AND profile_id = ?'
  );

  rawDb.transaction(() => {
    for (const rec of recs) {
      updateChannel.run(rec.recommendation === 'enable' ? 1 : 0, rec.channel_id, profileId);
      markApplied.run(rec.channel_id, profileId);
    }
  })();

  return recs.length;
}

// --- Insights analytics ---

function getInsightsAnalytics(profileId, days = 30, opts = {}) {
  const db = getDb();

  const watchTimeByDay = db.prepare(`
    SELECT DATE(wh.watched_at) AS date,
      ROUND(SUM(wh.progress_seconds) / 60.0, 1) AS minutes
    FROM watch_history wh
    WHERE wh.profile_id = ? AND wh.watched_at > datetime('now', '-' || ? || ' days')
    GROUP BY DATE(wh.watched_at)
    ORDER BY date
  `).all(profileId, days);

  const tzOffset = opts?.tzOffset ?? 0; // minutes, e.g. -300 for CDT
  const tzOffsetHours = tzOffset / 60; // e.g. -5 for CDT
  const tzModifier = `${tzOffset >= 0 ? '+' : '-'}${Math.abs(tzOffsetHours)} hours`;

  const watchTimeByHour = db.prepare(`
    SELECT CAST(strftime('%H', wh.watched_at, '${tzModifier}') AS INTEGER) AS hour,
      ROUND(SUM(wh.progress_seconds) / 60.0, 1) AS minutes
    FROM watch_history wh
    WHERE wh.profile_id = ? AND wh.watched_at > datetime('now', '-' || ? || ' days')
    GROUP BY hour
    ORDER BY hour
  `).all(profileId, days);

  const topTags = db.prepare(`
    SELECT vt.tag,
      COUNT(DISTINCT wh.video_id) AS watchCount,
      ROUND(SUM(wh.progress_seconds) / 60.0, 1) AS totalMinutes
    FROM watch_history wh
    JOIN video_tags vt ON vt.video_id = wh.video_id
    WHERE wh.profile_id = ? AND wh.watched_at > datetime('now', '-' || ? || ' days')
    GROUP BY vt.tag
    ORDER BY totalMinutes DESC
    LIMIT 20
  `).all(profileId, days);

  // Trending: compare last 7 days vs prior 7 days
  const trendingTags = db.prepare(`
    WITH recent AS (
      SELECT vt.tag, COUNT(DISTINCT wh.video_id) AS cnt
      FROM watch_history wh
      JOIN video_tags vt ON vt.video_id = wh.video_id
      WHERE wh.profile_id = ? AND wh.watched_at > datetime('now', '-7 days')
      GROUP BY vt.tag
    ),
    prior AS (
      SELECT vt.tag, COUNT(DISTINCT wh.video_id) AS cnt
      FROM watch_history wh
      JOIN video_tags vt ON vt.video_id = wh.video_id
      WHERE wh.profile_id = ?
        AND wh.watched_at > datetime('now', '-14 days')
        AND wh.watched_at <= datetime('now', '-7 days')
      GROUP BY vt.tag
    )
    SELECT COALESCE(r.tag, p.tag) AS tag,
      COALESCE(r.cnt, 0) AS recentCount,
      COALESCE(p.cnt, 0) AS priorCount,
      CASE WHEN COALESCE(p.cnt, 0) = 0 THEN COALESCE(r.cnt, 0) * 2.0
           ELSE ROUND(CAST(COALESCE(r.cnt, 0) AS REAL) / p.cnt, 2) END AS trend
    FROM recent r
    FULL OUTER JOIN prior p ON r.tag = p.tag
    WHERE COALESCE(r.cnt, 0) > 0
    ORDER BY trend DESC
    LIMIT 15
  `).all(profileId, profileId);

  const totals = db.prepare(`
    SELECT
      ROUND(SUM(progress_seconds) / 60.0, 1) AS totalWatchMinutes,
      COUNT(DISTINCT video_id) AS totalVideosWatched
    FROM watch_history
    WHERE profile_id = ? AND watched_at > datetime('now', '-' || ? || ' days')
  `).get(profileId, days);

  return {
    watchTimeByDay,
    watchTimeByHour,
    topTags,
    trendingTags,
    totalWatchMinutes: totals?.totalWatchMinutes || 0,
    totalVideosWatched: totals?.totalVideosWatched || 0,
  };
}

// --- Feed preview (stateless, with weight overrides) ---

function getFeedPreview(profileId, overrides = {}, ceilingOverride = null) {
  const db = getDb();
  const channels = getWhitelistedChannels(profileId);
  if (channels.length === 0) return [];

  const channelIds = channels.map(c => c.channel_id);
  const placeholders = channelIds.map(() => '?').join(',');

  // Build effective weights in JS with overrides applied
  const ceiling = ceilingOverride ?? getProfileBehaviorCeiling(profileId);
  const persistedSettings = getTagSettings(profileId);

  const behaviorInterests = db.prepare(`
    SELECT tag, weight FROM profile_interests
    WHERE profile_id = ? AND source = 'behavior'
  `).all(profileId);

  // Resolve persisted setting: tag-specific first, then category fallback
  const resolvePersisted = (tag) => persistedSettings[tag]
    || (TAG_TO_CATEGORY[tag] ? persistedSettings[TAG_TO_CATEGORY[tag]] : null);

  // Resolve override: tag-specific first, then category fallback
  const resolveOverride = (tag) => overrides[tag]
    || (TAG_TO_CATEGORY[tag] ? overrides[TAG_TO_CATEGORY[tag]] : null);

  // Compute scaled weights with overrides
  const scaledWeights = {};
  for (const row of behaviorInterests) {
    const override = resolveOverride(row.tag);
    const persisted = resolvePersisted(row.tag);
    const multiplier = override?.multiplier ?? persisted?.multiplier ?? 1.0;
    const scaled = row.weight * multiplier;
    scaledWeights[row.tag] = { scaled, hard_cap: override?.hard_cap ?? persisted?.hard_cap ?? null };
  }
  // Normalization baseline: include ALL tags so capping one tag
  // doesn't cause a cliff that shifts every other tag.
  const maxScaled = Object.values(scaledWeights)
    .reduce((m, s) => Math.max(m, s.scaled), 0);

  // Normalize to effective weights
  const effectiveWeights = {};
  for (const [tag, { scaled, hard_cap }] of Object.entries(scaledWeights)) {
    const normalized = maxScaled > 0 ? (scaled / maxScaled) * ceiling : 0;
    effectiveWeights[tag] = hard_cap !== null ? Math.min(normalized, hard_cap) : normalized;
  }

  // Build zeroed tag set from combined overrides + persisted (with category fallback)
  const zeroedTags = new Set();
  for (const row of behaviorInterests) {
    const resolved = resolvePersisted(row.tag);
    const ov = resolveOverride(row.tag);
    const mult = ov?.multiplier ?? resolved?.multiplier ?? 1.0;
    if (mult === 0) zeroedTags.add(row.tag);
  }

  // Get all approved videos from whitelisted channels
  const videos = db.prepare(`
    SELECT v.video_id, v.title, v.thumbnail_url, v.channel_name, v.channel_id, v.processed_at,
      c.thumbnail_url AS channel_thumbnail_img
    FROM videos v
    LEFT JOIN (SELECT channel_id, thumbnail_url FROM channels GROUP BY channel_id) c
      ON v.channel_id = c.channel_id
    WHERE v.channel_id IN (${placeholders})
      AND v.status = 'approved'
      AND v.video_id NOT IN (
        SELECT value FROM filter_rules
        WHERE rule_type = 'video_block'
          AND (profile_id = ? OR profile_id IS NULL)
      )
  `).all([...channelIds, profileId]);

  // Get watch completion data
  const watchMap = {};
  const watchRows = db.prepare(`
    SELECT video_id,
      SUM(CASE WHEN duration_seconds > 0
            THEN MIN(CAST(progress_seconds AS REAL) / duration_seconds, 1.0)
            ELSE 0 END) AS total_completed
    FROM watch_history
    WHERE profile_id = ? AND watched_at > datetime('now', '-30 days')
    GROUP BY video_id
  `).all(profileId);
  for (const r of watchRows) watchMap[r.video_id] = r.total_completed;

  // Get all video tags in bulk
  const allTags = db.prepare(`
    SELECT video_id, tag FROM video_tags
    WHERE video_id IN (${videos.map(() => '?').join(',')})
  `).all(videos.map(v => v.video_id));

  const tagsByVideo = {};
  for (const row of allTags) {
    if (!tagsByVideo[row.video_id]) tagsByVideo[row.video_id] = [];
    tagsByVideo[row.video_id].push(row.tag);
  }

  // Score each video
  const scored = [];
  for (const v of videos) {
    const tags = tagsByVideo[v.video_id] || [];

    // Hard exclude: skip if any tag is zeroed
    if (tags.some(t => zeroedTags.has(t))) continue;

    const matchedTags = tags.filter(t => effectiveWeights[t]);
    const interestScore = matchedTags.reduce((sum, t) => sum + (effectiveWeights[t] || 0), 0);

    const recencyBoost = v.processed_at && new Date(v.processed_at) > new Date(Date.now() - 60 * 24 * 60 * 60 * 1000) ? 1.0 : 0.0;
    const watchPenalty = 1.0 / (1.0 + (watchMap[v.video_id] || 0) * 0.5);
    // Fixed randomness factor for stable preview (0.85)
    const score = (Math.max(interestScore, 0.5) + recencyBoost) * watchPenalty * 0.85;

    scored.push({
      video_id: v.video_id,
      title: v.title,
      thumbnail_url: v.thumbnail_url,
      channel_name: v.channel_name,
      channel_thumbnail_img: v.channel_thumbnail_img,
      score: Math.round(score * 100) / 100,
      interestScore: Math.round(interestScore * 100) / 100,
      matchedTags,
    });
  }

  // Sort by score descending, apply channel diversity (max 2 per channel)
  scored.sort((a, b) => b.score - a.score);
  const result = [];
  const channelCounts = {};
  for (const v of scored) {
    const chKey = v.channel_name || v.video_id;
    channelCounts[chKey] = (channelCounts[chKey] || 0) + 1;
    if (channelCounts[chKey] <= 2) {
      result.push(v);
      if (result.length >= 18) break;
    }
  }

  return result;
}

module.exports = {
  getDb,
  migrate,
  createProfile,
  getProfiles,
  getProfile,
  updateProfileTokens,
  upsertChannel,
  getChannelsForProfile,
  getWhitelistedChannels,
  getAllChannels,
  updateChannelEnrichment,
  updateChannelWhitelist,
  videoExists,
  insertVideo,
  updateVideoStatus,
  getApprovedFeed,
  getApprovedVideosByChannel,
  getRelatedVideos,
  getVideoById,
  getPendingVideos,
  getRejectedVideos,
  getVideoLibrary,
  getApprovedVideosForRelated,
  upsertWatchHistory,
  getWatchHistory,
  blockVideo,
  removeFromHistory,
  getWatchHistoryMap,
  getFilterRules,
  addFilterRule,
  deleteFilterRule,
  createCronRun,
  finishCronRun,
  getLastCronRun,
  getStats,
  insertVideoTags,
  getVideoTags,
  upsertProfileInterest,
  setParentInterest,
  deleteParentInterests,
  applyDecayToProfile,
  profileHadSessionToday,
  insertProfileInsight,
  getUnconsolidatedInsights,
  markInsightsConsolidated,
  getChildProfile,
  saveChildProfile,
  getTagStatsByDay,
  applyReactionToInterests,
  applyCompletionToInterests,
  getProfileBehaviorCeiling,
  setProfileBehaviorCeiling,
  getTagSettings,
  upsertTagSetting,
  deleteTagSetting,
  getEffectiveInterests,
  getInsightsAnalytics,
  getFeedPreview,
  upsertChannelRecommendation,
  getChannelRecommendations,
  getAllChannelRecommendations,
  dismissChannelRecommendation,
  applyChannelRecommendation,
  bulkApplyChannelRecommendations,
  getApprovedVideoCountByChannel,
  saveSearchQuery,
  getSearchHistory,
  getSearchHistoryQueries,
  deleteSearchQuery,
  searchApprovedVideos,
  getSearchSuggestions,
};
