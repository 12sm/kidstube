# KidsTube

A parent-controlled YouTube app for kids. Parents approve channels and configure filters — the app
handles everything else: nightly video ingestion, multi-pass content filtering (keywords + AI), 
personalized feeds based on watch behavior, and a YouTube-style UI that kids already know how to use.

No ads. No algorithm rabbit holes. No comments. Just the videos you've approved.

## What it does

**For kids:**
- YouTube-style feed with videos from parent-approved channels only
- Multiple child profiles with isolated watch history, interests, and recommendations
- Personalized feed that learns from watch behavior (likes, watch time, completion)
- Voice search with speech-to-text (works on iOS Safari and desktop Chrome)
- Search across the approved library + live YouTube (results go through the filter pipeline)
- Continue watching, watch history, and category filtering
- Installable as a PWA on phones, tablets, and desktops
- Mini player that keeps playing while browsing

**For parents:**
- Full admin panel behind a password — kids never see it
- Nightly pipeline fetches new videos from whitelisted channels, filters out shorts/livestreams/flagged content, and runs an AI appropriateness check (Claude Haiku)
- Per-child analytics: watch time by day/hour, top tags, trending interests
- Feed tuning: per-tag multipliers, hard caps, and a behavior ceiling to prevent hyperfixation
- AI-generated insights about each child's watching patterns (daily observations, weekly summary)
- Automatic channel recommendations based on a child's interests
- Channel discovery from YouTube subscriptions, by URL, or via a browser bookmarklet
- Interview-based child profile generation (age, interests, things to avoid)
- Keyword block rules scoped by field (title/description/transcript) and by profile
- Manual approve/reject override for any video
- Dry-run mode for pipeline jobs with cost estimation before running

## Architecture

```
                        ┌──────────────┐
  Phone / Tablet / TV   │  Frontend    │  React + Vite + Tailwind
  (PWA or browser)  ───>│  nginx :3000 │  YouTube-style responsive UI
                        └──────┬───────┘
                               │
                        ┌──────┴───────┐
                        │  Backend     │  Node.js + Express
                        │  :3001       │  REST API + SSE job streaming
                        └──────┬───────┘
                               │
                ┌──────────────┼──────────────┐
                │              │              │
         ┌──────┴──────┐ ┌────┴────┐  ┌──────┴──────┐
         │  SQLite DB  │ │ YouTube │  │  Invidious  │
         │  ./data/    │ │ Data API│  │  :3080      │
         └─────────────┘ └─────────┘  │  + Companion│
                                      └─────────────┘
```

**Docker Compose** runs five services:
- **Backend** — Node.js API + nightly cron pipeline
- **Frontend** — Vite build served by nginx
- **Invidious** — YouTube stream resolver (unthrottled CDN URLs)
- **Invidious Companion** — BotGuard/PO token generation
- **PostgreSQL** — Invidious metadata store

The app database is SQLite (`./data/kidstube.db`), bind-mounted so it persists across container rebuilds.

## Content pipeline

Every night at 2 AM (configurable):

1. **Subscription sync** — pulls channels from your linked Google account
2. **Watch history discovery** — finds new channels from what kids watched yesterday
3. **RSS fetch** — checks whitelisted channels for new uploads (26-hour lookback)
4. **Filter pass 1** — rejects shorts, livestreams, and keyword-matched content
5. **Filter pass 2** — Claude Haiku reviews remaining videos for age-appropriateness and assigns topic tags
6. **Channel backfill** — fetches up to 50 recent uploads from newly added channels
7. **Related videos** — discovers related content for newly approved videos

You can trigger a full or incremental run from the admin panel at any time.

## Recommendation engine

The feed isn't random — it adapts to each child:

- Videos are tagged with canonical topics (~150 tags across gaming, education, animals, shows, etc.)
- Watch time, completions, and like/dislike reactions build a per-profile interest model
- Feed scoring factors in interest weight, tag overlap, same-channel affinity, and completion rate
- A **diversity pool** (1/3 of the feed) surfaces content outside dominant interests
- Max 2 videos per channel per page prevents any single channel from dominating
- Parents can tune per-tag multipliers (0-3x), set hard caps, and adjust the behavior ceiling

---

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/) + Docker Compose
- A Google account to create API credentials
- (Optional) An [Anthropic API key](https://console.anthropic.com/) for the AI content filter
- (Optional) An [OpenAI API key](https://platform.openai.com/) for voice search (Whisper STT)

---

## Setup

### 1. Clone the repo

```bash
git clone https://github.com/12sm/kidstube.git
cd kidstube
```

### 2. Create your `.env` file

```bash
cp .env.example .env
```

Open `.env` and fill in each value (see **API Keys** below for where to get them):

```env
GOOGLE_CLIENT_ID=        # from Google Cloud Console
GOOGLE_CLIENT_SECRET=    # from Google Cloud Console
GOOGLE_REDIRECT_URI=http://localhost:3001/auth/callback
FRONTEND_URL=http://localhost:3000

YOUTUBE_API_KEY=         # YouTube Data API v3 key
ANTHROPIC_API_KEY=       # optional — AI filter is skipped if absent
OPENAI_API_KEY=          # optional — enables voice search (Whisper STT)

ENCRYPTION_KEY=          # 64 hex characters (32 bytes) — generate with: openssl rand -hex 32
ADMIN_PASSWORD=          # parent-only admin panel password
JWT_SECRET=              # any random 32+ character string
```

> **Note on `GOOGLE_REDIRECT_URI` and `FRONTEND_URL`:** If you are running on a remote machine or
> want to access the app from other devices on your network, replace `localhost` with your machine's
> local IP address (e.g. `192.168.1.42`). The redirect URI must also be added to your Google OAuth
> client's **Authorized redirect URIs** list (see step 3).

### 3. Google API credentials

1. Go to [Google Cloud Console](https://console.cloud.google.com/) and create a project.
2. Enable the **YouTube Data API v3** under APIs & Services > Library.
3. Go to APIs & Services > Credentials > Create Credentials > **OAuth 2.0 Client ID**.
   - Application type: **Web application**
   - Authorized redirect URIs: add the value you put in `GOOGLE_REDIRECT_URI`
     (e.g. `http://localhost:3001/auth/callback`)
4. Copy the Client ID and Client Secret into `.env`.
5. Create a separate **API Key** credential and copy it into `YOUTUBE_API_KEY`.

### 4. Generate an encryption key

```bash
openssl rand -hex 32
```

Paste the output into `.env` as `ENCRYPTION_KEY`.

### 5. Start the app

```bash
docker compose up -d
```

The first build takes a few minutes. Once healthy:

- **App:** http://localhost:3000
- **Admin panel:** http://localhost:3000/admin

### 6. Connect your Google account

Open the admin panel at `/admin`, enter your `ADMIN_PASSWORD`, and click **Connect Google Account**.
This grants the app read-only access to your YouTube subscriptions so it can import channels.

### 7. Import channels and run the pipeline

1. Go to Admin > **Channels** and import from your subscriptions, add by URL, or use the bookmarklet.
2. Hit **Run Nightly Refresh Now** to process videos immediately (or wait for the 2 AM cron).
3. Create child profiles under Admin > **Settings**.

Kids can now open the app, pick their profile, and start watching.

---

## Accessing from phones and tablets

If you're accessing the app from another device on your network:

1. Find your machine's local IP: `ip addr` (Linux) or `ifconfig` (Mac)
2. In `.env`, set:
   ```
   GOOGLE_REDIRECT_URI=http://192.168.1.42:3001/auth/callback
   FRONTEND_URL=http://192.168.1.42:3000
   ```
3. Add the redirect URI to your Google OAuth client's authorized redirect URIs.
4. Rebuild: `docker compose build backend && docker compose up -d backend`
5. Access the app at `http://192.168.1.42:3000`

The app is a PWA — on iOS, open in Safari and tap **Share > Add to Home Screen** for a full-screen app experience. On Android, Chrome will prompt to install it automatically.

---

## Rebuilding after changes

```bash
# After frontend changes:
docker compose build frontend && docker compose up -d frontend

# After backend changes:
docker compose build backend && docker compose up -d backend

# Full rebuild:
docker compose up -d --build
```

---

## Environment variables reference

| Variable | Required | Description |
|---|---|---|
| `GOOGLE_CLIENT_ID` | Yes | OAuth 2.0 client ID from Google Cloud Console |
| `GOOGLE_CLIENT_SECRET` | Yes | OAuth 2.0 client secret |
| `GOOGLE_REDIRECT_URI` | Yes | Must match an authorized URI in your OAuth client |
| `FRONTEND_URL` | Yes | Base URL of the frontend (used for CORS and OAuth redirect) |
| `YOUTUBE_API_KEY` | Yes | YouTube Data API v3 key |
| `ANTHROPIC_API_KEY` | No | Enables AI content filter (Claude Haiku). Skipped if absent. |
| `OPENAI_API_KEY` | No | Enables voice search via Whisper. Skipped if absent. |
| `ENCRYPTION_KEY` | Yes | 64 hex chars (32 bytes) for OAuth token encryption |
| `ADMIN_PASSWORD` | Yes | Password for the `/admin` panel |
| `JWT_SECRET` | Yes | Secret for admin session tokens (32+ chars) |
| `PORT` | No | Backend port (default: `3001`) |
| `CRON_SCHEDULE` | No | Nightly job schedule in cron syntax (default: `0 2 * * *`) |
| `LLM_PROVIDER` | No | `anthropic` (default) or `ollama` for local LLM |
| `OLLAMA_URL` | No | Ollama endpoint if using `LLM_PROVIDER=ollama` |

---

## License

MIT
