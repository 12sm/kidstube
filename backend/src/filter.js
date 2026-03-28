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

module.exports = { runFilterPass, applyKeywordFilter, applyChannelFilter };
