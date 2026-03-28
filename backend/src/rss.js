const axios = require('axios');
const xml2js = require('xml2js');

const RSS_URL = 'https://www.youtube.com/feeds/videos.xml?channel_id=';
const LOOKBACK_HOURS = 26; // slightly over 24h to catch edge cases

async function fetchChannelFeed(channelId) {
  const url = RSS_URL + channelId;
  try {
    const res = await axios.get(url, {
      timeout: 10000,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; KidsTube/1.0)' }
    });
    return res.data;
  } catch (err) {
    console.error(`RSS fetch failed for channel ${channelId}:`, err.message);
    return null;
  }
}

async function parseRssFeed(xmlData) {
  if (!xmlData) return [];
  try {
    const parser = new xml2js.Parser({ explicitArray: false, mergeAttrs: true });
    const result = await parser.parseStringPromise(xmlData);

    const entries = result?.feed?.entry;
    if (!entries) return [];

    // xml2js returns single object if only one entry, array if multiple
    const entryArray = Array.isArray(entries) ? entries : [entries];

    return entryArray.map(entry => ({
      video_id: entry['yt:videoId'] || entry.id?.split(':').pop() || null,
      title: entry.title || '',
      description: entry['media:group']?.['media:description'] || '',
      thumbnail_url: entry['media:group']?.['media:thumbnail']?.url || null,
      channel_id: entry['yt:channelId'] || null,
      channel_name: entry.author?.name || '',
      published_at: entry.published || null
    })).filter(v => v.video_id);
  } catch (err) {
    console.error('RSS parse error:', err.message);
    return [];
  }
}

async function getRecentVideosForChannel(channelId, db) {
  const xml = await fetchChannelFeed(channelId);
  if (!xml) return [];

  const videos = await parseRssFeed(xml);
  const cutoff = Date.now() - LOOKBACK_HOURS * 60 * 60 * 1000;

  return videos.filter(v => {
    if (!v.published_at) return false;
    const pubTime = new Date(v.published_at).getTime();
    if (isNaN(pubTime)) return false;
    if (pubTime < cutoff) return false;
    // Skip if already in database
    if (db && db.videoExists(v.video_id)) return false;
    return true;
  });
}

async function getAllNewVideos(channels, db) {
  const results = [];
  for (const channel of channels) {
    const videos = await getRecentVideosForChannel(channel.channel_id, db);
    // Attach channel metadata from our DB record
    for (const v of videos) {
      v.channel_id = channel.channel_id;
      v.channel_name = channel.channel_name;
      v.channel_thumbnail = channel.thumbnail_url;
    }
    results.push(...videos);
    // Small delay to be polite to YouTube's servers
    await new Promise(r => setTimeout(r, 200));
  }
  return results;
}

module.exports = { getRecentVideosForChannel, getAllNewVideos };
