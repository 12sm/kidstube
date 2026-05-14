# KidsTube — Autonomous Work Backlog

Tasks in this file are approved for overnight Claude Code sessions. One task per session.

**Overnight session workflow:**
1. Read `## IN REVIEW` first — if a task is already listed there, a PR is open and waiting for human review. Do not start new work. Stop.
2. Pick the top item from `## TODO`.
3. Implement it completely and open a PR.
4. Move the task entry from `## TODO` to `## IN REVIEW` in this file. Commit that change **on both the PR branch AND directly to `main`** — the PR branch copy is for the PR record; the `main` copy is what prevents the next overnight session from re-implementing the same task. Push both.

---

## IN REVIEW

### TASK: Build a KidsTube iOS app (Capacitor wrapper)

**PR:** #14 — `claude/overnight-2026-05-13`
**Status:** Linux-side scaffolding complete. Mac required to finish (Xcode signing, `cap sync`, Simulator test, TestFlight upload). See PR description and `frontend/ios/README.md` for the Mac checklist.

---

## TODO

---

## DONE

### Build a KidsTube Roku channel app

**Merged:** PR #12, 2026-05-11

Backend `/api/stream/:videoId` endpoint (yt-dlp, HLS-first, 25-min cache) + full Roku BrightScript channel: ProfileSelect → HomeScene (MarkupGrid, 4-col) → VideoPlayer (HLS/MP4 via `roSGNode Video`). Progress reported every 10s to `/api/watch-history`. Build script at `roku-app/build.sh` substitutes LAN IP and packages sideloadable ZIP.

---

### iPad layout: match YouTube app at 1024×1366 viewport

**Goal:** KidsTube's home feed and channel pages should look like the YouTube Kids iPad app at tablet viewport (1024×1366). The work focuses on the Home page (video grid after profile select) and the Channel page.

**Reference screenshots:** `~/projects/kidstube/screenshots/youtube-ipad/` — 7 PNG files (IMG_1107–IMG_1113). These are screenshots of the actual YouTube app on iPad. Study them first to understand grid density, card layout, spacing, navigation bar sizing, and header treatment.

**Already done (phone):** The mobile layout was iterated extensively — `kidstube-home-mobile.png`, `ipad-*.png` in the repo root show prior work. The iPad layout received some passes but needs another round of polish.

**Flow to reach the feed:**
1. App loads at the profile select screen (`/`)
2. Click any profile avatar — no login required
3. Lands on Home feed (`/home`)

**Files to touch:**
- `frontend/src/pages/Home.jsx` — video grid is `grid grid-cols-1 md:grid-cols-2`; needs a third breakpoint for tablet (likely 3-col at 1024px)
- `frontend/src/pages/Channel.jsx` — same grid treatment; also check header/banner sizing at tablet
- `frontend/src/components/VideoCard.jsx` — thumbnail/title/channel layout; may need padding/font size tweaks at wider cards
- `frontend/src/components/BottomNav.jsx` — on iPad, YouTube uses a left sidebar or larger bottom nav; check if BottomNav needs size changes
- `frontend/src/index.css` — any global responsive rules

**Steps:**

1. Install Playwright if not already installed:
   ```bash
   cd ~/projects/kidstube/frontend
   npm install --save-dev @playwright/test
   npx playwright install chromium
   ```

2. Screenshot KidsTube at iPad viewport:
   Write a one-off script `screenshots/capture-ipad.js` that:
   - Opens `http://localhost:3000` in Chromium at 1024×1366
   - Clicks the first profile avatar
   - Waits for the video grid to load
   - Screenshots to `screenshots/current-ipad-home.png`
   - Navigates to the first channel and screenshots to `screenshots/current-ipad-channel.png`
   Run it: `node screenshots/capture-ipad.js`

3. Visually compare `screenshots/current-ipad-home.png` against `screenshots/youtube-ipad/IMG_1107.PNG` through `IMG_1113.PNG`. List the gaps:
   - Grid columns (YouTube iPad = 3 cols? 4?)
   - Card aspect ratio + thumbnail size
   - Header height and elements
   - Category pill bar (present on YouTube iPad?)
   - Bottom nav bar height/icon size
   - Spacing/padding rhythm

4. Make the CSS/component changes. Likely starting point:
   - Add `lg:grid-cols-3` (or `xl:grid-cols-4`) to the grid in `Home.jsx` and `Channel.jsx`
   - Adjust `VideoCard.jsx` text sizing for wider cards (title may need to show 2 lines at wider width)
   - Increase `BottomNav` icon + text size at `md:` breakpoint if it looks small

5. Rebuild and verify containers are up:
   ```bash
   docker compose build frontend && docker compose up -d frontend
   docker compose ps
   ```

6. Re-run `node screenshots/capture-ipad.js`, compare again. Iterate steps 4–6 until the layout closely matches the reference screenshots.

7. Commit all changes (including `screenshots/capture-ipad.js` and the output PNGs).

**Acceptance criteria:**
- At 1024×1366, the Home feed shows at least 3 columns of video cards
- Card proportions and text density visually match the YouTube iPad reference screenshots
- BottomNav does not look undersized at tablet width
- `docker compose ps` shows both containers healthy after rebuild
- PR opened with before/after screenshots in the description (embed `screenshots/current-ipad-home.png` and one reference image)

**Gotchas:**
- KidsTube's Tailwind config uses default breakpoints: `md` = 768px, `lg` = 1024px. The existing grid uses `md:grid-cols-2`. Adding `lg:grid-cols-3` is the first thing to try.
- The profile select screen is at `/` — after clicking a profile the context is set and it navigates to `/home`. The Playwright script needs to actually click a profile, not navigate directly to `/home` (which will redirect back if no profile is set).
- `VideoCard.jsx` uses a fixed aspect ratio for the thumbnail. At 3-col width, check that the thumbnail doesn't look stretched or too tall.
- Don't break the mobile layout — all changes must be additive at the `lg:` breakpoint only.
- The `screenshots/capture-ipad.js` script is a dev tool; it's fine to commit it to the repo.
