---
name: Roku streaming architecture
description: How Roku video playback works — Invidious proxy chain, what was tried and failed, quality status
type: project
---

Roku video streaming works via self-hosted Invidious (docker-compose, port 3080 internal).

**Working pipeline:** Roku → backend `/api/stream/:videoId` → Invidious `/latest_version?id=X&itag=18` → companion deciphers signature + generates PO token → returns YouTube CDN URL with `ratebypass=yes` + `pot=` → backend `/api/proxy/:videoId` pipes bytes to Roku.

**Why:** The server resolves the URL (server's IP baked into CDN URL). Roku has a different public IP → direct CDN access = 403. Proxy through backend keeps same IP for resolve + fetch.

**Why Invidious:** YouTube requires BotGuard attestation (PO token) for stream URLs. The companion service (`quay.io/invidious/invidious-companion`) handles this via headless browser + jsdom. Without it, IOS client URLs throttle at ~14MB and TV client 403s immediately.

**Current quality:** 360p muxed mp4 (itag 18). Quality upgrade to 720p+ is next priority.

**What failed (2026-04-25):**
- Innertube IOS client direct: throttled at ~14MB
- Innertube TV client: 403 on first byte (no BotGuard)
- yt-dlp ANDROID_VR: URLs work from server but IP mismatch for Roku
- Roku-side Innertube calls: YouTube locked down raw API endpoint
- Hybrid Innertube metadata + yt-dlp URLs: still IP mismatch

**How to apply:** Any future streaming work should go through Invidious, not direct Innertube/yt-dlp. The companion service name in docker-compose is `companion` (not `invidious-companion`). The Invidious storyboard.cr has a bug that crashes `/api/v1/videos/:id` — use `/latest_version` instead.
