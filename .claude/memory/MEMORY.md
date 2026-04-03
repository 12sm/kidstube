# KidsTube Project Memory

## Project Overview
Parent-controlled YouTube PWA. Child profiles: Child1 (ID 5) and Child2 (ID 6).
Nightly batch processing, no real-time filtering. UI styled to look like the YouTube app.

## Status: Phase 1 + 2 Complete
- Docker infrastructure: ports 3000 (frontend), 3001 (backend)
- DB: SQLite at `./data/kidstube.db` (bind mount, persists)
- CLAUDE.md and ROADMAP.md created at repo root

## Key Files
- `backend/src/server.js` — Express app, all routes
- `backend/src/db.js` — SQLite layer (better-sqlite3)
- `backend/src/cron.js` — Nightly batch orchestrator
- `backend/src/auth.js` — Google OAuth + AES-256-CBC token encryption
- `backend/src/youtube.js` — YouTube Data API
- `backend/src/filter.js` — Pass 1: keyword + channel block filter
- `backend/src/llm.js` — Pass 2: Claude Haiku LLM check (needs real ANTHROPIC_API_KEY)
- `frontend/src/App.jsx` — Router, ProfileContext, routes
- `frontend/src/contexts/PlayerContext.jsx` — Global player state
- `frontend/src/components/MiniPlayer.jsx` — Full/mini/landscape player
- `frontend/src/pages/Watch.jsx` — Video page + end-screen overlay
- `frontend/src/pages/Home.jsx` — Main feed
- `frontend/src/pages/Library.jsx` — "You" page
- `frontend/src/pages/History.jsx` — Full history page
- `frontend/src/pages/Admin.jsx` — Admin panel

## Docker Workflow
- After frontend changes: `docker compose build frontend && docker compose up -d frontend`
- After backend changes: `docker compose build backend && docker compose up -d backend`
- Alpine resolves `localhost` → IPv6 — use `127.0.0.1` in healthchecks
- Local Node v25 — better-sqlite3 won't install locally, fine in Docker (Node 20)

## Completed Features (Phase 2)
- MiniPlayer: full/mini/landscape modes, muted autoplay + unmute button, swipe-to-minimize
- `fs=0` embed param prevents iOS native fullscreen hijack
- YouTube logo blocker (transparent z-20 div, bottom-right corner)
- End-screen overlay: horizontal scroll shelf of curated related videos (replaces YouTube end cards)
- Video end detection: postMessage `onStateChange` info===0
- Watch history: records immediately, every 15s, and on unmount
- "Continue Watching" shelf (5–95% progress), full History page with search + date groups
- "Not Interested": inserts `video_block` filter rule + removes from history
- Pull-to-refresh, video preview on scroll dwell (3.5s, 75% visible)
- All UI says "YouTube" not "KidsTube"

## UX Polish (Mar 14 2026)
See `project_ux_polish_session.md` for full details. Summary of what changed:
- Home feed: single-column on phone, 3-col on iPad (`lg:grid-cols-3`), edge-to-edge thumbnails, pill-shaped filter chips
- VideoCard: no `rounded-xl` on thumbnail, added `px-3 pb-4` to info row
- Watch page: restructured info section + added Like/Dislike/Share/Save action bar
- Next: fix MiniPlayer header overlay on Watch page, add back channel avatar subscription row

## Phase 3 Next Steps
- Per-profile channel/keyword rules in admin
- Cron run history in admin panel
- Manual per-channel refresh
- Admin approve/reject individual videos

## Roadmap (Future)
- **React Native WebView wrapper** — `mediaPlaybackRequiresUserAction={false}` fixes iOS autoplay sound + haptics. Needs Mac + Xcode + Apple Developer ($99/yr). No frontend rewrite.

## Known PWA Limitations (iOS Safari)
- Sound autoplay blocked — workaround: mute=1 + "Tap to unmute" postMessage
- Haptic feedback unavailable — navigator.vibrate not supported, AudioContext trick silent
- Both fixed by React Native wrapper (Phase 4)

## Infrastructure Note (Mar 2026)
Project moved from Mac local dev to Ubuntu dev machine. Repo is now in git.

## Roku Dev Device
- [roku_device.md](roku_device.md) — IP, username, password for dev sideload uploads

## Claude Install — Ubuntu Dev Server
- `claude` binary is at `/home/michael/.local/bin/claude` — not in PATH over non-interactive SSH sessions
- Fix: use `bash -i -c '...'` to invoke as interactive shell, or just log in directly (PATH loads from `.bashrc`)
- Plugin gaps vs Mac: missing `commit-commands`, `context7`; has `code-review` and `superpowers` that Mac doesn't
- Mac (v2.1.86) plugins: `frontend-design`, `playwright`, `commit-commands`, `context7`
- Ubuntu plugins: `frontend-design`, `playwright`, `code-review`, `superpowers`
- Goal: sync both machines to have all 6 plugins
