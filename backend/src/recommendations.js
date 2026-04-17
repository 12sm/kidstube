'use strict';

/**
 * Returns recommended videos for a given video and profile.
 *
 * Scoring factors:
 *  - Profile effective interest weights (normalized, with per-tag multipliers/caps applied)
 *  - Tag overlap with current video (soft nudge only — 0.15/tag to avoid rabbit holes)
 *  - Same-channel bonus
 *  - Watch completion history bonus
 *  - Strong randomness factor so the list varies each load
 *
 * Post-query: max 2 videos per channel to enforce topic diversity.
 *
 * @param {object} db        - db module (passed in for testability)
 * @param {string} videoId   - current video being watched
 * @param {number} profileId - profile to personalise for
 * @param {number} limit     - max results (default 15)
 * @returns {Array} video rows
 */
function getRecommendedVideos(db, videoId, profileId, limit = 15) {
  const rawDb = db.getDb();

  const current = rawDb.prepare(
    `SELECT channel_id FROM videos WHERE video_id = ?`
  ).get(videoId);
  const channelId = current?.channel_id || '';

  const hasInterests = rawDb.prepare(
    `SELECT 1 FROM profile_interests WHERE profile_id = ? LIMIT 1`
  ).get(profileId);

  const POOL = limit * 3; // fetch a larger pool so the channel cap has room to work

  let raw;

  if (!hasInterests) {
    // No interest data yet — tag overlap with current video + recency + randomness
    raw = rawDb.prepare(`
      WITH curr_tags AS (
        SELECT tag FROM video_tags WHERE video_id = ?
      ),
      tag_ov AS (
        SELECT vt.video_id, COUNT(*) * 0.15 AS overlap
        FROM video_tags vt
        JOIN curr_tags ct ON vt.tag = ct.tag
        GROUP BY vt.video_id
      ),
      watch_comp AS (
        SELECT video_id,
          SUM(CASE WHEN duration_seconds > 0
                THEN MIN(CAST(progress_seconds AS REAL) / duration_seconds, 1.0)
                ELSE 0 END) AS total_completed
        FROM watch_history WHERE profile_id = ? GROUP BY video_id
      )
      SELECT v.*, c.thumbnail_url AS channel_thumbnail_img
      FROM videos v
      LEFT JOIN (SELECT channel_id, thumbnail_url FROM channels GROUP BY channel_id) c
        ON v.channel_id = c.channel_id
      LEFT JOIN tag_ov ON v.video_id = tag_ov.video_id
      LEFT JOIN watch_comp wc ON v.video_id = wc.video_id
      WHERE v.status = 'approved'
        AND v.video_id != ?
        AND v.video_id NOT IN (
          SELECT value FROM filter_rules
          WHERE rule_type = 'video_block'
            AND (profile_id = ? OR profile_id IS NULL)
        )
      ORDER BY
        (1.0 + COALESCE(tag_ov.overlap, 0)
             + CASE WHEN v.channel_id = ? THEN 1.0 ELSE 0.0 END)
        * CASE WHEN v.processed_at > datetime('now', '-60 days') THEN 1.3 ELSE 1.0 END
        * (1.0 + COALESCE(wc.total_completed, 0) * 0.35)
        * (ABS(RANDOM()) / 9223372036854775807.0) DESC
      LIMIT ?
    `).all(videoId, profileId, videoId, profileId, channelId, POOL);
  } else {
    // Has interest data: use effective weights (normalized with per-tag multipliers/caps)
    // so that the interest cap system applies here too.
    raw = rawDb.prepare(`
      WITH effective_interests AS (
        SELECT pi.tag,
          pi.weight * COALESCE(its.multiplier, 1.0)                AS scaled,
          COALESCE(its.hard_cap, NULL)                              AS hard_cap,
          p.behavior_weight_ceiling                                 AS ceiling,
          MAX(pi.weight * COALESCE(its.multiplier, 1.0)) OVER ()   AS max_scaled
        FROM profile_interests pi
        JOIN profiles p ON p.id = pi.profile_id
        LEFT JOIN interest_tag_settings its
          ON its.profile_id = pi.profile_id AND its.tag = pi.tag
        WHERE pi.profile_id = ? AND pi.source = 'behavior'
      ),
      eff_weights AS (
        SELECT tag,
          CASE WHEN max_scaled > 0
            THEN MIN((scaled / max_scaled) * ceiling,
                     COALESCE(hard_cap, ceiling))
            ELSE 0 END AS effective_weight
        FROM effective_interests
      ),
      curr_tags AS (
        SELECT tag FROM video_tags WHERE video_id = ?
      ),
      int_scores AS (
        SELECT vt.video_id, MIN(SUM(ew.effective_weight), 4.0) AS interest_score
        FROM video_tags vt
        JOIN eff_weights ew ON vt.tag = ew.tag
        GROUP BY vt.video_id
      ),
      tag_ov AS (
        SELECT vt.video_id, COUNT(*) * 0.15 AS overlap
        FROM video_tags vt
        JOIN curr_tags ct ON vt.tag = ct.tag
        GROUP BY vt.video_id
      ),
      watch_comp AS (
        SELECT video_id,
          SUM(CASE WHEN duration_seconds > 0
                THEN MIN(CAST(progress_seconds AS REAL) / duration_seconds, 1.0)
                ELSE 0 END) AS total_completed
        FROM watch_history WHERE profile_id = ? GROUP BY video_id
      )
      SELECT v.*, c.thumbnail_url AS channel_thumbnail_img,
        (
          COALESCE(int_scores.interest_score, 0)
          + COALESCE(tag_ov.overlap, 0)
          + CASE WHEN v.channel_id = ? THEN 1.0 ELSE 0.0 END
        )
        * (1.0 + COALESCE(watch_comp.total_completed, 0) * 0.35)
        * (0.15 + 0.85 * (ABS(RANDOM()) / 9223372036854775807.0)) AS score
      FROM videos v
      LEFT JOIN (SELECT channel_id, thumbnail_url FROM channels GROUP BY channel_id) c
        ON v.channel_id = c.channel_id
      LEFT JOIN int_scores ON v.video_id = int_scores.video_id
      LEFT JOIN tag_ov ON v.video_id = tag_ov.video_id
      LEFT JOIN watch_comp ON v.video_id = watch_comp.video_id
      WHERE v.status = 'approved'
        AND v.video_id != ?
        AND v.video_id NOT IN (
          SELECT value FROM filter_rules
          WHERE rule_type = 'video_block'
            AND (profile_id = ? OR profile_id IS NULL)
        )
      ORDER BY score DESC
      LIMIT ?
    `).all(profileId, videoId, profileId, channelId, videoId, profileId, POOL);
  }

  // Cap at 2 videos per channel so no single channel can dominate the panel
  const channelCount = new Map();
  const capped = [];
  for (const v of raw) {
    const n = channelCount.get(v.channel_id) || 0;
    if (n < 2) {
      capped.push(v);
      channelCount.set(v.channel_id, n + 1);
    }
    if (capped.length >= limit) break;
  }
  return capped;
}

module.exports = { getRecommendedVideos };
