const cron = require('node-cron');
const db = require('./db');
const youtube = require('./youtube');
const rss = require('./rss');
const ytdlp = require('./ytdlp');
const filter = require('./filter');
const { runLlmCheck } = require('./llm');
const { parseTopicCategories } = require('./youtube');
const { runDailyInsightsPass, runWeeklyConsolidationPass } = require('./insights');
const { scrapeWatchHistory } = require('./history-scraper');

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

  const llmState = { calls: 0, cap: 300 };

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

      // Step 1b: Discover new channels/videos from yesterday's watch history
      try {
        await discoverFromHistory(profile, stats, llmState);
      } catch (err) {
        console.error(`[Cron] History discovery failed for ${profile.name}:`, err.message);
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
        video._profileId = profile.id;
        await processVideo(video, filterRules, stats, false, null, llmState);
      }

      // Step 4b: Backfill brand-new channels via YouTube API
      // Channels with zero videos of any status have never been processed — pull their
      // 50 most recent uploads to seed the library. Capped at 30 channels per profile
      // per run so a single Manual Refresh doesn't become a multi-hour job.
      // videoExists() deduplicates so already-known videos are skipped.
      const rawDb = db.getDb();
      const channelIds = channels.map(c => c.channel_id);
      const ph = channelIds.map(() => '?').join(',');
      const existingRows = channelIds.length > 0
        ? rawDb.prepare(`SELECT channel_id FROM videos WHERE channel_id IN (${ph}) GROUP BY channel_id`).all(...channelIds)
        : [];
      const hasVideos = new Set(existingRows.map(r => r.channel_id));
      const newChannels = channels.filter(c => !hasVideos.has(c.channel_id)).slice(0, 100);
      if (newChannels.length > 0) {
        console.log(`[Cron] Backfilling ${newChannels.length} brand-new channels via YouTube API`);
        for (const channel of newChannels) {
          try {
            const bStats = await backfillChannel(channel, profile.id, llmState);
            if (bStats.approved > 0) {
              console.log(`[Cron] Backfill: ${bStats.approved} new videos from ${channel.channel_name}`);
            }
            stats.approved += bStats.approved;
            stats.rejected += bStats.rejected;
          } catch (err) {
            console.error(`[Cron] Backfill failed for ${channel.channel_name}:`, err.message);
          }
          await new Promise(r => setTimeout(r, 300));
        }
      }

      // Step 4c: Pull parent-curated enrichment topics into the library
      try {
        await sourceEnrichmentTopics(profile, stats);
      } catch (err) {
        console.error(`[Cron] Enrichment sourcing failed for ${profile.name}:`, err.message);
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
            related._profileId = profile.id;
            await processVideo(related, filterRules, stats, true, approvedVideo.video_id, llmState);
          }
        } catch (err) {
          console.error(`[Cron] Related fetch failed for ${approvedVideo.video_id}:`, err.message);
        }
        await new Promise(r => setTimeout(r, 300));
      }
    }

    // Step 6: LLM review of search-imported videos (needs_llm_review = 1)
    const pendingReview = db.getDb().prepare(`
      SELECT video_id, title, description, transcript, duration_seconds, channel_id
      FROM videos WHERE status = 'approved' AND needs_llm_review = 1
    `).all();

    if (pendingReview.length > 0) {
      console.log(`[Cron] LLM-reviewing ${pendingReview.length} search-imported videos`);
      for (const video of pendingReview) {
        try {
          const result = await runLlmCheck(video, { childProfile: null });
          if (result.approved) {
            if (result.tags && result.tags.length > 0) db.insertVideoTags(video.video_id, result.tags);
            db.getDb().prepare('UPDATE videos SET needs_llm_review = 0 WHERE video_id = ?').run(video.video_id);
          } else {
            db.updateVideoStatus(video.video_id, 'rejected', `LLM: ${result.reason || 'inappropriate content'}`);
            db.getDb().prepare('UPDATE videos SET needs_llm_review = 0 WHERE video_id = ?').run(video.video_id);
            stats.rejected++;
          }
        } catch (err) {
          console.error(`[Cron] LLM review failed for ${video.video_id}:`, err.message);
        }
        await new Promise(r => setTimeout(r, 1200));
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

async function processVideo(videoData, filterRules, stats, isRecommended, sourceVideoId, llmState) {
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
    source_video_id: sourceVideoId || null,
    needs_llm_review: 0
  });

  // Pass 0a: Shorts / live detection on RSS metadata
  if (filter.isShort(videoData)) {
    db.updateVideoStatus(videoId, 'rejected', 'YouTube Short');
    stats.rejected++;
    return;
  }
  if (filter.isLive(videoData)) {
    db.updateVideoStatus(videoId, 'rejected', 'YouTube Live');
    stats.rejected++;
    return;
  }

  // Pass 1: Quick keyword filter on existing metadata
  const quickFilterResult = filter.runFilterPass(videoData, filterRules);
  if (quickFilterResult.rejected) {
    db.updateVideoStatus(videoId, 'rejected', quickFilterResult.reason);
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

  // Pass 0b: Shorts / live detection on full yt-dlp data (aspect ratio, is_short, was_live flags)
  if (fullData && filter.isShort(fullData)) {
    db.updateVideoStatus(videoId, 'rejected', 'YouTube Short');
    stats.rejected++;
    return;
  }
  if (fullData && filter.isLive(fullData)) {
    db.updateVideoStatus(videoId, 'rejected', 'YouTube Live');
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

  // Pass 2: LLM appropriateness + tag extraction
  if (llmState && llmState.calls < llmState.cap) {
    llmState.calls++;

    // Load child profile if available (attached by runNightlyJob per profile)
    const childProfileRow = videoData._profileId ? db.getChildProfile(videoData._profileId) : null;
    const childProfile = childProfileRow?.markdown || null;

    // Parse YouTube topicCategories if present
    const topicCategories = parseTopicCategories(enrichedVideo.topicCategories || []);
    const creatorTags = Array.isArray(enrichedVideo.tags) ? enrichedVideo.tags : [];

    const llmResult = await runLlmCheck(enrichedVideo, { childProfile, topicCategories, creatorTags });

    if (!llmResult.approved) {
      db.updateVideoStatus(videoId, 'rejected', `LLM: ${llmResult.reason || 'inappropriate content'}`);
      stats.rejected++;
      return;
    }

    // Store tags for approved videos
    if (llmResult.tags.length > 0) {
      db.insertVideoTags(videoId, llmResult.tags);
    }
  } else if (llmState && llmState.calls === llmState.cap) {
    console.warn(`[Cron] LLM cap of ${llmState.cap} reached — remaining videos will skip LLM check`);
  }

  db.updateVideoStatus(videoId, 'approved');
  stats.approved++;
}

async function backfillChannel(channel, profileId, llmState) {
  const filterRules = db.getFilterRules(profileId);
  // llmState is shared with the nightly job so backfill + RSS together respect one cap.
  // Fall back to a standalone cap if called outside the nightly job (e.g. manual trigger).
  const sharedLlmState = llmState || { calls: 0, cap: 50 };
  const stats       = { found: 0, approved: 0, rejected: 0, error: null };
  try {
    const apiVideos = await youtube.getChannelRecentVideos(channel.channel_id, 50);
    for (const v of apiVideos) {
      if (db.videoExists(v.video_id)) continue;
      v._profileId        = profileId;
      v.channel_thumbnail = channel.thumbnail_url || null;
      await processVideo(v, filterRules, stats, false, null, sharedLlmState);
    }
    console.log(`[Backfill] ${channel.channel_name}: approved=${stats.approved} rejected=${stats.rejected}`);
  } catch (err) {
    console.error(`[Backfill] Failed for ${channel.channel_name}:`, err.message);
    stats.error = err.message;
  }
  return stats;
}

// Nightly: pull a handful of parent-curated enrichment topics into the library.
// Cheap (a few searches once/day) vs interactive search. Inserts survivors as
// approved enrichment videos so the feed composer can surface them.
async function sourceEnrichmentTopics(profile, stats, deps = {}) {
  const _db = deps.db || db;
  const _youtube = deps.youtube || youtube;
  const _filter = deps.filter || filter;

  const topics = _db.getActiveEnrichmentTopics(profile.id);
  const rules = _db.getFilterRules(profile.id);
  for (const topic of topics) {
    let videos = [];
    try {
      videos = await _youtube.searchVideos(topic.value, { open: true, maxResults: 15 });
    } catch (err) {
      console.error(`[Enrichment] search failed for "${topic.value}":`, err.message);
      continue;
    }
    for (const video of videos) {
      if (_db.videoExists(video.video_id)) continue;
      if (_filter.isShort(video) || _filter.isLive(video)) continue;
      if (_filter.runFilterPass(video, rules).rejected) continue;
      _db.insertVideo({
        ...video,
        transcript: null,
        channel_thumbnail: null,
        status: 'approved',
        is_recommended: 0,
        source_video_id: null,
        view_count: null,
        needs_llm_review: 1,
        discovery_source: 'enrichment',
      });
      stats.approved = (stats.approved || 0) + 1;
    }
  }
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

async function discoverFromHistory(profile, stats, llmState) {
  // Scrape the last ~100 watched video IDs from the YouTube history page.
  // This uses a saved Playwright browser session (see backend/scripts/setup-session.js).
  // If no session file exists for this profile the step is silently skipped.
  let videoIds;
  try {
    videoIds = await scrapeWatchHistory(profile.id, 100);
  } catch (err) {
    console.warn(`[Cron] History scrape failed for ${profile.name}: ${err.message}`);
    return;
  }

  if (!videoIds.length) return;

  // Filter to IDs not yet in the database
  const newVideoIds = videoIds.filter(id => !db.videoExists(id));
  if (!newVideoIds.length) {
    console.log(`[Cron] No new history videos for ${profile.name} (all already known)`);
    return;
  }

  console.log(`[Cron] ${newVideoIds.length} new video(s) from history for ${profile.name}`);

  // Fetch full metadata so we have channel info, duration, tags, etc.
  const metadataList = await youtube.getVideoMetadata(newVideoIds);

  // Auto-whitelist channels the kid is already watching on real YouTube.
  // Individual videos still go through the full filter pipeline.
  const existingChannelIds = new Set(
    db.getChannelsForProfile(profile.id).map(c => c.channel_id)
  );
  for (const meta of metadataList) {
    if (meta.channel_id && !existingChannelIds.has(meta.channel_id)) {
      db.upsertChannel({
        channel_id:   meta.channel_id,
        profile_id:   profile.id,
        channel_name: meta.channel_name || null,
        thumbnail_url: null,
        whitelisted:  1,
      });
      existingChannelIds.add(meta.channel_id);
      console.log(`[Cron] Auto-whitelisted channel from history: "${meta.channel_name}" for ${profile.name}`);
    }
  }

  const filterRules = db.getFilterRules(profile.id);
  for (const meta of metadataList) {
    if (db.videoExists(meta.video_id)) continue;
    meta._profileId = profile.id;
    await processVideo(meta, filterRules, stats, false, null, llmState);
    await new Promise(r => setTimeout(r, 200));
  }
}

function scheduleJob() {
  const schedule = process.env.CRON_SCHEDULE || '0 2 * * *';
  console.log(`Cron job scheduled: ${schedule}`);
  cron.schedule(schedule, () => {
    console.log('[Cron] Triggered by schedule');
    runNightlyJob().catch(err => console.error('[Cron] Unhandled error:', err));
  });

  // Daily insights pass — 3am, after main ingest
  cron.schedule('0 3 * * *', () => {
    console.log('[Insights] Triggered by schedule');
    runDailyInsightsPass().catch(err => console.error('[Insights] Unhandled error:', err));
  });

  // Weekly consolidation pass — Sunday at 4am
  cron.schedule('0 4 * * 0', () => {
    console.log('[Consolidation] Triggered by schedule');
    runWeeklyConsolidationPass().catch(err => console.error('[Consolidation] Unhandled error:', err));
  });
}

module.exports = { runNightlyJob, scheduleJob, syncSubscriptions, backfillChannel, sourceEnrichmentTopics };
