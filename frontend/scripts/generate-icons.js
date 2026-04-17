import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const svgPath = resolve(__dirname, '../public/icon.svg');
const svgContent = readFileSync(svgPath, 'utf8');

const sizes = [
  { name: 'icon-180-v4.png', size: 180 },
  { name: 'icon-192.png', size: 192 },
  { name: 'icon-512.png', size: 512 },
];

const browser = await chromium.launch();

for (const { name, size } of sizes) {
  const page = await browser.newPage();
  await page.setViewportSize({ width: size, height: size });
  // Wrap SVG in HTML so we can control layout — raw SVG data URLs don't have body/head
  const html = `<!DOCTYPE html><html><head><style>*{margin:0;padding:0}html,body{width:${size}px;height:${size}px;overflow:hidden}svg{display:block;width:${size}px;height:${size}px}</style></head><body>${svgContent}</body></html>`;
  const htmlBase64 = Buffer.from(html).toString('base64');
  await page.goto(`data:text/html;base64,${htmlBase64}`);
  await page.waitForLoadState('domcontentloaded');
  const buffer = await page.screenshot({ type: 'png', clip: { x: 0, y: 0, width: size, height: size } });
  const outPath = resolve(__dirname, '../public', name);
  writeFileSync(outPath, buffer);
  console.log(`Generated ${name} (${size}x${size})`);
  await page.close();
}

await browser.close();
console.log('Done.');
