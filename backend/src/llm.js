const Anthropic = require('@anthropic-ai/sdk');
const axios = require('axios');

const SYSTEM_PROMPT = `You are a content moderator for a children's video platform. The viewers are ages 7-8. Evaluate the following video content and return ONLY a JSON object with two fields: "approved" (boolean) and "reason" (string, max 100 chars, only populated if approved is false). Reject content that contains: violence or fighting, horror or jump scares, adult humor or innuendo, strong language or name-calling, scary or disturbing themes, dangerous activities children might imitate, or content clearly targeted at adults. Approve content that is: educational, entertaining for children, gaming content appropriate for ages 7-8, or general family content. When in doubt, approve.`;

async function checkWithAnthropic(video) {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const userMessage = [
    `Title: ${video.title || '(no title)'}`,
    `Description: ${(video.description || '').slice(0, 300)}`,
    `Transcript excerpt: ${(video.transcript || '').slice(0, 2000)}`
  ].join('\n');

  const response = await client.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 150,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userMessage }]
  });

  const text = response.content[0]?.text || '{}';
  return parseResponse(text);
}

async function checkWithOllama(video) {
  const ollamaUrl = process.env.OLLAMA_URL || 'http://localhost:11434';

  const userMessage = [
    `Title: ${video.title || '(no title)'}`,
    `Description: ${(video.description || '').slice(0, 300)}`,
    `Transcript excerpt: ${(video.transcript || '').slice(0, 2000)}`
  ].join('\n');

  const response = await axios.post(`${ollamaUrl}/api/generate`, {
    model: 'llama3',
    system: SYSTEM_PROMPT,
    prompt: userMessage,
    stream: false
  }, { timeout: 30000 });

  return parseResponse(response.data.response || '{}');
}

function parseResponse(text) {
  try {
    // Extract JSON from the response (handle markdown code blocks)
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return { approved: true, reason: null };
    const parsed = JSON.parse(jsonMatch[0]);
    return {
      approved: !!parsed.approved,
      reason: parsed.reason || null
    };
  } catch {
    // If we can't parse, default to approve (spec: "when in doubt, approve")
    console.warn('LLM response parse failed, defaulting to approve:', text.slice(0, 100));
    return { approved: true, reason: null };
  }
}

async function runLlmCheck(video) {
  const provider = process.env.LLM_PROVIDER || 'anthropic';

  try {
    if (provider === 'ollama') {
      return await checkWithOllama(video);
    } else {
      return await checkWithAnthropic(video);
    }
  } catch (err) {
    console.error('LLM check failed, defaulting to approve:', err.message);
    // On LLM failure, approve the video rather than blocking content
    return { approved: true, reason: null };
  }
}

module.exports = { runLlmCheck };
