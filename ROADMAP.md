# KidsTube — Roadmap

## ✅ Phase 1 — Core Infrastructure (Complete)
- [x] Docker Compose setup (frontend + backend containers)
- [x] SQLite DB schema — profiles, videos, channels, filter_rules, watch_history
- [x] Google OAuth flow + encrypted token storage
- [x] YouTube Data API integration (subscriptions, channel videos)
- [x] RSS polling fallback (26h lookback)
- [x] yt-dlp metadata + transcript fetching
- [x] Pass 1 filter: keyword + channel blocklist
- [x] Pass 2 filter: Claude Haiku LLM appropriateness check (scaffolded, needs ANTHROPIC_API_KEY)
- [x] Nightly cron batch orchestrator
- [x] Admin panel — filter log, channel manager, manual refresh trigger

## ✅ Phase 2 — Player & UX Polish (Complete)
- [x] Persistent MiniPlayer — full / minimized / landscape modes
- [x] Muted autoplay + "Tap to unmute" button (iOS PWA workaround)
- [x] Landscape detection → auto fullscreen; portrait → single video page
- [x] Swipe-down to minimize player
- [x] YouTube logo blocker (prevents launching YouTube app)
- [x] `fs=0` embed param — prevents iOS native fullscreen hijack / state loss
- [x] Autoplay countdown (5s) between related videos
- [x] End-screen overlay — horizontally scrollable shelf of curated related videos replaces YouTube's end cards
- [x] Watch history — records immediately on open, updates every 15s, saves on unmount
- [x] "Continue Watching" shelf (5–95% progress filter)
- [x] "You" page — YouTube-style profile header, history shelf, continue watching
- [x] Full History page — date-grouped, searchable, with per-video remove/not-interested
- [x] "Not Interested" — blocks video from feed + removes from history (`video_block` filter rule)
- [x] Pull-to-refresh on home feed
- [x] Video preview on scroll (hover/dwell 3.5s in feed)
- [x] Brand consistent — all UI shows "YouTube" not "KidsTube"

## 🔲 Phase 3 — Per-Profile Rules & Admin Improvements
- [ ] Per-profile channel whitelist/blocklist management in admin UI
- [ ] Per-profile keyword rules (beyond global rules)
- [ ] Cron run history in admin — timestamps, videos processed, filter pass/fail counts
- [ ] Manual "refresh now" per channel (not just global)
- [ ] Admin: ability to approve/reject individual pending videos
- [ ] Scheduled digest — weekly summary of what kids watched (email or push notification)

## 🔲 Phase 4 — React Native App (Roadmap)
**Why**: iOS PWA has two hard limitations — sound autoplay is blocked and haptic feedback is unavailable. Both are solved by wrapping in a native shell.

**What**: Bare React Native app with a single `WebView` pointing at the existing server.
- `mediaPlaybackRequiresUserAction={false}` → true autoplay with sound
- `ReactNativeHapticFeedback` → real physical haptics
- No frontend rewrite needed — WebView renders the existing React app

**Requirements**:
- Mac + Xcode
- Apple Developer account ($99/yr) — needed even for family sideloading via AltStore/TestFlight
- Same backend server, no changes needed

## 🔲 Phase 5 — Offline & PWA Hardening
- [ ] Service worker caching for feed thumbnails + metadata
- [ ] Offline fallback page
- [ ] Background sync for watch history when connectivity resumes
- [ ] iOS "Add to Home Screen" install prompt / onboarding
