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

function buildSystemPrompt(childProfile) {
  const base = childProfile
    ? `You are a content moderator for a children's video platform.\n\nChild profile:\n${childProfile}`
    : `You are a content moderator for a children's video platform. The viewers are ages 7–8.`;

  return `${base}

Evaluate the video and return ONLY a JSON object with three fields:
- "approved" (boolean)
- "reason" (string, max 100 chars, only populated if approved is false)
- "tags" (array of 3–5 lowercase hyphenated topic tags, e.g. ["outer-space", "minecraft", "planets"])

For tags: pick from this canonical list when possible. Only invent a new tag if nothing fits:
${getCanonicalList().join(', ')}
Use the YouTube topic categories and creator tags as context clues. Prefer specific over generic.

Reject content with: violence or fighting, horror or jump scares, adult humor or innuendo, strong language or name-calling, scary/disturbing themes, dangerous activities children might imitate, creators who regularly yell or demean others.
Approve content that is: educational, entertaining for children, age-appropriate gaming, general family content.
When in doubt, approve.`;
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

async function checkWithAnthropic(video, opts = {}) {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const response = await client.messages.create({
    model:      'claude-haiku-4-5',
    max_tokens: 200,
    system:     buildSystemPrompt(opts.childProfile || null),
    messages:   [{ role: 'user', content: buildUserMessage(video, opts) }],
  });
  return parseResponse(response.content[0]?.text || '{}');
}

async function checkWithOllama(video, opts = {}) {
  const ollamaUrl = process.env.OLLAMA_URL || 'http://localhost:11434';
  const response = await axios.post(`${ollamaUrl}/api/generate`, {
    model:  'llama3',
    system: buildSystemPrompt(opts.childProfile || null),
    prompt: buildUserMessage(video, opts),
    stream: false,
  }, { timeout: 30000 });
  return parseResponse(response.data.response || '{}');
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

module.exports = { runLlmCheck, smartSampleTranscript };
