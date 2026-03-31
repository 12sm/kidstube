'use strict';

/**
 * Returns recommended videos for a given video and profile.
 * Scores approved videos by tag overlap with profile interests.
 * Falls back to recency order when the profile has no interest data.
 *
 * @param {object} db        - db module (passed in for testability)
 * @param {string} videoId   - current video being watched
 * @param {number} profileId - profile to personalise for
 * @param {number} limit     - max results (default 15)
 * @returns {Array} video rows with optional `score` field
 */
function getRecommendedVideos(db, videoId, profileId, limit = 15) {
  // Get current video's channel for same-channel bonus
  const current = db.getDb().prepare(
    `SELECT channel_id FROM videos WHERE video_id = ?`
  ).get(videoId);
  const channelId = current?.channel_id || '';

  // Check if this profile has any interest data at all
  const hasInterests = db.getDb().prepare(
    `SELECT 1 FROM profile_interests WHERE profile_id = ? LIMIT 1`
  ).get(profileId);

  if (!hasInterests) {
    return db.getDb().prepare(`
      SELECT v.*, c.thumbnail_url as channel_thumbnail_img
      FROM videos v
      LEFT JOIN (SELECT channel_id, thumbnail_url FROM channels GROUP BY channel_id) c
        ON v.channel_id = c.channel_id
      WHERE v.status = 'approved'
        AND v.video_id != ?
        AND v.video_id NOT IN (
          SELECT value FROM filter_rules
          WHERE rule_type = 'video_block'
            AND (profile_id = ? OR profile_id IS NULL)
        )
        AND v.video_id NOT IN (
          SELECT video_id FROM watch_history
          WHERE profile_id = ?
            AND CAST(progress_seconds AS REAL) / NULLIF(duration_seconds, 0) > 0.8
        )
      ORDER BY v.published_at DESC
      LIMIT ?
    `).all(videoId, profileId, profileId, limit);
  }

  return db.getDb().prepare(`
    SELECT v.*, c.thumbnail_url as channel_thumbnail_img,
      SUM(pi.weight) +
      CASE WHEN v.channel_id = ? THEN 0.3 ELSE 0.0 END AS score
    FROM videos v
    JOIN video_tags vt ON v.video_id = vt.video_id
    JOIN profile_interests pi ON vt.tag = pi.tag AND pi.profile_id = ?
    LEFT JOIN (SELECT channel_id, thumbnail_url FROM channels GROUP BY channel_id) c
      ON v.channel_id = c.channel_id
    WHERE v.status = 'approved'
      AND v.video_id != ?
      AND v.video_id NOT IN (
        SELECT value FROM filter_rules
        WHERE rule_type = 'video_block'
          AND (profile_id = ? OR profile_id IS NULL)
      )
      AND v.video_id NOT IN (
        SELECT video_id FROM watch_history
        WHERE profile_id = ?
          AND CAST(progress_seconds AS REAL) / NULLIF(duration_seconds, 0) > 0.8
      )
    GROUP BY v.video_id
    ORDER BY score DESC
    LIMIT ?
  `).all(channelId, profileId, videoId, profileId, profileId, limit);
}

module.exports = { getRecommendedVideos };
