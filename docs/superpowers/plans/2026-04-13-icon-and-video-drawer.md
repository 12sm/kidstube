# Icon + Video Drawer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a proper YouTube-style PWA icon set and a related-videos drawer that appears inside the video player controls.

**Architecture:** The icon is a static SVG converted to PNGs at three sizes, with the existing vite-plugin-pwa config updated to use them. The drawer threads a `relatedVideos` array through PlayerContext (already used by MiniPlayer) — Watch.jsx populates it after its existing related-videos fetch, and MiniPlayer renders the drawer UI as part of the controls layer.

**Tech Stack:** Playwright (already in devDependencies) for SVG→PNG generation, React state for drawer toggle, Tailwind for styling.

---

## File Map

| File | Change |
|------|--------|
| `frontend/public/icon.svg` | Create — master icon SVG |
| `frontend/public/icon-180.png` | Create — apple-touch-icon (generated) |
| `frontend/public/icon-192.png` | Create — PWA manifest icon (generated) |
| `frontend/public/icon-512.png` | Create — PWA splash icon (generated) |
| `frontend/scripts/generate-icons.js` | Create — Playwright PNG generation script |
| `frontend/vite.config.js` | Modify — update PWA manifest name/colors/icons |
| `frontend/index.html` | Modify — title, apple-touch-icon, favicon |
| `frontend/src/contexts/PlayerContext.jsx` | Modify — add relatedVideos / setRelatedVideos |
| `frontend/src/pages/Watch.jsx` | Modify — call setRelatedVideos after related fetch |
| `frontend/src/components/MiniPlayer.jsx` | Modify — drawer state, icon button, drawer panel |

---

## Task 1: Create the master SVG icon

**Files:**
- Create: `frontend/public/icon.svg`

- [ ] **Step 1: Write the SVG**

Create `frontend/public/icon.svg` with the following content:

```svg
<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <!-- White background -->
  <rect width="512" height="512" fill="#ffffff"/>
  <!-- Red rounded rectangle (YouTube logo shape) -->
  <rect x="56" y="148" width="400" height="216" rx="48" ry="48" fill="#FF0000"/>
  <!-- White play triangle -->
  <polygon points="196,168 196,344 372,256" fill="#ffffff"/>
</svg>
```

- [ ] **Step 2: Verify it renders correctly**

Open `frontend/public/icon.svg` in a browser (or use the file:// URL). You should see:
- White square background
- Red rounded rectangle centered
- White triangle pointing right inside the red shape

Matches the current YouTube app icon exactly.

- [ ] **Step 3: Commit**

```bash
git add frontend/public/icon.svg
git commit -m "feat: add YouTube icon SVG"
```

---

## Task 2: Generate PNG icons from SVG

**Files:**
- Create: `frontend/scripts/generate-icons.js`
- Create: `frontend/public/icon-180.png`
- Create: `frontend/public/icon-192.png`
- Create: `frontend/public/icon-512.png`

No new dependencies — uses `@playwright/test`'s underlying Playwright which is already installed.

- [ ] **Step 1: Write the generation script**

Create `frontend/scripts/generate-icons.js`:

```js
import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const svgPath = resolve(__dirname, '../public/icon.svg');
const svgContent = readFileSync(svgPath, 'utf8');
const svgBase64 = Buffer.from(svgContent).toString('base64');
const dataUrl = `data:image/svg+xml;base64,${svgBase64}`;

const sizes = [
  { name: 'icon-180.png', size: 180 },
  { name: 'icon-192.png', size: 192 },
  { name: 'icon-512.png', size: 512 },
];

const browser = await chromium.launch();

for (const { name, size } of sizes) {
  const page = await browser.newPage();
  await page.setViewportSize({ width: size, height: size });
  await page.goto(dataUrl);
  // Wait for SVG to render
  await page.waitForLoadState('domcontentloaded');
  const buffer = await page.screenshot({ type: 'png', clip: { x: 0, y: 0, width: size, height: size } });
  const outPath = resolve(__dirname, '../public', name);
  writeFileSync(outPath, buffer);
  console.log(`Generated ${name} (${size}x${size})`);
  await page.close();
}

await browser.close();
console.log('Done.');
```

- [ ] **Step 2: Run the script**

From inside the `frontend/` directory:

```bash
cd frontend
node scripts/generate-icons.js
```

Expected output:
```
Generated icon-180.png (180x180)
Generated icon-192.png (192x192)
Generated icon-512.png (512x512)
Done.
```

If Playwright browsers aren't installed yet: `npx playwright install chromium` then re-run.

- [ ] **Step 3: Verify the PNGs**

Open each PNG in a browser or image viewer. All three should show the YouTube icon (white background, red rounded rect, white triangle) at their respective sizes. Pixel-check the 180px one especially — it will be used as the iOS home screen icon.

- [ ] **Step 4: Commit**

```bash
git add frontend/public/icon-180.png frontend/public/icon-192.png frontend/public/icon-512.png frontend/scripts/generate-icons.js
git commit -m "feat: generate YouTube PNG icons at 180/192/512px"
```

---

## Task 3: Update PWA metadata

**Files:**
- Modify: `frontend/vite.config.js`
- Modify: `frontend/index.html`

- [ ] **Step 1: Update vite.config.js VitePWA config**

In `frontend/vite.config.js`, replace the `VitePWA({...})` call's `manifest` block and `includeAssets`. The full updated `VitePWA` call:

```js
VitePWA({
  registerType: 'autoUpdate',
  includeAssets: ['icon-180.png', 'icon-192.png', 'icon-512.png', 'icon.svg', 'offline.html'],
  manifest: {
    name: 'YouTube',
    short_name: 'YouTube',
    description: 'Your videos',
    theme_color: '#FF0000',
    background_color: '#ffffff',
    display: 'standalone',
    orientation: 'any',
    start_url: '/',
    scope: '/',
    icons: [
      {
        src: 'icon-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any'
      },
      {
        src: 'icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any maskable'
      }
    ]
  },
  workbox: {
    globPatterns: ['**/*.{js,css,html,ico,png,svg,woff,woff2}'],
    navigateFallback: 'index.html',
    navigateFallbackDenylist: [/^\/api\//, /^\/auth\//, /^\/health/],
    runtimeCaching: [
      {
        urlPattern: /^https:\/\/i\.ytimg\.com\/.*/i,
        handler: 'CacheFirst',
        options: {
          cacheName: 'youtube-thumbnails',
          expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 7 }
        }
      },
      {
        urlPattern: /^https:\/\/yt3\.ggpht\.com\/.*/i,
        handler: 'CacheFirst',
        options: {
          cacheName: 'channel-avatars',
          expiration: { maxEntries: 100, maxAgeSeconds: 60 * 60 * 24 * 30 }
        }
      }
    ]
  }
})
```

- [ ] **Step 2: Update index.html**

Replace the entire `<head>` section in `frontend/index.html`:

```html
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
  <meta name="theme-color" content="#FF0000" />
  <meta name="apple-mobile-web-app-capable" content="yes" />
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
  <meta name="apple-mobile-web-app-title" content="YouTube" />
  <link rel="apple-touch-icon" href="/icon-180.png" />
  <link rel="icon" href="/icon.svg" type="image/svg+xml" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Roboto:wght@300;400;500;700&display=swap" rel="stylesheet" />
  <title>YouTube</title>
</head>
```

- [ ] **Step 3: Rebuild and verify in browser**

```bash
docker compose build frontend && docker compose up -d frontend
```

Open the app in Chrome. In DevTools → Application → Manifest, verify:
- Name: "YouTube"
- Theme color: #FF0000
- Icons show the correct PNGs

- [ ] **Step 4: Commit**

```bash
git add frontend/vite.config.js frontend/index.html
git commit -m "feat: update PWA metadata — name YouTube, red theme, new icons"
```

---

## Task 4: Add relatedVideos to PlayerContext

**Files:**
- Modify: `frontend/src/contexts/PlayerContext.jsx`

- [ ] **Step 1: Add relatedVideos state and setter**

In `frontend/src/contexts/PlayerContext.jsx`, make these changes:

Add after the `nextVideo` state line (line 8):
```js
const [relatedVideos, setRelatedVideos] = useState([]); // [{ video_id, title, thumbnail_url, channel_name, duration_seconds }]
```

Update `openVideo` to clear relatedVideos (replace the existing `openVideo` callback):
```js
const openVideo = useCallback((id) => {
  setVideoId(id);
  setMinimized(false);
  setNextVideo(null);
  setRelatedVideos([]);
}, []);
```

Update `close` to clear relatedVideos (replace the existing `close` callback):
```js
const close = useCallback(() => {
  setVideoId(null);
  setMinimized(false);
  setNextVideo(null);
  setRelatedVideos([]);
  setFullscreen(false);
}, []);
```

Update the `PlayerContext.Provider` value to include the new state:
```jsx
<PlayerContext.Provider value={{
  videoId, minimized, nextVideo, setNextVideo,
  relatedVideos, setRelatedVideos,
  openVideo, minimize, expand, close,
  fullscreen, enterFullscreen, exitFullscreen
}}>
  {children}
</PlayerContext.Provider>
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/contexts/PlayerContext.jsx
git commit -m "feat: add relatedVideos to PlayerContext"
```

---

## Task 5: Wire setRelatedVideos in Watch.jsx

**Files:**
- Modify: `frontend/src/pages/Watch.jsx`

- [ ] **Step 1: Destructure setRelatedVideos**

In `frontend/src/pages/Watch.jsx`, update the `usePlayerContext` destructure (currently line 29):

```js
const { openVideo, setNextVideo, setRelatedVideos, fullscreen } = usePlayerContext();
```

- [ ] **Step 2: Call setRelatedVideos in the related-fetch effect**

Find the `useEffect` that fetches `/api/related/:videoId` (around line 74). Update the `.then` handler to also call `setRelatedVideos`:

```js
.then(data => {
  const videos = data.videos || [];
  setRelated(videos);
  setRelatedFilter('all');
  if (videos.length > 0) setNextVideo(videos[0]);
  setRelatedVideos(videos);
})
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/Watch.jsx
git commit -m "feat: populate relatedVideos in PlayerContext from Watch"
```

---

## Task 6: Add video drawer to MiniPlayer

**Files:**
- Modify: `frontend/src/components/MiniPlayer.jsx`

This task has several sub-steps. Read through all of them before starting.

- [ ] **Step 1: Add relatedVideos and showDrawer state**

Update the `usePlayerContext` destructure at the top of the component (currently line 50):

```js
const {
  videoId, minimized, nextVideo, relatedVideos,
  minimize, expand, close, openVideo,
  fullscreen, enterFullscreen, exitFullscreen
} = usePlayerContext();
```

Add `showDrawer` state after the existing `showSettings` state (around line 84):

```js
const [showDrawer, setShowDrawer] = useState(false);
```

- [ ] **Step 2: Reset showDrawer on video change**

In the existing `useEffect` that resets state on `videoId` change (the one starting at line 95 that calls `setMuted(false)` etc.), add:

```js
setShowDrawer(false);
```

alongside the other resets.

- [ ] **Step 3: Pin controls open while drawer is open**

Add a new `useEffect` after the existing `playing` effect (after line 123):

```js
// Keep controls pinned open while drawer is visible
useEffect(() => {
  if (showDrawer) {
    clearTimeout(controlsTimerRef.current);
    setShowControls(true);
  }
}, [showDrawer]);
```

- [ ] **Step 4: Add the stacked-videos icon button**

In the bottom controls bar, find the row that has the time display, mute button, and fullscreen button (the `<div className="flex items-center px-4 pt-8 pb-1 gap-3">` around line 421).

Add the drawer toggle button between the mute button and the fullscreen button:

```jsx
{/* Drawer toggle — only shown when related videos exist */}
{relatedVideos.length > 0 && (
  <button
    onClick={() => { setShowDrawer(d => !d); setShowSettings(false); resetControlsTimer(); }}
    className={`p-1 ${showControls ? 'pointer-events-auto' : 'pointer-events-none'}`}
    aria-label="Video queue"
  >
    <svg viewBox="0 0 24 24" className={`w-5 h-5 ${showDrawer ? 'fill-white' : 'fill-white/70'}`}>
      <path d="M4 6H2v14c0 1.1.9 2 2 2h14v-2H4V6zm16-4H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-1 9H9V9h10v2zm-4 4H9v-2h6v2zm4-8H9V5h10v2z"/>
    </svg>
  </button>
)}
```

- [ ] **Step 5: Add the drawer panel**

Directly above the `{/* Thin progress line when controls hidden */}` block (around line 473), add the drawer panel:

```jsx
{/* ── Video queue drawer ── */}
{showDrawer && relatedVideos.length > 0 && (
  <div
    className="absolute bottom-12 left-0 right-0 z-30 bg-black/85 backdrop-blur-sm"
    onClick={e => e.stopPropagation()}
  >
    <div className="flex items-center justify-between px-4 pt-3 pb-1">
      <span className="text-white/60 text-xs font-semibold uppercase tracking-wider">Up Next</span>
      <button
        onClick={() => setShowDrawer(false)}
        className="text-white/60 p-1"
        aria-label="Close queue"
      >
        <svg viewBox="0 0 24 24" className="w-4 h-4 fill-current">
          <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
        </svg>
      </button>
    </div>
    <div
      className="flex gap-3 overflow-x-auto px-4 pb-3"
      style={{ scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch' }}
    >
      {relatedVideos.map(video => (
        <button
          key={video.video_id}
          onClick={() => {
            openVideo(video.video_id);
            navigate(`/watch/${video.video_id}`);
            setShowDrawer(false);
          }}
          className="flex-shrink-0 w-28 text-left"
        >
          <div className="relative w-full aspect-video rounded-md overflow-hidden bg-white/10">
            {video.thumbnail_url && (
              <img
                src={video.thumbnail_url}
                alt={video.title}
                className="w-full h-full object-cover"
              />
            )}
          </div>
          <p className="text-white text-xs font-medium mt-1 line-clamp-2 leading-snug">
            {video.title}
          </p>
          <p className="text-white/50 text-xs mt-0.5 line-clamp-1">
            {video.channel_name}
          </p>
        </button>
      ))}
    </div>
  </div>
)}
```

- [ ] **Step 6: Rebuild and smoke-test**

```bash
docker compose build frontend && docker compose up -d frontend
```

Open the app, start playing a video. Tap the screen to show controls. Verify:
1. A queue icon (stacked lines) appears in the bottom right of the controls, between mute and fullscreen
2. Tapping the icon opens the drawer — a dark panel above the seek bar showing related video thumbnails
3. The controls do not auto-hide while the drawer is open
4. Scrolling the drawer left/right works
5. Tapping a video navigates to it and closes the drawer
6. Tapping the queue icon again (or the × in the drawer header) closes the drawer
7. Controls resume auto-hiding after drawer closes

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/MiniPlayer.jsx
git commit -m "feat: add video queue drawer to player controls"
```

---

## Task 7: Final verification + PR

- [ ] **Step 1: On iOS/iPad — verify icon**

Add the app to your home screen (Share → Add to Home Screen). The icon should show the red YouTube logo on a white background, labeled "YouTube".

- [ ] **Step 2: On iOS — verify drawer**

Open the app from the home screen (standalone mode). Play a video. Tap to show controls. Verify the drawer icon and behavior work correctly in standalone PWA mode (swipe-to-minimize, autoplay countdown, and drawer should all coexist).

- [ ] **Step 3: Open a PR**

```bash
git push origin HEAD
# then open PR against main
```
