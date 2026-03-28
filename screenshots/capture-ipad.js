#!/usr/bin/env node
// One-off script to capture KidsTube at iPad viewport (1024x1366)
// Usage: node screenshots/capture-ipad.js

const { chromium } = require('../frontend/node_modules/@playwright/test');
const path = require('path');

async function capture() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1024, height: 1366 },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();

  console.log('Navigating to profile select...');
  await page.goto('http://localhost:3000', { waitUntil: 'networkidle' });

  // Click the first profile avatar
  console.log('Clicking first profile avatar...');
  const profileBtn = page.locator('button').filter({ hasText: /child1|child2/i }).first();
  const fallbackBtn = page.locator('[class*="rounded-full"][class*="cursor-pointer"], button img').first();

  try {
    await profileBtn.waitFor({ timeout: 5000 });
    await profileBtn.click();
  } catch {
    // Try clicking any large circle/avatar button on the profile select screen
    const anyBtn = page.locator('button').first();
    await anyBtn.click();
  }

  // Wait for the home feed to load
  console.log('Waiting for home feed...');
  await page.waitForURL('**/home', { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(2500);

  // Screenshot the home feed
  const homePath = path.join(__dirname, 'playwright', 'current-ipad-home.png');
  await page.screenshot({ path: homePath, fullPage: false });
  console.log(`Home screenshot saved: ${homePath}`);

  // Try to navigate to a channel page — click first channel avatar in the feed
  console.log('Navigating to first channel...');
  try {
    const channelLink = page.locator('a[href*="/channel/"], button').filter({ hasText: '' }).first();
    // Find channel avatar (circular image in feed)
    const channelAvatar = page.locator('img.rounded-full').first();
    await channelAvatar.waitFor({ timeout: 5000 });
    await channelAvatar.click();
    await page.waitForURL('**/channel/**', { timeout: 8000 });
    await page.waitForTimeout(2000);
    const channelPath = path.join(__dirname, 'playwright', 'current-ipad-channel.png');
    await page.screenshot({ path: channelPath, fullPage: false });
    console.log(`Channel screenshot saved: ${channelPath}`);
  } catch (err) {
    console.log('Could not navigate to channel:', err.message);
  }

  await browser.close();
  console.log('Done.');
}

capture().catch(err => {
  console.error(err);
  process.exit(1);
});
