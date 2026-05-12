# iOS app — Mac-side completion

This directory contains the iOS-native assets that could not be applied on
the Linux dev box. Everything here is ready to be moved into the iOS
project once `npx cap add ios` succeeds on a Mac.

## What's already done (this branch)

- `@capacitor/core`, `@capacitor/ios`, `@capacitor/cli` installed in
  `frontend/package.json`.
- `frontend/capacitor.config.ts` created with the spec'd config
  (appId, appName, webDir, server.url placeholder, ios overrides).

## What still needs a Mac

Follow these steps in order. Total time on a Mac with prerequisites in
place: ~30 minutes (plus TestFlight processing wait).

### 0. Verify prerequisites

```bash
xcodebuild -version      # Xcode 15+
xcode-select -p          # command-line tools installed
pod --version            # CocoaPods 1.14+
```

Apple Developer account ($99/year) logged into Xcode →
Settings → Accounts. App ID `com.kidstube.app` registered at
https://developer.apple.com/account/resources/identifiers.

### 1. Update `server.url` in `capacitor.config.ts`

Replace the placeholder `192.168.1.100` with the actual LAN IP of the
Docker host. The iPad must be on the same Wi-Fi at runtime.

```bash
# On the Docker host:
hostname -I | awk '{print $1}'
```

### 2. Pull deps and add the iOS platform

```bash
cd frontend
npm install
npm run build
npx cap add ios          # creates frontend/ios/ — also runs pod install
```

### 3. Drop in `CustomViewController.swift`

```bash
cp ios-prep/CustomViewController.swift ios/App/App/CustomViewController.swift
```

Then in Xcode (after step 5 opens the workspace), make sure the file is
included in the App target — Xcode usually picks it up automatically
when it lives inside the App group directory.

### 4. Edit `Info.plist`

Apply the additions from `ios-prep/Info.plist.additions.xml` to
`ios/App/App/Info.plist`. Both `NSAppTransportSecurity` and
`CFBundleDisplayName` go inside the root `<dict>`.

### 5. Edit the storyboard

Follow `ios-prep/storyboard-customclass.patch`. One line change in
`ios/App/App/Base.lproj/Main.storyboard` — customClass and customModule.

### 6. Re-enable unmuted autoplay in MiniPlayer

Follow `ios-prep/miniplayer-autoplay.patch`. Two edits in
`frontend/src/components/MiniPlayer.jsx`. **Do not ship this without the
iOS app** — see the patch file for why (state desync in regular
browsers).

```bash
cd frontend
npm run build
npx cap sync ios
```

### 7. Xcode signing + targets

Open `frontend/ios/App/App.xcworkspace` (the `.xcworkspace`, not the
`.xcodeproj`). In the project settings:

- **Signing & Capabilities** → Team → select the Apple Developer account.
  Enable "Automatically manage signing". Bundle ID: `com.kidstube.app`.
- **General → Deployment Info** → iOS 15.0 minimum, all four
  orientations checked, iPad only (uncheck iPhone).

### 8. Simulator smoke test

Select an iPad simulator → Cmd+R. Expected:

- Profile select screen loads from the LAN server.
- Selecting a profile → Home feed loads with video thumbnails.
- Opening a video → **plays with audio immediately** (no tap required).

The audio-on-load behavior is the whole point. If you tap-to-play, the
WKWebView config didn't take effect — verify
`CustomViewController.swift` is in the target and the storyboard points
at it.

### 9. Archive + TestFlight

1. Device picker → "Any iOS Device (arm64)".
2. Product → Archive (2–5 min).
3. Organizer → Validate App.
4. Distribute App → App Store Connect → Upload.
5. App Store Connect → My Apps → create the app record on first upload
   (platform iOS, bundle ID `com.kidstube.app`).
6. TestFlight tab → wait for "Ready to Submit" (~15 min processing).
7. Internal Testing → create a group → add family Apple IDs → submit
   the build.
8. Family installs TestFlight app → accepts invite → installs KidsTube.

## Acceptance criteria (from BACKLOG task)

- [x] `capacitor.config.ts` exists with `appId: 'com.kidstube.app'`
- [x] `CustomViewController.swift` exists with
      `mediaTypesRequiringUserActionForPlayback = []`
- [ ] `Main.storyboard` references `CustomViewController` not
      `CAPBridgeViewController`
- [ ] `Info.plist` has `NSAllowsArbitraryLoads = true`
- [ ] `MiniPlayer.jsx` embed URL includes `autoplay=1` without `mute=1`
- [ ] App runs in iPad Simulator — video plays with audio without a tap
- [ ] `xcodebuild archive` exits 0
- [ ] Build appears in App Store Connect TestFlight as "Ready to Submit"

Checked boxes are done on this branch. Unchecked require Mac.

## Cleanup

Once the iOS project is added and the assets are dropped in, this
`ios-prep/` directory can be deleted — it's a one-time staging area.
