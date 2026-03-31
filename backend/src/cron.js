const cron = require('node-cron');
const db = require('./db');
const youtube = require('./youtube');
const rss = require('./rss');
const ytdlp = require('./ytdlp');
const filter = require('./filter');

let isRunning = false;

async function runNightlyJob() {
  if (isRunning) {
    console.log('Cron job already running, skipping');
    return { error: 'Already running' };
  }

  isRunning = true;
  const runId = db.createCronRun();
  const stats = { found: 0, approved: 0, rejected: 0, error: null };

  console.log(`[Cron] Starting nightly job (run #${runId})`);

  try {
    const profiles = db.getProfiles();

    for (const profile of profiles) {
      console.log(`[Cron] Processing profile: ${profile.name} (id=${profile.id})`);

      // Step 1: Sync subscriptions via OAuth (weekly, only if account connected)
      try {
        await syncSubscriptions(profile);
      } catch (err) {
        console.error(`[Cron] Subscription sync failed for ${profile.name}:`, err.message);
      }

      // Step 2: Get whitelisted channels
      const channels = db.getWhitelistedChannels(profile.id);
      console.log(`[Cron] Found ${channels.length} whitelisted channels`);

      // Step 3: Poll RSS for new videos
      const newVideos = await rss.getAllNewVideos(channels, db);
      console.log(`[Cron] RSS found ${newVideos.length} new videos`);
      stats.found += newVideos.length;

      // Step 4: Process each new video
      const filterRules = db.getFilterRules(profile.id);

      for (const video of newVideos) {
        await processVideo(video, filterRules, stats, false, null);
      }

      // Step 5: Fetch related videos for newly approved videos (Phase 2 enhancement)
      // Get recently approved videos that don't have related content yet
      const approvedForRelated = db.getApprovedVideosForRelated(profile.id, 20);
      console.log(`[Cron] Fetching related content for ${approvedForRelated.length} approved videos`);

      for (const approvedVideo of approvedForRelated) {
        try {
          const relatedVideos = await youtube.getChannelRecentVideos(approvedVideo.channel_id, 10);
          for (const related of relatedVideos) {
            if (db.videoExists(related.video_id)) continue;
            // Attach source info
            related.is_recommended = true;
            related.source_video_id = approvedVideo.video_id;
            await processVideo(related, filterRules, stats, true, approvedVideo.video_id);
          }
        } catch (err) {
          console.error(`[Cron] Related fetch failed for ${approvedVideo.video_id}:`, err.message);
        }
        await new Promise(r => setTimeout(r, 300));
      }
    }

    db.finishCronRun(runId, stats);
    console.log(`[Cron] Job complete: found=${stats.found} approved=${stats.approved} rejected=${stats.rejected}`);
    return { success: true, stats };

  } catch (err) {
    stats.error = err.message;
    db.finishCronRun(runId, stats);
    console.error('[Cron] Fatal error:', err);
    return { success: false, error: err.message };
  } finally {
    isRunning = false;
  }
}

async function processVideo(videoData, filterRules, stats, isRecommended, sourceVideoId) {
  const videoId = videoData.video_id;

  // Insert as pending before fetching full data
  db.insertVideo({
    video_id: videoId,
    channel_id: videoData.channel_id || null,
    channel_name: videoData.channel_name || null,
    channel_thumbnail: videoData.channel_thumbnail || null,
    title: videoData.title || null,
    description: videoData.description || null,
    thumbnail_url: videoData.thumbnail_url || null,
    transcript: null,
    duration_seconds: videoData.duration_seconds || null,
    published_at: videoData.published_at || null,
    view_count: videoData.view_count || null,
    status: 'pending',
    is_recommended: isRecommended ? 1 : 0,
    source_video_id: sourceVideoId || null
  });

  // Pass 1: Quick keyword filter on existing metadata
  const quickFilterResult = filter.runFilterPass(videoData, filterRules);
  if (quickFilterResult.rejected) {
    db.updateVideoStatus(videoId, 'rejected', quickFilterResult.reason);
    stats.rejected++;
    return;
  }

  // Pass 0a: Shorts detection on RSS metadata
  if (filter.isShort(videoData)) {
    db.updateVideoStatus(videoId, 'rejected', 'YouTube Short');
    stats.rejected++;
    return;
  }

  // Fetch full data via yt-dlp (metadata + transcript)
  let fullData = null;
  try {
    fullData = await ytdlp.fetchVideoData(videoId);
  } catch (err) {
    console.warn(`[Cron] yt-dlp failed for ${videoId}, using RSS data:`, err.message);
  }

  // Merge yt-dlp data with RSS data
  const enrichedVideo = {
    ...videoData,
    ...(fullData || {}),
    video_id: videoId
  };

  // Update DB with enriched yt-dlp data (upsert, preserves existing status=pending)
  if (fullData) {
    db.getDb().prepare(`
      UPDATE videos SET
        title            = COALESCE(?, title),
        description      = COALESCE(?, description),
        thumbnail_url    = COALESCE(?, thumbnail_url),
        transcript       = COALESCE(?, transcript),
        duration_seconds = COALESCE(?, duration_seconds),
        published_at     = COALESCE(?, published_at),
        channel_name     = COALESCE(?, channel_name),
        view_count       = COALESCE(?, view_count)
      WHERE video_id = ?
    `).run(
      fullData.title || null,
      fullData.description || null,
      fullData.thumbnail_url || null,
      fullData.transcript || null,
      fullData.duration_seconds || null,
      fullData.published_at || null,
      fullData.channel_name || null,
      fullData.view_count || null,
      videoId
    );
  }

  // Pass 0b: Shorts detection on full yt-dlp data (aspect ratio, is_short flag)
  if (fullData && filter.isShort(fullData)) {
    db.updateVideoStatus(videoId, 'rejected', 'YouTube Short');
    stats.rejected++;
    return;
  }

  // Pass 1 again with full data (transcript etc.)
  const fullFilterResult = filter.runFilterPass(enrichedVideo, filterRules);
  if (fullFilterResult.rejected) {
    db.updateVideoStatus(videoId, 'rejected', fullFilterResult.reason);
    stats.rejected++;
    return;
  }

  // All passes cleared — approve
  db.updateVideoStatus(videoId, 'approved');
  stats.approved++;
}

async function syncSubscriptions(profile) {
  // Only sync if we haven't synced recently (check last_synced on channels)
  const existingChannels = db.getChannelsForProfile(profile.id);
  const oneDayAgo = Date.now() - 7 * 24 * 60 * 60 * 1000; // weekly sync

  if (existingChannels.length > 0) {
    const lastSync = existingChannels[0].last_synced;
    if (lastSync && new Date(lastSync).getTime() > oneDayAgo) {
      console.log(`[Cron] Subscriptions recently synced for ${profile.name}, skipping`);
      return;
    }
  }

  console.log(`[Cron] Syncing subscriptions for ${profile.name}`);
  const subs = await youtube.getSubscriptions(profile.id);
  console.log(`[Cron] Got ${subs.length} subscriptions`);

  for (const sub of subs) {
    db.upsertChannel({
      channel_id: sub.channel_id,
      profile_id: profile.id,
      channel_name: sub.channel_name,
      thumbnail_url: sub.thumbnail_url,
      whitelisted: 0
    });
  }
}

function scheduleJob() {
  const schedule = process.env.CRON_SCHEDULE || '0 2 * * *';
  console.log(`Cron job scheduled: ${schedule}`);
  cron.schedule(schedule, () => {
    console.log('[Cron] Triggered by schedule');
    runNightlyJob().catch(err => console.error('[Cron] Unhandled error:', err));
  });
}

module.exports = { runNightlyJob, scheduleJob, syncSubscriptions };
