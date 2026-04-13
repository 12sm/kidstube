# Design: PWA Icon + Videos Drawer

**Date:** 2026-04-13  
**Status:** Approved

---

## 1. PWA App Icon + Metadata

### Goal
Replace the missing `icon-192.png` reference (currently a broken link) with a proper YouTube-style icon set so the app looks identical to the real YouTube app when installed on an iPhone or iPad home screen.

### Icon Design
- White background
- Red rounded rectangle (rx=18), sized to ~80% of the icon area
- White triangle play button centered inside the red shape
- iOS applies its own squircle mask — no pre-baked corner rounding needed

### Files

| File | Purpose |
|------|---------|
| `frontend/public/icon.svg` | Master SVG source |
| `frontend/public/icon-180.png` | 180×180 apple-touch-icon (iOS home screen) |
| `frontend/public/icon-192.png` | 192×192 PWA manifest icon |
| `frontend/public/icon-512.png` | 512×512 PWA splash/install icon |
| `frontend/public/manifest.json` | PWA manifest |

The PNGs are pre-generated from the SVG and committed as static assets — no build-time dependency on sharp or canvas.

### manifest.json fields
- `name`: "YouTube"
- `short_name`: "YouTube"
- `display`: "standalone"
- `background_color`: "#ffffff"
- `theme_color`: "#FF0000"
- `icons`: array pointing to icon-192.png and icon-512.png

### index.html changes
- `<title>` → "YouTube"
- `apple-mobile-web-app-title` → "YouTube"
- `apple-touch-icon` href → `/icon-180.png`
- Add `<link rel="icon" href="/icon.svg" type="image/svg+xml">`
- Add `<link rel="manifest" href="/manifest.json">`

---

## 2. Videos Drawer

### Goal
Add a YouTube-style "Up Next" queue drawer to the video player. When the player controls are visible, a stacked-videos icon appears in the bottom-right of the controls. Tapping it opens a translucent horizontal-scroll panel of related videos inside the video frame. Tapping a video navigates to it; tapping the icon again dismisses.

### Data Flow

**PlayerContext** (`frontend/src/contexts/PlayerContext.jsx`):
- Add `relatedVideos` array (default `[]`) and `setRelatedVideos` setter

**Watch.jsx** (`frontend/src/pages/Watch.jsx`):
- In the existing `useEffect` that fetches `/api/related/:videoId`, call `setRelatedVideos(videos)` alongside the existing `setNextVideo(videos[0])`
- On unmount / video change, the context resets naturally (Watch re-fetches on each `videoId` change)

**MiniPlayer** (`frontend/src/components/MiniPlayer.jsx`):
- Read `relatedVideos` from `usePlayerContext()`
- Add `showDrawer` state (boolean, default false)
- Reset `showDrawer` to false on `videoId` change (in the existing reset `useEffect`)

### Drawer Icon
- Positioned in the bottom controls bar, between the mute button and the fullscreen button
- Only rendered when `relatedVideos.length > 0`
- Icon: three layered small rectangles (stacked videos / queue icon)
- Tapping toggles `showDrawer`; calls `resetControlsTimer()` so controls stay visible

### Drawer Panel
- Absolutely positioned inside the video frame: `bottom-12` (above seek bar), `left-0 right-0`
- Background: `bg-black/80 backdrop-blur-sm`
- Contains a horizontal `overflow-x-auto` scroll shelf, `scrollbar-hide`
- Each item: 120px wide, aspect-video thumbnail + 2-line title below + channel name
- Tapping an item: `openVideo(video.video_id)`, `navigate(/watch/${video.video_id})`, `setShowDrawer(false)`
- Drawer visibility: when `showDrawer` is true, `showControls` is forced to true and the controls auto-hide timer is paused — the drawer keeps the controls layer pinned open. When the drawer closes, the hide timer restarts normally.

### Scope
- Full-player mode only (`showFull`). Not shown in mini-pip mode.
- The Watch page's existing related videos list below the video is unchanged.
- The desktop sidebar (Up Next column) is unchanged.

---

## Implementation Order

1. Generate PNG icons + write manifest.json + update index.html
2. Add `relatedVideos` / `setRelatedVideos` to PlayerContext
3. Wire `setRelatedVideos` call in Watch.jsx
4. Add drawer state + icon button + drawer panel to MiniPlayer
