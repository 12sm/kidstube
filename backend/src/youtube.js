const { google } = require('googleapis');
const auth = require('./auth');

// Get subscriptions for a profile
async function getSubscriptions(profileId) {
  const oauth2Client = await auth.getAuthenticatedClient(profileId);
  const youtube = google.youtube({ version: 'v3', auth: oauth2Client });

  const channels = [];
  let pageToken;

  do {
    const res = await youtube.subscriptions.list({
      part: 'snippet',
      mine: true,
      maxResults: 50,
      pageToken
    });

    for (const item of res.data.items || []) {
      channels.push({
        channel_id: item.snippet.resourceId.channelId,
        channel_name: item.snippet.title,
        thumbnail_url: item.snippet.thumbnails?.default?.url || null
      });
    }

    pageToken = res.data.nextPageToken;
  } while (pageToken);

  return channels;
}

// Get video metadata for a list of video IDs (up to 50 at a time)
async function getVideoMetadata(videoIds) {
  if (!videoIds || videoIds.length === 0) return [];

  const youtube = google.youtube({
    version: 'v3',
    auth: process.env.YOUTUBE_API_KEY
  });

  const results = [];
  // API allows up to 50 per call
  for (let i = 0; i < videoIds.length; i += 50) {
    const batch = videoIds.slice(i, i + 50);
    try {
      const res = await youtube.videos.list({
        part: 'snippet,contentDetails,statistics,topicDetails',
        id: batch.join(',')
      });
      for (const item of res.data.items || []) {
        results.push({
          video_id: item.id,
          title: item.snippet?.title || null,
          description: item.snippet?.description || null,
          thumbnail_url: item.snippet?.thumbnails?.medium?.url || item.snippet?.thumbnails?.default?.url || null,
          channel_id: item.snippet?.channelId || null,
          channel_name: item.snippet?.channelTitle || null,
          published_at: item.snippet?.publishedAt || null,
          duration_seconds: parseDuration(item.contentDetails?.duration),
          view_count: item.statistics?.viewCount ? parseInt(item.statistics.viewCount) : null,
          tags: item.snippet?.tags || [],
          topicCategories: item.topicDetails?.topicCategories || []
        });
      }
    } catch (err) {
      console.error('Error fetching video metadata:', err.message);
    }
  }
  return results;
}

// Get channel's recent videos via the uploads playlist
// Used as fallback/supplement when looking for related content
async function getChannelRecentVideos(channelId, maxResults = 15) {
  const youtube = google.youtube({
    version: 'v3',
    auth: process.env.YOUTUBE_API_KEY
  });

  try {
    // First get the uploads playlist ID
    const channelRes = await youtube.channels.list({
      part: 'contentDetails',
      id: channelId
    });

    const uploadsPlaylistId = channelRes.data.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
    if (!uploadsPlaylistId) return [];

    // Then get the playlist items
    const playlistRes = await youtube.playlistItems.list({
      part: 'snippet',
      playlistId: uploadsPlaylistId,
      maxResults
    });

    return (playlistRes.data.items || []).map(item => ({
      video_id: item.snippet.resourceId.videoId,
      title: item.snippet.title,
      description: item.snippet.description,
      thumbnail_url: item.snippet.thumbnails?.medium?.url || item.snippet.thumbnails?.default?.url || null,
      channel_id: channelId,
      channel_name: item.snippet.channelTitle,
      published_at: item.snippet.publishedAt
    }));
  } catch (err) {
    console.error(`Error getting channel videos for ${channelId}:`, err.message);
    return [];
  }
}

// Parse ISO 8601 duration to seconds (e.g. PT4M13S -> 253)
function parseDuration(iso8601) {
  if (!iso8601) return null;
  const match = iso8601.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return null;
  return ((parseInt(match[1]) || 0) * 3600) +
         ((parseInt(match[2]) || 0) * 60) +
         (parseInt(match[3]) || 0);
}

// Fetch enrichment data (description, subscriber count, @handle) for a list of channel IDs
async function enrichChannels(channelIds) {
  const yt = google.youtube({ version: 'v3', auth: process.env.YOUTUBE_API_KEY });
  const results = [];

  for (let i = 0; i < channelIds.length; i += 50) {
    const batch = channelIds.slice(i, i + 50);
    try {
      const res = await yt.channels.list({ part: 'snippet,statistics', id: batch.join(',') });
      for (const item of res.data.items || []) {
        results.push({
          channel_id:       item.id,
          description:      item.snippet.description || null,
          subscriber_count: item.statistics?.subscriberCount ? parseInt(item.statistics.subscriberCount) : null,
          custom_url:       item.snippet.customUrl || null
        });
      }
    } catch (err) {
      console.error('[YouTube] enrichChannels batch error:', err.message);
    }
  }

  return results;
}

// Resolve a YouTube URL, @handle, or channel ID to channel info
async function resolveChannelByUrl(input) {
  const yt = google.youtube({ version: 'v3', auth: process.env.YOUTUBE_API_KEY });

  let params;
  try {
    const url = input.includes('://') ? input : 'https://youtube.com/' + input;
    const u = new URL(url);
    const p = u.pathname;
    const channelId = (p.match(/\/channel\/(UC[A-Za-z0-9_-]+)/) || [])[1];
    const handle    = (p.match(/\/@([A-Za-z0-9_.-]+)/) || [])[1];
    const user      = (p.match(/\/(?:c|user)\/([^/?]+)/) || [])[1];
    if (channelId)   params = { id: channelId };
    else if (handle) params = { forHandle: '@' + handle };
    else if (user)   params = { forUsername: user };
  } catch {
    if (input.startsWith('UC') && input.length > 10) params = { id: input };
    else if (input.startsWith('@'))                  params = { forHandle: input };
    else                                             params = { forHandle: '@' + input };
  }

  if (!params) throw new Error('Could not parse YouTube URL or identifier');

  const res = await yt.channels.list({ part: 'snippet', ...params });
  const item = res.data.items?.[0];
  if (!item) throw new Error('Channel not found');

  return {
    channel_id:    item.id,
    channel_name:  item.snippet.title,
    thumbnail_url: item.snippet.thumbnails?.default?.url || null
  };
}

/**
 * Extracts readable topic strings from YouTube's topicDetails.topicCategories.
 * Input: ["https://en.wikipedia.org/wiki/Minecraft", "https://en.wikipedia.org/wiki/Video_game"]
 * Output: ["Minecraft", "Video game"]
 */
function parseTopicCategories(topicCategories) {
  if (!Array.isArray(topicCategories)) return [];
  return topicCategories
    .map(url => {
      try {
        const slug = url.split('/wiki/')[1];
        if (!slug) return null;
        return decodeURIComponent(slug).replace(/_/g, ' ');
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

async function searchVideos(query, { channelIds, maxResults = 20, open = false } = {}) {
  if (!process.env.YOUTUBE_API_KEY || !query) return [];

  const yt = google.youtube({ version: 'v3', auth: process.env.YOUTUBE_API_KEY });
  const whitelistSet = channelIds ? new Set(channelIds) : null;

  try {
    const res = await yt.search.list({
      part: 'snippet',
      q: query,
      type: 'video',
      maxResults: 50,
      safeSearch: 'strict',
      videoEmbeddable: 'true',
    });

    const items = res.data.items || [];

    if (open) {
      // Open search: return all results, no channel filter
      return items.slice(0, maxResults).map(item => ({
        video_id:         item.id.videoId,
        title:            item.snippet.title,
        channel_id:       item.snippet.channelId,
        channel_name:     item.snippet.channelTitle,
        thumbnail_url:    item.snippet.thumbnails?.medium?.url || item.snippet.thumbnails?.default?.url || null,
        description:      item.snippet.description || null,
        published_at:     item.snippet.publishedAt || null,
        duration_seconds: null,
      }));
    }

    // Legacy: filter to whitelisted channels only
    return items
      .filter(item => whitelistSet && whitelistSet.has(item.snippet.channelId))
      .slice(0, maxResults)
      .map(item => ({
        video_id:         item.id.videoId,
        title:            item.snippet.title,
        channel_id:       item.snippet.channelId,
        channel_name:     item.snippet.channelTitle,
        thumbnail_url:    item.snippet.thumbnails?.medium?.url || item.snippet.thumbnails?.default?.url || null,
        description:      item.snippet.description || null,
        published_at:     item.snippet.publishedAt || null,
        duration_seconds: null,
      }));
  } catch (err) {
    console.error('[YouTube] searchVideos failed:', err.message);
    return [];
  }
}

async function discoverChannels(query) {
  if (!process.env.YOUTUBE_API_KEY || !query) return [];
  const yt = google.youtube({ version: 'v3', auth: process.env.YOUTUBE_API_KEY });
  try {
    const res = await yt.search.list({
      part: 'snippet',
      q: query,
      type: 'channel',
      maxResults: 10,
      safeSearch: 'strict',
    });
    return (res.data.items || []).map(item => ({
      channel_id:       item.snippet.channelId,
      channel_name:     item.snippet.channelTitle,
      thumbnail_url:    item.snippet.thumbnails?.medium?.url || item.snippet.thumbnails?.default?.url || null,
      description:      item.snippet.description || null,
      subscriber_count: null, // filled by enrichChannels() after collection
    }));
  } catch (err) {
    console.error('[YouTube] discoverChannels failed:', err.message);
    return [];
  }
}

// Fetch videos liked by a profile since a given date.
// Note: YouTube API blocks watch history (HL playlist) for third-party apps.
// Liked videos (LL playlist) are accessible and serve as a stronger discovery signal —
// a deliberate thumbs-up is a cleaner intent signal than a passive view.
async function getRecentLikes(profileId, since) {
  const oauth2Client = await auth.getAuthenticatedClient(profileId);
  const youtube = google.youtube({ version: 'v3', auth: oauth2Client });

  const items = [];
  let pageToken;

  do {
    const res = await youtube.playlistItems.list({
      part: 'snippet',
      playlistId: 'LL',
      maxResults: 50,
      pageToken
    });

    let hitOld = false;
    for (const item of res.data.items || []) {
      const likedAt = new Date(item.snippet.publishedAt);
      if (likedAt < since) { hitOld = true; break; }
      const videoId = item.snippet.resourceId?.videoId;
      if (!videoId) continue;
      items.push({
        video_id:     videoId,
        channel_id:   item.snippet.videoOwnerChannelId || null,
        channel_name: item.snippet.videoOwnerChannelTitle || null,
        liked_at:     item.snippet.publishedAt
      });
    }

    if (hitOld) break;
    pageToken = res.data.nextPageToken;
  } while (pageToken);

  return items;
}

module.exports = {
  getSubscriptions,
  getRecentLikes,
  getVideoMetadata,
  getChannelRecentVideos,
  enrichChannels,
  parseDuration,
  resolveChannelByUrl,
  parseTopicCategories,
  searchVideos,
  discoverChannels,
};
