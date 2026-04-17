# KidsTube

A parent-controlled YouTube PWA for kids. Videos are curated nightly — parents approve channels,
the app filters out shorts, live streams, and flagged content, and kids get a clean feed that looks
and feels like the native YouTube app.

Built with React + Vite (frontend), Node.js + Express + SQLite (backend), served via Docker Compose.

---

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/) + Docker Compose
- A Google account to create API credentials
- (Optional) An Anthropic API key for the LLM content filter

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
ANTHROPIC_API_KEY=       # optional — LLM filter is skipped if absent or placeholder

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
2. Enable the **YouTube Data API v3** under APIs & Services → Library.
3. Go to APIs & Services → Credentials → Create Credentials → **OAuth 2.0 Client ID**.
   - Application type: **Web application**
   - Authorized redirect URIs: add the value you put in `GOOGLE_REDIRECT_URI`
     (e.g. `http://localhost:3001/auth/callback`)
4. Copy the Client ID and Client Secret into `.env`.
5. Create a separate **API Key** credential and copy it into `YOUTUBE_API_KEY`.

### 4. Generate an encryption key

The `ENCRYPTION_KEY` must be exactly 64 hex characters (32 bytes). Generate one with:

```bash
openssl rand -hex 32
```

Paste the output into `.env` as `ENCRYPTION_KEY`.

### 5. Start the app

```bash
docker compose up -d
```

The first build takes a few minutes. Once healthy:

- **App (kids):** http://localhost:3000
- **Admin panel:** http://localhost:3000/admin

### 6. Connect your Google account

Open the admin panel at `/admin`, enter your `ADMIN_PASSWORD`, and click **Connect Google Account**.
This grants the app access to your YouTube subscriptions so it can pull in channels and videos.

---

## Adding channels and running the pipeline

After connecting your Google account, go to Admin → **Import from Subscriptions** to pull in your
YouTube subscriptions as channels. You can also add channels manually by URL or channel ID.

The nightly cron job (default: 2 AM) fetches new videos, runs them through the filter pipeline
(shorts detection → live detection → keyword filter → LLM check), and makes approved videos
available in the feed.

To run the pipeline immediately: Admin → **Run Nightly Refresh Now**.

---

## Rebuilding after changes

```bash
# After frontend changes (JS/CSS/HTML):
docker compose build frontend && docker compose up -d frontend

# After backend changes (server, cron, filters):
docker compose build backend && docker compose up -d backend
```

---

## Notes for non-localhost installs

If you're accessing the app from another device (phone, tablet) on your network:

1. Find your machine's local IP: `ip addr` (Linux) or `ifconfig` (Mac) — e.g. `192.168.1.42`
2. In `.env`, set:
   ```
   GOOGLE_REDIRECT_URI=http://192.168.1.42:3001/auth/callback
   FRONTEND_URL=http://192.168.1.42:3000
   ```
3. Add `http://192.168.1.42:3001/auth/callback` to your Google OAuth client's authorized redirect URIs.
4. Rebuild the backend: `docker compose build backend && docker compose up -d backend`
5. Access the app at `http://192.168.1.42:3000`

> The admin panel's **Import via Bookmarklet** feature also hardcodes a URL — if you use it,
> update the URL in the bookmarklet to match your machine's address.

---

## Environment variables reference

| Variable | Required | Description |
|---|---|---|
| `GOOGLE_CLIENT_ID` | Yes | OAuth 2.0 client ID from Google Cloud Console |
| `GOOGLE_CLIENT_SECRET` | Yes | OAuth 2.0 client secret |
| `GOOGLE_REDIRECT_URI` | Yes | Must match an authorized URI in your OAuth client |
| `FRONTEND_URL` | Yes | Base URL of the frontend — used for CORS and OAuth redirect |
| `YOUTUBE_API_KEY` | Yes | YouTube Data API v3 key for subscription/channel data |
| `ANTHROPIC_API_KEY` | No | Enables LLM content filter (Claude Haiku). Skipped if absent. |
| `ENCRYPTION_KEY` | Yes | 64 hex chars (32 bytes) — encrypts stored OAuth tokens |
| `ADMIN_PASSWORD` | Yes | Password for the `/admin` panel |
| `JWT_SECRET` | Yes | Secret for admin session tokens (32+ chars) |
| `PORT` | No | Backend port (default: 3001) |
| `CRON_SCHEDULE` | No | Nightly job schedule in cron syntax (default: `0 2 * * *`) |
| `LLM_PROVIDER` | No | `anthropic` (default) or `ollama` |
| `OLLAMA_URL` | No | Ollama endpoint if `LLM_PROVIDER=ollama` |
