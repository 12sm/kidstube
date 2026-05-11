# KidsTube — Autonomous Work Backlog

Tasks in this file are approved for overnight Claude Code sessions. One task per session.

**Overnight session workflow:**
1. Read `## IN REVIEW` first — if a task is already listed there, a PR is open and waiting for human review. Do not start new work. Stop.
2. Pick the top item from `## TODO`.
3. Implement it completely and open a PR.
4. Move the task entry from `## TODO` to `## IN REVIEW` in this file. Commit that change on the PR branch so the update lands in the PR.

---

## IN REVIEW

---

## TODO

---

### TASK: Build a KidsTube iOS app (Capacitor wrapper)

**Session type:** Single-evening autonomous implementation — no human input required mid-run.
**Outcome:** Native iOS app on TestFlight for family iPads, with fully unmuted autoplay via WKWebView config.
**Prerequisite (human):** Mac with Xcode 15+ and an active Apple Developer account ($99/yr) logged in. The agent cannot complete Xcode login — verify before kicking off this session.

---

#### 0. Prerequisites — verify before writing a single line of code

- **Mac + Xcode 15+** installed from the App Store. Verify: `xcodebuild -version`
- **Xcode Command Line Tools:** `xcode-select --install`
- **CocoaPods 1.14+:** `sudo gem install cocoapods` (verify: `pod --version`)
- **Apple Developer account** ($99/year) active at https://developer.apple.com. Logged into Xcode Preferences → Accounts.
- **App ID created** in Apple Developer Portal: Identifiers → App IDs → "+", bundle ID `com.kidstube.app`.
- **Server LAN IP known** — Docker stack must be running and reachable on the LAN (e.g. `192.168.1.100`). The iPad must be on the same Wi-Fi at runtime. Determine this IP before starting.

---

#### 1. Install Capacitor

From `frontend/`:

```bash
cd /home/michael/projects/kidstube/frontend
npm install @capacitor/core
npm install --save-dev @capacitor/cli
npm install @capacitor/ios
npx cap init "KidsTube" "com.kidstube.app" --web-dir dist
```

---

#### 2. Create `frontend/capacitor.config.ts`

Replace the generated file with:

```typescript
import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.kidstube.app',
  appName: 'KidsTube',
  webDir: 'dist',
  server: {
    url: 'http://192.168.1.100:3000',   // ← REPLACE with actual server LAN IP
    cleartext: true,                     // allow HTTP in WKWebView
  },
  ios: {
    scheme: 'kidstube',
    backgroundColor: '#0f0f0f',
    preferredContentMode: 'mobile',
    scrollEnabled: false,
    limitsNavigationsToAppBoundDomains: false,
  },
};

export default config;
```

Using `server.url` loads the live nginx server instead of bundled files — no re-sync needed after frontend changes. The iPad must be on the same Wi-Fi as the server at runtime.

---

#### 3. Add iOS platform and initial sync

```bash
npx cap add ios
npm run build
npx cap sync ios
```

`npx cap sync ios` also runs `pod install`. Expected: CocoaPods output, no errors.

---

#### 4. Create `frontend/ios/App/App/CustomViewController.swift`

```swift
import UIKit
import Capacitor
import WebKit

class CustomViewController: CAPBridgeViewController {

    override func webViewConfiguration() -> WKWebViewConfiguration {
        let config = super.webViewConfiguration()
        // Allow unmuted autoplay — this is the sole reason for the native wrapper
        config.mediaTypesRequiringUserActionForPlayback = []
        config.allowsInlineMediaPlayback = true
        config.allowsAirPlayForMediaPlayback = false
        return config
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        webView?.scrollView.bounces = false
        webView?.scrollView.alwaysBounceVertical = false
        webView?.scrollView.pinchGestureRecognizer?.isEnabled = false
    }
}
```

---

#### 5. Register `CustomViewController` in the storyboard

Edit `frontend/ios/App/App/Base.lproj/Main.storyboard`. Find the line containing `customClass="CAPBridgeViewController" customModule="Capacitor"` and replace it with:

```xml
customClass="CustomViewController" customModule="App"
```

---

#### 6. Add ATS exception to `frontend/ios/App/App/Info.plist`

Add inside the root `<dict>`:

```xml
<key>NSAppTransportSecurity</key>
<dict>
    <key>NSAllowsArbitraryLoads</key>
    <true/>
</dict>
```

Also set `CFBundleDisplayName` to `Videos`.

---

#### 7. Re-enable autoplay in `frontend/src/components/MiniPlayer.jsx`

The `src` URL was previously stripped of `autoplay=1` as a browser-Safari workaround. Now that WKWebView allows unmuted autoplay, restore it. Find the `src` constant and change it to:

```javascript
// autoplay=1 without mute=1 works here because WKWebView is configured
// with mediaTypesRequiringUserActionForPlayback = [] in CustomViewController.swift
const src =
  `https://www.youtube.com/embed/${videoId}` +
  `?autoplay=1&playsinline=1&rel=0&modestbranding=1&fs=0` +
  `&cc_load_policy=0&iv_load_policy=3&controls=0&enablejsapi=1`;
```

Also restore initial `playing` state to `true` and `muted` state to `false` since autoplay will fire immediately.

Then rebuild and re-sync:

```bash
npm run build && npx cap sync ios
```

---

#### 8. Xcode configuration

Open `frontend/ios/App/App.xcworkspace` (always the `.xcworkspace`, not `.xcodeproj`).

- **Signing:** Team → select Apple Developer account. Bundle ID: `com.kidstube.app`. Enable "Automatically manage signing".
- **Deployment target:** iOS 15.0
- **Orientations:** Check all four (Portrait, Upside Down, Landscape Left, Landscape Right)
- **Devices:** iPad only (uncheck iPhone)

---

#### 9. Simulator test

Select an iPad simulator → Cmd+R. Verify:
- Profile select screen loads from the LAN server
- Selecting a profile → Home feed loads with video thumbnails
- Opening a video → starts playing **with audio immediately** (no tap required)

---

#### 10. Archive and upload to TestFlight

1. Device picker → "Any iOS Device (arm64)"
2. Product → Archive (2–5 min)
3. Organizer → Validate App
4. Distribute App → App Store Connect → Upload
5. App Store Connect → My Apps → create app record (if first upload): platform iOS, bundle ID `com.kidstube.app`
6. TestFlight tab → wait for "Ready to Submit" (~15 min processing)
7. Internal Testing → create group → add family Apple IDs → submit build
8. Family installs TestFlight app → accepts invitation → installs KidsTube

---

#### Files created/modified

| Action | Path |
|--------|------|
| Create | `frontend/capacitor.config.ts` |
| Create (via cap add ios) | `frontend/ios/` entire directory |
| Create | `frontend/ios/App/App/CustomViewController.swift` |
| Modify | `frontend/ios/App/App/Base.lproj/Main.storyboard` |
| Modify | `frontend/ios/App/App/Info.plist` |
| Modify | `frontend/src/components/MiniPlayer.jsx` |

No changes to backend, Docker Compose, or nginx.conf.

---

#### Gotchas

- **Code signing:** Xcode must be logged into Apple ID before the session. If team selector is blank, `xcodebuild archive` fails — requires human login, can't be scripted.
- **CocoaPods:** Must be installed before `npx cap add ios`. Apple Silicon Macs may need `sudo arch -x86_64 gem install cocoapods`.
- **`cleartext: true` AND `NSAllowsArbitraryLoads` are both required** — one without the other still blocks HTTP.
- **Storyboard `customClass` must match Swift class name exactly** — mismatch causes startup crash "Unknown class CustomViewController in Interface Builder file".
- **`server.url` = no offline support** — if the Docker stack is down the app shows a blank screen. Acceptable for family use.
- **TestFlight processing time** — 10–30 min after upload before build is testable. Agent can't speed this up.
- **Backend connectivity is automatic** — relative `/api/` paths resolve through nginx proxy identically to the browser. No API URL changes needed.

---

#### Acceptance criteria

- [ ] `capacitor.config.ts` exists with `appId: 'com.kidstube.app'`
- [ ] `CustomViewController.swift` exists with `mediaTypesRequiringUserActionForPlayback = []`
- [ ] `Main.storyboard` references `CustomViewController` not `CAPBridgeViewController`
- [ ] `Info.plist` has `NSAllowsArbitraryLoads = true`
- [ ] `MiniPlayer.jsx` embed URL includes `autoplay=1` without `mute=1`
- [ ] App runs in iPad Simulator — video plays with audio without a tap
- [ ] `xcodebuild archive` exits 0
- [ ] Build appears in App Store Connect TestFlight as "Ready to Submit"

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
