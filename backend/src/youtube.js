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
        part: 'snippet,contentDetails,statistics',
        id: batch.join(',')
      });
      results.push(...(res.data.items || []));
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

module.exports = {
  getSubscriptions,
  getVideoMetadata,
  getChannelRecentVideos,
  enrichChannels,
  parseDuration,
  resolveChannelByUrl
};
