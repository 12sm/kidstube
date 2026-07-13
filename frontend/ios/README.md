# KidsTube iOS — Capacitor Wrapper

This is the iOS native shell for the KidsTube PWA. The shell exists for one
reason: WKWebView allows **unmuted autoplay** of YouTube embeds when configured
with `mediaTypesRequiringUserActionForPlayback = []`. Mobile Safari does not.

The web app is **not bundled** — it loads from a LAN URL configured in
`frontend/capacitor.config.ts`. The iPad must be on the same Wi-Fi as the
KidsTube Docker host at runtime.

## What's already done (scaffolded on Linux)

- `capacitor.config.ts` — appId `com.kidstube.app`, name "KidsTube",
  `server.url` placeholder
- `ios/App/App/CustomViewController.swift` — overrides WKWebView config
  to permit unmuted autoplay
- `Main.storyboard` — points the bridge view controller at `CustomViewController`
- `Info.plist` — `NSAllowsArbitraryLoads = true`, `CFBundleDisplayName = Videos`
- `project.pbxproj` — `CustomViewController.swift` registered in build phase,
  `TARGETED_DEVICE_FAMILY = "2"` (iPad only)

## What remains (Mac steps)

### 1. Set the LAN server URL

Find the LAN IP of the KidsTube Docker host:

```bash
hostname -I | awk '{print $1}'
```

Edit `frontend/capacitor.config.ts` → replace the `server.url` placeholder.

### 2. Build the web assets and sync

> **Note:** As of writing the frontend `npm run build` fails on a pre-existing
> issue (missing `src/pages/admin/` files referenced by `Admin.jsx`). That
> needs to be resolved before this step works. The bug is unrelated to the
> Capacitor wrapper — track it separately.

```bash
cd frontend
npm run build
npx cap sync ios
```

### 3. Open Xcode

```bash
npx cap open ios
# or manually (Capacitor 8 uses Swift Package Manager, not CocoaPods,
# so open the .xcodeproj directly — no .xcworkspace):
open ios/App/App.xcodeproj
```

### 4. Configure signing in Xcode

- Project navigator → App target → Signing & Capabilities
- Team → select your Apple Developer account
- Bundle Identifier: `com.kidstube.app` (matches an App ID at
  https://developer.apple.com → Certificates, Identifiers & Profiles)
- ✅ Automatically manage signing

### 5. Verify on iPad Simulator

- Device picker → any iPad simulator (e.g. iPad Pro 11")
- ⌘R to run
- Verify:
  - Profile select screen loads from the LAN server
  - Picking a profile → Home feed loads with video thumbnails
  - Tapping a video → starts playing **with audio immediately** (no tap)

If the simulator shows a blank screen: the LAN URL is wrong, the server is
down, or `cleartext: true` / `NSAllowsArbitraryLoads = true` is missing. Both
flags are needed for plain HTTP.

### 6. Archive and upload to TestFlight

1. Device picker → "Any iOS Device (arm64)"
2. Product → Archive (takes 2–5 min)
3. Organizer opens → Validate App
4. Distribute App → App Store Connect → Upload
5. In App Store Connect → My Apps:
   - If first upload, create app record with platform iOS and bundle ID
     `com.kidstube.app`
   - TestFlight tab → wait ~15 min for "Ready to Submit"
   - Internal Testing → create group → add family Apple IDs → submit build
6. Family installs the TestFlight iOS app → accepts invitation → installs
   "Videos"

## Why two transport flags

`cleartext: true` in `capacitor.config.ts` tells Capacitor to allow non-HTTPS
URLs. `NSAllowsArbitraryLoads = true` in `Info.plist` tells iOS App Transport
Security to allow them. Both are needed — one without the other still blocks
HTTP.

## Gotchas

- **Storyboard `customClass` must match the Swift class name exactly** —
  mismatch crashes at startup with "Unknown class CustomViewController in
  Interface Builder file".
- **No offline support** — if the Docker stack is down the app shows a blank
  screen. Acceptable for family use.
- **TestFlight processing time** — 10–30 min after upload before the build is
  testable. There's no way to speed this up.
- **Backend connectivity is automatic** — relative `/api/` paths resolve
  through nginx to the backend the same way as in a browser. No API URL
  changes needed.
