# KidsTube — Claude Code Instructions

## Session Memory
Project history and context live in `.claude/memory/` (tracked in git, travels with the repo).
Read `.claude/memory/MEMORY.md` at the start of any session to get up to speed.
Write new memories there — not to `~/.claude/projects/` — so all machines share the same context.

## Autonomous Work Backlog
`BACKLOG.md` (repo root) — tasks approved for overnight Claude Code sessions. Read it at the start
of any session to see what's queued. Overnight sessions pick the top TODO, implement it, open a PR.

## Project Summary
Parent-controlled YouTube PWA for kids (profiles: Child1 and Child2, profile IDs 5 and 6).
Videos are curated nightly via a batch pipeline — no real-time filtering.
The UI is intentionally styled to look and feel like the native YouTube app.

## Stack
- **Frontend**: React 18 + Vite + Tailwind CSS, served via nginx
- **Backend**: Node.js + Express + better-sqlite3 (SQLite)
- **Infrastructure**: Docker Compose (frontend port 3000, backend port 3001)
- **DB**: SQLite at `./data/kidstube.db` (bind-mounted, persists across rebuilds)

## Running the Project
```bash
docker compose up -d           # start both containers
docker compose build frontend  # rebuild frontend after JS/CSS changes
docker compose build backend   # rebuild backend after server/db changes
docker compose down            # stop everything
```

After any frontend file change: `docker compose build frontend && docker compose up -d frontend`
After any backend file change: `docker compose build backend && docker compose up -d backend`

## Key Files
| File | Purpose |
|------|---------|
| `backend/src/server.js` | Express app, all API routes |
| `backend/src/db.js` | SQLite layer (better-sqlite3) |
| `backend/src/cron.js` | Nightly batch orchestrator |
| `backend/src/auth.js` | Google OAuth + AES-256-CBC token encryption |
| `backend/src/youtube.js` | YouTube Data API (subscriptions, channel videos) |
| `backend/src/rss.js` | YouTube RSS polling (26h lookback) |
| `backend/src/ytdlp.js` | yt-dlp metadata + transcript fetching |
| `backend/src/filter.js` | Pass 1: keyword + channel block filter |
| `backend/src/llm.js` | Pass 2: Claude Haiku LLM appropriateness check |
| `frontend/src/App.jsx` | Router, ProfileContext, route definitions |
| `frontend/src/contexts/PlayerContext.jsx` | Global video player state |
| `frontend/src/components/MiniPlayer.jsx` | Persistent video player (full/mini/landscape) |
| `frontend/src/pages/Watch.jsx` | Single video page + end-screen overlay |
| `frontend/src/pages/Home.jsx` | Main feed |
| `frontend/src/pages/Library.jsx` | "You" page — profile, history shelf, continue watching |
| `frontend/src/pages/History.jsx` | Full watch history with search + date grouping |
| `frontend/src/pages/Admin.jsx` | Admin panel (filter log, channel manager, manual refresh) |

## Docker Notes
- Alpine Linux resolves `localhost` → IPv6 `::1` — always use `127.0.0.1` in healthchecks
- Frontend build context is repo root (not `./frontend`) so `nginx.conf` at root is accessible
- Local Node is v25 — `better-sqlite3` won't install locally, works fine in Docker (Node 20)

## Environment Variables (`.env`)
```
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=
YOUTUBE_API_KEY=
ANTHROPIC_API_KEY=      # optional — LLM filter skipped if placeholder
ENCRYPTION_KEY=         # AES-256 key for token storage
SESSION_SECRET=
```

## Profile IDs
- Child1 = profile ID 5
- Child2 = profile ID 6

## Coding Conventions
- Tailwind custom tokens: `yt-bg`, `yt-text`, `yt-muted`, `yt-card`, `yt-surface`, `yt-border`, `yt-hover`, `yt-red`
- All UI references say "YouTube" not "KidsTube" (brand rename completed)
- iOS safe area: use `env(safe-area-inset-top/bottom)` — MiniPlayer reads it synchronously via `readSafeArea()` to avoid layout flash
- YouTube iframe embeds: always use `mute=1&autoplay=1&playsinline=1&fs=0&enablejsapi=1`
- Video end detection: postMessage `onStateChange` with `info === 0`
- Progress tracking: postMessage `infoDelivery` → `info.currentTime` / `info.duration`
