const Anthropic = require('@anthropic-ai/sdk');
const axios = require('axios');
const { getCanonicalList, normalizeTags } = require('./tags');

/**
 * Returns a smart transcript sample:
 * - Videos ≤ 3 min: first 3000 chars (usually the full transcript)
 * - Videos > 3 min: first 1000 + middle 1000 + last 1000 chars
 */
function smartSampleTranscript(transcript, durationSeconds) {
  if (!transcript) return '';

  const CHUNK = 1000;

  if (!durationSeconds || durationSeconds <= 180) {
    return transcript.slice(0, CHUNK * 3);
  }

  if (transcript.length <= CHUNK * 3) return transcript;

  const len = transcript.length;
  const front  = transcript.slice(0, CHUNK);
  const middle = transcript.slice(Math.floor(len / 2 - CHUNK / 2), Math.floor(len / 2 + CHUNK / 2));
  const end    = transcript.slice(-CHUNK);
  return [front, middle, end].join('\n...\n');
}

// Last-resort audience when no child profile is known at all. Fail safe: judge
// for a young child, never an older default (this used to say "ages 7–8", which
// is how search results Emery (5) watched were judged as if for an 8-year-old).
const FALLBACK_AUDIENCE = 'The viewer is a young child (assume about 5 years old). Judge strictly for that age.';

/**
 * Pull the child's age out of profile markdown ("an 8-year-old", "nearly 5",
 * "age 5", "5 years old"). Returns null when no age is stated.
 */
function ageFromProfile(markdown) {
  if (!markdown) return null;
  const patterns = [
    /\b(\d{1,2})[- ]years?[- ]old\b/i,
    /\bnearly (\d{1,2})\b/i,
    /\bage[sd]? (\d{1,2})\b/i,
    /\b(\d{1,2}) years? of age\b/i,
  ];
  for (const re of patterns) {
    const m = markdown.match(re);
    if (m) {
      const n = parseInt(m[1], 10);
      if (n >= 1 && n <= 17) return n;
    }
  }
  return null;
}

/**
 * @param {string|null} childProfile - the watching child's profile markdown
 * @param {object} [opts]
 * @param {number|null} [opts.age]  - child's age; parsed from the profile when omitted
 * @param {boolean} [opts.strict]   - open-YouTube content: "when in doubt, reject"
 */
function buildSystemPrompt(childProfile, { age = null, strict = false } = {}) {
  const viewerAge = age || ageFromProfile(childProfile);
  let base;
  if (childProfile) {
    base = [
      `You are a content moderator for a children's video platform.`,
      viewerAge
        ? `The viewer is ${viewerAge} years old. Judge strictly for a ${viewerAge}-year-old.`
        : `Judge strictly for the child described below.`,
      ``,
      `--- Notes about this child (written for the recommendation system; they are NOT moderation rules) ---`,
      childProfile,
      `--- End of notes ---`,
    ].join('\n');
  } else {
    base = `You are a content moderator for a children's video platform. ${FALLBACK_AUDIENCE}`;
  }

  const doubt = strict
    ? `This video came from open YouTube search, not from a channel the parent approved. Metadata is often limited (usually no transcript): judge from the title, channel and description, and do not reject only because the transcript is missing. Reject if anything suggests unsafe or unsuitable content for this age, including shock or creepy clickbait. When genuinely unsure whether it is safe, reject.`
    : `When in doubt, approve.`;

  return `${base}

Evaluate the video and return ONLY a JSON object with these fields:
- "approved" (boolean)
- "category" (only when approved is false: one of "violence", "horror-scary", "adult-humor", "language", "disturbing-themes", "dangerous-imitation", "demeaning-creator", "shock-clickbait")
- "reason" (string, max 100 chars, only populated if approved is false)
- "tags" (array of 3–5 lowercase hyphenated topic tags, e.g. ["outer-space", "minecraft", "planets"])

For tags: pick from this canonical list when possible. Only invent a new tag if nothing fits:
${getCanonicalList().join(', ')}
Use the YouTube topic categories and creator tags as context clues. Prefer specific over generic.

Reject content with: violence or fighting, horror or jump scares, adult humor or innuendo, strong language or name-calling, scary/disturbing themes, dangerous activities children might imitate, creators who regularly yell or demean others.
Approve content that is: educational, entertaining for children, age-appropriate gaming, general family content.
${doubt}${childProfile ? `

IMPORTANT: you judge safety for this age, not taste. Reject only when one of the categories above applies. The notes about this child describe interests and engagement (for example "remove X", "<20% baseline", "underperforms", "prioritize Y"); those decide what gets recommended, not what is safe, so ignore them here. Never reject a video because it is off-interest, low-engagement, a format the child watches less, or not one of the child's favourites (Bluey, Peppa Pig, animal and sports videos are fine for a young child). Use the notes only for safety points, such as things that scare or upset this child. The notes never relax the rules above.` : ''}`;
}

function buildUserMessage(video, { topicCategories = [], creatorTags = [] } = {}) {
  return [
    topicCategories.length > 0 ? `YouTube topics: ${topicCategories.join(', ')}` : null,
    creatorTags.length > 0    ? `Creator tags: ${creatorTags.slice(0, 20).join(', ')}` : null,
    `Title: ${video.title || '(no title)'}`,
    `Description: ${(video.description || '').slice(0, 300)}`,
    `Transcript: ${smartSampleTranscript(video.transcript, video.duration_seconds)}`,
  ].filter(Boolean).join('\n');
}

function parseResponse(text) {
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return { approved: true, reason: null, tags: [] };
    const parsed = JSON.parse(jsonMatch[0]);
    return {
      approved: !!parsed.approved,
      reason:   parsed.reason || null,
      tags:     Array.isArray(parsed.tags) ? normalizeTags(parsed.tags.map(t => String(t).toLowerCase().trim())) : [],
    };
  } catch {
    console.warn('LLM response parse failed, defaulting to approve:', text.slice(0, 100));
    return { approved: true, reason: null, tags: [] };
  }
}

// Strict parse for the review gate: anything that isn't a clear JSON verdict is
// an error (the caller fails closed), never an implicit approval.
function parseResponseStrict(text) {
  const jsonMatch = (text || '').match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('LLM returned no JSON verdict');
  const parsed = JSON.parse(jsonMatch[0]);
  if (typeof parsed.approved !== 'boolean') throw new Error('LLM verdict missing boolean "approved"');
  return {
    approved: parsed.approved,
    reason:   parsed.reason || null,
    tags:     Array.isArray(parsed.tags) ? normalizeTags(parsed.tags.map(t => String(t).toLowerCase().trim())) : [],
  };
}

function promptOpts(opts) {
  return { age: opts.age || null, strict: !!opts.strict };
}

async function callAnthropic(video, opts = {}) {
  const client = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
    ...(opts.timeoutMs ? { timeout: opts.timeoutMs } : {}),
    maxRetries: opts.maxRetries ?? (opts.timeoutMs ? 0 : 2),
  });
  const response = await client.messages.create({
    model:      'claude-haiku-4-5',
    max_tokens: 200,
    system:     buildSystemPrompt(opts.childProfile || null, promptOpts(opts)),
    messages:   [{ role: 'user', content: buildUserMessage(video, opts) }],
  });
  return response.content[0]?.text || '';
}

async function callOllama(video, opts = {}) {
  const ollamaUrl = process.env.OLLAMA_URL || 'http://localhost:11434';
  const response = await axios.post(`${ollamaUrl}/api/generate`, {
    model:  'llama3',
    system: buildSystemPrompt(opts.childProfile || null, promptOpts(opts)),
    prompt: buildUserMessage(video, opts),
    stream: false,
  }, { timeout: opts.timeoutMs || 30000 });
  return response.data.response || '';
}

async function checkWithAnthropic(video, opts = {}) {
  return parseResponse((await callAnthropic(video, opts)) || '{}');
}

async function checkWithOllama(video, opts = {}) {
  return parseResponse((await callOllama(video, opts)) || '{}');
}

function withTimeout(promise, ms) {
  if (!ms) return promise;
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`LLM review timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Fail-closed review used by the search/play gate. Same prompt as runLlmCheck,
 * but THROWS on any API error, timeout, missing key or unparseable reply, so the
 * caller can keep the video unplayable. Never defaults to approve.
 *
 * @param {object} video
 * @param {object} opts - { childProfile, age?, strict?, timeoutMs?, topicCategories?, creatorTags? }
 * @returns {Promise<{ approved: boolean, reason: string|null, tags: string[] }>}
 */
async function runLlmReviewStrict(video, opts = {}) {
  const provider = process.env.LLM_PROVIDER || 'anthropic';
  if (provider !== 'ollama') {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key || key.includes('placeholder')) throw new Error('No ANTHROPIC_API_KEY configured');
  }
  const call = provider === 'ollama' ? callOllama(video, opts) : callAnthropic(video, opts);
  const text = await withTimeout(call, opts.timeoutMs);
  return parseResponseStrict(text);
}

/**
 * Run the combined appropriateness + tag extraction check.
 *
 * @param {object} video - { title, description, transcript, duration_seconds }
 * @param {object} opts  - { childProfile?, topicCategories?, creatorTags? }
 * @returns {{ approved: boolean, reason: string|null, tags: string[] }}
 */
async function runLlmCheck(video, opts = {}) {
  const provider = process.env.LLM_PROVIDER || 'anthropic';
  try {
    if (provider === 'ollama') {
      return await checkWithOllama(video, opts);
    }
    return await checkWithAnthropic(video, opts);
  } catch (err) {
    console.error('LLM check failed, defaulting to approve:', err.message);
    return { approved: true, reason: null, tags: [] };
  }
}

async function extractSearchQuery(rawSpeech) {
  if (!rawSpeech || !rawSpeech.trim()) return rawSpeech;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || apiKey === 'placeholder') return rawSpeech;

  try {
    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
      model:      'claude-haiku-4-5',
      max_tokens: 30,
      system:     'You convert children\'s speech into YouTube search queries. Return ONLY search keywords, 2-6 words. No quotes, no explanation, no questions, no commentary. If the speech is unclear or not a video request, still return your best guess at search terms. Never ask for clarification. Never say you need more information. Just output keywords.',
      messages:   [{ role: 'user', content: rawSpeech }],
    });
    const result = (response.content[0]?.text || '').trim();
    return result || rawSpeech;
  } catch (err) {
    console.error('[LLM] extractSearchQuery failed, using raw speech:', err.message);
    return rawSpeech;
  }
}

module.exports = {
  runLlmCheck, runLlmReviewStrict, smartSampleTranscript, extractSearchQuery,
  buildSystemPrompt, ageFromProfile, parseResponseStrict, FALLBACK_AUDIENCE,
};
