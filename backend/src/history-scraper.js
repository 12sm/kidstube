'use strict';

/**
 * Playwright-based YouTube watch history scraper.
 *
 * Reads a saved browser session from ./data/sessions/profile_<id>.json,
 * navigates to youtube.com/feed/history, and extracts recently watched
 * video IDs.
 *
 * Session files are created by backend/scripts/setup-session.js (run once
 * on the host). They persist across Docker rebuilds via the data volume.
 */

const path = require('path');
const fs = require('fs');

const DATA_DIR = process.env.DATA_DIR || path.resolve(__dirname, '../../data');
const SESSIONS_DIR = path.join(DATA_DIR, 'sessions');
const HISTORY_URL = 'https://www.youtube.com/feed/history';

// Candidate paths for system-installed Chromium (Alpine apk installs to one of these)
const CHROMIUM_CANDIDATES = [
  process.env.CHROMIUM_PATH,
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
];

function findChromium() {
  for (const p of CHROMIUM_CANDIDATES) {
    if (p && fs.existsSync(p)) return p;
  }
  return null;
}

/**
 * Scrape the YouTube watch history page for a given profile.
 *
 * @param {number} profileId - profile ID (matches session filename)
 * @param {number} maxVideos  - max number of video IDs to return (default 100)
 * @returns {Promise<string[]>} array of YouTube video IDs (deduplicated)
 */
async function scrapeWatchHistory(profileId, maxVideos = 100) {
  const sessionFile = path.join(SESSIONS_DIR, `profile_${profileId}.json`);

  if (!fs.existsSync(sessionFile)) {
    console.log(`[History] No session file at ${sessionFile} — run setup-session.js first`);
    return [];
  }

  const executablePath = findChromium();
  if (!executablePath) {
    console.warn('[History] No system Chromium found. Install via apk add chromium, or set CHROMIUM_PATH.');
    return [];
  }

  const { chromium } = require('playwright');

  const browser = await chromium.launch({
    executablePath,
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
    ],
  });

  try {
    const storageState = JSON.parse(fs.readFileSync(sessionFile, 'utf8'));
    const context = await browser.newContext({
      storageState,
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 900 },
    });
    const page = await context.newPage();

    console.log(`[History] Navigating to ${HISTORY_URL} for profile ${profileId}`);
    await page.goto(HISTORY_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });

    // Wait for at least one video entry to appear
    await page.waitForSelector('a#thumbnail[href*="watch?v="]', { timeout: 20000 }).catch(() => {
      console.warn('[History] Timed out waiting for history items — session may have expired');
    });

    // Scroll to load more history entries
    const scrollPasses = Math.ceil(maxVideos / 20); // ~20 items per screen
    for (let i = 0; i < scrollPasses; i++) {
      await page.evaluate(() => window.scrollBy(0, window.innerHeight * 2));
      await page.waitForTimeout(600);
    }

    // Extract video IDs from thumbnail anchor hrefs
    const videoIds = await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll('a#thumbnail[href*="watch?v="]'));
      return links.map(a => {
        const m = a.href.match(/[?&]v=([A-Za-z0-9_-]{11})/);
        return m ? m[1] : null;
      }).filter(Boolean);
    });

    // Deduplicate while preserving order (most recent first)
    const seen = new Set();
    const unique = [];
    for (const id of videoIds) {
      if (!seen.has(id)) {
        seen.add(id);
        unique.push(id);
        if (unique.length >= maxVideos) break;
      }
    }

    console.log(`[History] Found ${unique.length} recent video IDs for profile ${profileId}`);
    return unique;
  } finally {
    await browser.close();
  }
}

module.exports = { scrapeWatchHistory };
