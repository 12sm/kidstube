#!/usr/bin/env node
/**
 * One-time YouTube session setup for history scraping.
 *
 * Run this script on your HOST machine (not inside Docker) once per profile.
 * It opens a browser window so you can log in to the YouTube account whose
 * watch history you want to scrape. When you're done, close the browser tab
 * (or press Ctrl+C here) and the session is saved to ./data/sessions/profile_<id>.json
 *
 * The data volume mounts ./data into the Docker container, so the session file
 * will be available to the nightly cron job automatically.
 *
 * Usage:
 *   node backend/scripts/setup-session.js <profileId>
 *
 * Example:
 *   node backend/scripts/setup-session.js 5
 *   node backend/scripts/setup-session.js 6
 *
 * Prerequisites (run once):
 *   npx playwright install chromium
 *
 * To refresh an expired session, just run this script again — it overwrites
 * the existing file.
 */

const path = require('path');
const fs = require('fs');

const profileId = process.argv[2];
if (!profileId || isNaN(Number(profileId))) {
  console.error('Usage: node backend/scripts/setup-session.js <profileId>');
  console.error('Example: node backend/scripts/setup-session.js 5');
  process.exit(1);
}

const DATA_DIR = path.resolve(__dirname, '../../data');
const SESSIONS_DIR = path.join(DATA_DIR, 'sessions');
const sessionFile = path.join(SESSIONS_DIR, `profile_${profileId}.json`);

fs.mkdirSync(SESSIONS_DIR, { recursive: true });

async function main() {
  let chromium;
  try {
    ({ chromium } = require('playwright'));
  } catch {
    console.error('playwright is not installed. Run: npm install (inside backend/) then npx playwright install chromium');
    process.exit(1);
  }

  console.log(`\nOpening browser for profile ${profileId}...`);
  console.log('Log in to the YouTube account, then navigate to youtube.com/feed/history.');
  console.log('The browser will close automatically once history is detected.\n');

  const browser = await chromium.launch({
    headless: false,
    args: ['--start-maximized'],
  });

  const context = await browser.newContext({
    viewport: null, // use window size
  });

  const page = await context.newPage();
  await page.goto('https://www.youtube.com/feed/history');

  // Auto-detect: wait until the history page is loaded with video content.
  // This fires once the user has logged in and navigated to the history page.
  console.log('Waiting for you to log in and visit youtube.com/feed/history...');
  console.log('(The browser will close automatically once history is detected)\n');

  await page.waitForFunction(() => {
    const onHistoryPage = window.location.pathname === '/feed/history';
    const hasVideos = document.querySelectorAll('a#thumbnail[href*="watch?v="]').length > 0;
    return onHistoryPage && hasVideos;
  }, null, { timeout: 300000, polling: 2000 });

  console.log('History detected — saving session...');

  // Save the session (cookies + localStorage)
  const storageState = await context.storageState();
  fs.writeFileSync(sessionFile, JSON.stringify(storageState, null, 2));
  console.log(`Session saved to ${sessionFile}`);

  await browser.close();
  process.exit(0);
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
