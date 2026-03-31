'use strict';

const Anthropic = require('@anthropic-ai/sdk');
const db = require('./db');

/**
 * Generate an initial child profile markdown from guided interview answers.
 *
 * @param {string} profileName - e.g. "Child1"
 * @param {{ ageGrade, loves, avoid, tone, other }} answers
 * @returns {Promise<string>} markdown profile text
 */
async function generateChildProfile(profileName, answers) {
  if (!process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY.includes('placeholder')) {
    return `${profileName} is a child who enjoys age-appropriate content. No detailed profile available yet.`;
  }

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const userMessage = [
    `Child name: ${profileName}`,
    `Age / grade: ${answers.ageGrade}`,
    `Loves: ${answers.loves}`,
    `Avoid: ${answers.avoid}`,
    `Acceptable tone: ${answers.tone}`,
    answers.other ? `Other notes: ${answers.other}` : null,
  ].filter(Boolean).join('\n');

  const response = await client.messages.create({
    model:      'claude-haiku-4-5',
    max_tokens: 300,
    system: `Generate a concise child profile in markdown for a kids' content recommendation and moderation system.
Write in second person addressing the system — what it should know about this child and how to evaluate content for them.
Keep it under 120 words. Cover: age, interests, things to avoid, and tone guidelines.
Do not include headers or bullet points — write it as a short paragraph.`,
    messages: [{ role: 'user', content: userMessage }],
  });

  return (response.content[0]?.text || '').trim();
}

/**
 * Extract topic tags from a child profile markdown for use as parent-floor interests.
 * Returns an array of lowercase hyphenated tag strings.
 *
 * @param {string} markdown
 * @returns {Promise<string[]>}
 */
async function extractParentTags(markdown) {
  if (!markdown) return [];

  if (!process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY.includes('placeholder')) {
    return [];
  }

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const response = await client.messages.create({
    model:      'claude-haiku-4-5',
    max_tokens: 100,
    system: 'Extract topic interest tags from a child profile. Return ONLY a JSON array of 3–8 lowercase hyphenated tags representing topics the child LIKES (not dislikes). Example: ["minecraft","outer-space","animals"]',
    messages: [{ role: 'user', content: markdown }],
  });

  try {
    const text = response.content[0]?.text || '[]';
    const match = text.match(/\[[\s\S]*\]/);
    if (!match) return [];
    const tags = JSON.parse(match[0]);
    return Array.isArray(tags) ? tags.map(t => String(t).toLowerCase().trim()) : [];
  } catch {
    return [];
  }
}

/**
 * Refresh the parent-source interest rows from the current child profile markdown.
 * Called after every profile save (manual or consolidation).
 *
 * @param {number} profileId
 * @param {string} markdown
 */
async function refreshParentInterests(profileId, markdown) {
  const tags = await extractParentTags(markdown);

  // Remove old parent interests
  db.deleteParentInterests(profileId);

  // Insert new ones at baseline weight 0.5
  for (const tag of tags) {
    db.setParentInterest(profileId, tag, 0.5);
  }
}

module.exports = { generateChildProfile, extractParentTags, refreshParentInterests };
