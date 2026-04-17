/**
 * Pass 1: Keyword filter
 *
 * Checks video fields against all keyword_block rules.
 * Returns { rejected: false } or { rejected: true, reason: 'Keyword: <word>' }
 */

function applyKeywordFilter(video, rules) {
  const keywordRules = rules.filter(r => r.rule_type === 'keyword_block');

  for (const rule of keywordRules) {
    const keyword = rule.value.toLowerCase();
    const scope = rule.scope || 'all';

    const fieldsToCheck = [];

    if (scope === 'all' || scope === 'title') {
      if (video.title) fieldsToCheck.push(video.title.toLowerCase());
    }
    if (scope === 'all' || scope === 'description') {
      if (video.description) fieldsToCheck.push(video.description.toLowerCase());
    }
    if (scope === 'all' || scope === 'transcript') {
      if (video.transcript) fieldsToCheck.push(video.transcript.toLowerCase());
    }

    // Also check tags if checking all or title
    if (scope === 'all' || scope === 'title') {
      if (video.tags && Array.isArray(video.tags)) {
        fieldsToCheck.push(video.tags.join(' ').toLowerCase());
      }
    }

    for (const text of fieldsToCheck) {
      if (text.includes(keyword)) {
        return { rejected: true, reason: `Keyword: "${rule.value}"` };
      }
    }
  }

  return { rejected: false };
}

/**
 * Pass 1b: Channel block filter
 * Checks if the video's channel is blocked by a channel_block rule.
 */
function applyChannelFilter(video, rules) {
  const channelRules = rules.filter(r => r.rule_type === 'channel_block');
  for (const rule of channelRules) {
    if (video.channel_id === rule.value) {
      return { rejected: true, reason: `Channel blocked: ${video.channel_name || rule.value}` };
    }
  }
  return { rejected: false };
}

function runFilterPass(video, rules) {
  const channelResult = applyChannelFilter(video, rules);
  if (channelResult.rejected) return channelResult;

  const keywordResult = applyKeywordFilter(video, rules);
  if (keywordResult.rejected) return keywordResult;

  return { rejected: false };
}

/**
 * Pass 0: Shorts detection
 * Any one signal firing means the video is a YouTube Short.
 * Runs before keyword filter — cheap metadata check only.
 */
function isShort(video) {
  // Signal 1: duration ≤ 60s
  if (video.duration_seconds != null && video.duration_seconds <= 60) return true;

  // Signal 2: self-labelled with #shorts or #short
  const textFields = [
    video.title,
    video.description,
    ...(Array.isArray(video.tags) ? video.tags : [])
  ].filter(Boolean).join(' ').toLowerCase();
  if (/#shorts?\b/.test(textFields)) return true;

  // Signal 3: yt-dlp is_short flag
  if (video.is_short === true) return true;

  // Signal 4: vertical aspect ratio (height > width)
  if (video.width && video.height && video.height > video.width) return true;

  return false;
}

/**
 * Pass 0: Live stream detection
 *
 * Primary: yt-dlp is_live / was_live / live_status flags (most reliable).
 * Fallback: title-pattern heuristics for the RSS-only stage before yt-dlp runs.
 *   Only fires when yt-dlp hasn't run yet (live_status and is_live are both absent).
 *   Patterns are deliberately conservative — they require clear broadcast signals
 *   (🔴 + "live", "livestream", title starts/ends with "live", "LIVE!!!") so that
 *   videos where "live" appears as a verb ("secretly live in a park") are not caught.
 */
function isLive(video) {
  // Primary: yt-dlp metadata flags
  if (video.is_live === true) return true;
  if (video.was_live === true) return true;
  const s = video.live_status;
  if (s === 'is_live' || s === 'was_live' || s === 'post_live') return true;

  // Fallback title patterns — only when yt-dlp hasn't provided flags yet
  if (video.live_status === undefined && video.is_live === undefined) {
    const title = (video.title || '').toLowerCase();
    if (/livestream|live\s+stream/.test(title)) return true;         // "livestream" or "live stream"
    if (/🔴/.test(video.title || '') && /\blive\b/.test(title)) return true; // 🔴 + word "live"
    if (/^live\s*[|:]/.test(title)) return true;                     // title starts "live |" or "live:"
    if (/[|:]\s*live\s*$/.test(title)) return true;                  // title ends "| live" or ": live"
    if (/\blive\s*!{2,}/.test(title)) return true;                   // "LIVE!!!"
  }

  return false;
}

module.exports = { runFilterPass, applyKeywordFilter, applyChannelFilter, isShort, isLive };
