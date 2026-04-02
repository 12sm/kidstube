# KidsTube — Autonomous Work Backlog

Tasks in this file are approved for overnight Claude Code sessions.
Pick the top TODO item, implement it completely, open a PR. One task per session.

---

## TODO

---

### TASK: Build a KidsTube Roku channel app

> **⬆ TOP OF QUEUE — run this next**
> Session goal: implement backend stream endpoint + full Roku BrightScript app, build ZIP, open PR. Do NOT sideload — Roku dev mode not yet enabled. See "Stop condition" section below.

---

**Session type:** Single-evening autonomous implementation — no human input required mid-run.
**Outcome:** Native iOS app on TestFlight for family iPads, with fully unmuted autoplay via WKWebView config.

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

---

### TASK: Build a KidsTube Roku channel app ← FULL SPEC BELOW

**Session type:** Single-evening autonomous implementation — no human input required mid-run.
**Outcome:** All Roku app files written, backend stream endpoint live, ZIP packaged, PR open with sideload command ready. Sideloading done by human after enabling Roku dev mode.
**ToS note:** YouTube stream extraction via yt-dlp is against YouTube's ToS. Acceptable at household scale for private family use.

---

#### Part 1: New backend endpoint — `GET /api/stream/:videoId`

##### New helper in `backend/src/ytdlp.js`

Add after the existing `fetchVideoData` function and export it:

```js
async function getStreamUrl(videoId) {
  const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const formatSelectors = [
    'hls*',
    'best[ext=mp4][height<=720]',
    'best[height<=720]',
    'best'
  ];
  for (const fmt of formatSelectors) {
    try {
      const args = ['--no-warnings', '--no-playlist', '-f', fmt, '-g', '--no-check-certificate', videoUrl];
      const { stdout } = await runYtDlp(args);
      const url = stdout.trim().split('\n')[0];
      if (url && url.startsWith('http')) {
        const isHls = url.includes('.m3u8') || fmt === 'hls*';
        return { url, type: isHls ? 'hls' : 'mp4' };
      }
    } catch (err) {
      console.warn(`[stream] Format ${fmt} failed for ${videoId}:`, err.message.slice(0, 100));
    }
  }
  throw new Error(`No playable stream found for ${videoId}`);
}
module.exports = { fetchVideoData, getStreamUrl };
```

##### New route in `backend/src/server.js`

Add at module-level (after requires):
```js
const { fetchVideoData, getStreamUrl } = require('./ytdlp');
const streamCache = new Map();
const STREAM_CACHE_TTL_MS = 25 * 60 * 1000;
```

Add in the Public API Routes section:
```js
app.get('/api/stream/:videoId', async (req, res) => {
  const { videoId } = req.params;
  if (!/^[a-zA-Z0-9_-]{6,15}$/.test(videoId)) return res.status(400).json({ error: 'Invalid video ID' });
  const cached = streamCache.get(videoId);
  if (cached && cached.expiresAt > Date.now()) return res.json({ url: cached.url, type: cached.type, cached: true });
  try {
    const result = await getStreamUrl(videoId);
    streamCache.set(videoId, { url: result.url, type: result.type, expiresAt: Date.now() + STREAM_CACHE_TTL_MS });
    if (streamCache.size > 200) {
      const now = Date.now();
      for (const [key, val] of streamCache) { if (val.expiresAt < now) streamCache.delete(key); }
    }
    res.json({ url: result.url, type: result.type, cached: false });
  } catch (err) {
    console.error(`[stream] Failed for ${videoId}:`, err.message);
    res.status(502).json({ error: 'Stream unavailable', detail: err.message });
  }
});
```

Rebuild backend: `docker compose build backend && docker compose up -d backend`

Test: `curl "http://localhost:3001/api/stream/dQw4w9WgXcQ"` — expect JSON with `url` starting `https://`.

---

#### Part 2: Roku developer setup

1. On the Roku remote from the home screen: **Home×3, Up×2, Right, Left, Right, Left, Right** — this opens developer mode. Enable it, set password `kidstube123`. Note the device IP shown on screen.
2. Free developer account at https://developer.roku.com/enrollment/standard (unlocks dev dashboard, no publishing needed).
3. No SDK to install — deployment is via `zip` + `curl`.

---

#### Part 3: Project structure

Create `/home/michael/projects/kidstube/roku-app/` with this layout:

```
roku-app/
  manifest
  source/
    main.brs
  components/
    ProfileSelect.xml + .brs
    HomeScene.xml + .brs
    FetchTask.xml + .brs
    ItemRenderer.xml + .brs
    VideoPlayer.xml + .brs
  images/
    splash_hd.jpg        (1280×720)
    channel_poster_hd.jpg (290×218)
    channel_poster_sd.jpg (214×144)
```

Create placeholder images with ImageMagick (or copy/resize any existing JPEG from `screenshots/`):
```bash
convert -size 1280x720 xc:'#1a1a2e' roku-app/images/splash_hd.jpg
convert -size 290x218  xc:'#1a1a2e' roku-app/images/channel_poster_hd.jpg
convert -size 214x144  xc:'#1a1a2e' roku-app/images/channel_poster_sd.jpg
```

---

#### Part 4: `roku-app/manifest`

```
title=KidsTube
subtitle=Parent-controlled videos
major_version=1
minor_version=0
build_version=1
mm_icon_focus_hd=pkg:/images/channel_poster_hd.jpg
mm_icon_focus_sd=pkg:/images/channel_poster_sd.jpg
splash_screen_hd=pkg:/images/splash_hd.jpg
splash_color=#1a1a2e
splash_min_time=1000
ui_resolutions=hd
```

**Critical:** No trailing spaces, no leading blank lines, no blank line at top. One broken character silently kills the channel.

---

#### Part 5: Backend URL configuration

Set the host machine's LAN IP in `roku-app/source/main.brs` as a global field on `m.global`. Find the IP with: `hostname -I | awk '{print $1}'`

In `main.brs`, after scene is created:
```brightscript
scene.getGlobalNode().addField("backendUrl", "string", false)
scene.getGlobalNode().addField("profileId", "integer", false)
scene.getGlobalNode().addField("profileName", "string", false)
scene.getGlobalNode().backendUrl = "http://192.168.1.XXX:3001"  ' ← replace with actual IP
```

All components read `m.global.backendUrl` directly.

---

#### Part 6: File-by-file implementation

##### `source/main.brs`
```brightscript
sub Main(args as Dynamic)
    screen = CreateObject("roSGScreen")
    m.port = CreateObject("roMessagePort")
    screen.setMessagePort(m.port)
    scene = screen.CreateScene("ProfileSelect")
    screen.show()
    scene.getGlobalNode().addField("backendUrl", "string", false)
    scene.getGlobalNode().addField("profileId", "integer", false)
    scene.getGlobalNode().addField("profileName", "string", false)
    scene.getGlobalNode().backendUrl = "http://192.168.1.XXX:3001"
    scene.getGlobalNode().profileId = 0
    scene.getGlobalNode().profileName = ""
    while true
        msg = wait(0, m.port)
        if type(msg) = "roSGScreenEvent" and msg.isScreenClosed() then return
    end while
end sub
```

##### `components/FetchTask.xml`
```xml
<?xml version="1.0" encoding="utf-8" ?>
<component name="FetchTask" extends="Task">
    <interface>
        <field id="url" type="string" />
        <field id="method" type="string" value="GET" />
        <field id="body" type="string" value="" />
        <field id="response" type="string" value="" />
    </interface>
    <script type="text/brightscript" uri="pkg:/components/FetchTask.brs" />
</component>
```

##### `components/FetchTask.brs`
```brightscript
sub init()
    m.top.functionName = "runFetch"
end sub
sub runFetch()
    http = createObject("roUrlTransfer")
    http.setUrl(m.top.url)
    http.setCertificatesFile("common:/certs/ca-bundle.crt")
    http.InitClientCertificates()
    if m.top.method = "POST"
        http.setRequest("POST")
        http.addHeader("Content-Type", "application/json")
        m.top.response = http.postFromString(m.top.body)
    else
        m.top.response = http.GetToString()
    end if
end sub
```

##### `components/ProfileSelect.xml`
```xml
<?xml version="1.0" encoding="utf-8" ?>
<component name="ProfileSelect" extends="Scene">
    <script type="text/brightscript" uri="pkg:/components/ProfileSelect.brs" />
    <children>
        <Rectangle id="background" width="1280" height="720" color="0x1A1A2EFF" />
        <Label id="title" text="Who's watching?" width="1280" horizAlign="center"
               translation="[0, 140]" font="font:LargeBoldSystemFont" color="0xFFFFFFFF" />
        <Rectangle id="westonCard" width="220" height="260" color="0x2D2D5EFF" translation="[290, 260]" focusable="true" />
        <Label id="westonLabel" text="Weston" width="220" horizAlign="center"
               translation="[290, 530]" color="0xFFFFFFFF" font="font:MediumBoldSystemFont" />
        <Rectangle id="emeryCard" width="220" height="260" color="0x2D2D5EFF" translation="[770, 260]" focusable="true" />
        <Label id="emeryLabel" text="Emery" width="220" horizAlign="center"
               translation="[770, 530]" color="0xFFFFFFFF" font="font:MediumBoldSystemFont" />
    </children>
</component>
```

##### `components/ProfileSelect.brs`
```brightscript
sub init()
    m.westonCard = m.top.findNode("westonCard")
    m.emeryCard = m.top.findNode("emeryCard")
    m.top.setFocus(true)
    m.westonCard.setFocus(true)
end sub
function onKeyEvent(key as String, press as Boolean) as Boolean
    if press
        if key = "OK"
            if m.westonCard.hasFocus() then selectProfile(5, "Weston")
            if m.emeryCard.hasFocus() then selectProfile(6, "Emery")
            return true
        else if key = "right" and m.westonCard.hasFocus()
            m.emeryCard.setFocus(true)
            m.emeryCard.color = "0x4A4A8EFF"
            m.westonCard.color = "0x2D2D5EFF"
            return true
        else if key = "left" and m.emeryCard.hasFocus()
            m.westonCard.setFocus(true)
            m.westonCard.color = "0x4A4A8EFF"
            m.emeryCard.color = "0x2D2D5EFF"
            return true
        end if
    end if
    return false  ' back key: let Roku show system exit dialog
end function
sub selectProfile(profileId as Integer, profileName as String)
    m.global.profileId = profileId
    m.global.profileName = profileName
    homeScene = m.top.getScene().createChild("HomeScene")
    homeScene.setFocus(true)
end sub
```

##### `components/HomeScene.xml`
```xml
<?xml version="1.0" encoding="utf-8" ?>
<component name="HomeScene" extends="Group">
    <script type="text/brightscript" uri="pkg:/components/HomeScene.brs" />
    <children>
        <Rectangle id="background" width="1280" height="720" color="0x0F0F0FFF" />
        <Label id="headerLabel" text="KidsTube" translation="[60, 28]"
               font="font:MediumBoldSystemFont" color="0xFF0000FF" />
        <Label id="profileLabel" translation="[1100, 28]"
               font="font:SmallSystemFont" color="0xAAAAAAFF" />
        <MarkupGrid id="videoGrid" translation="[60, 90]"
                    itemSize="[280, 210]" itemSpacing="[20, 20]"
                    numColumns="4" focusable="true" />
    </children>
</component>
```

##### `components/HomeScene.brs`
```brightscript
sub init()
    m.videoGrid = m.top.findNode("videoGrid")
    m.top.findNode("profileLabel").text = m.global.profileName
    m.videoGrid.itemComponentName = "ItemRenderer"
    m.videoGrid.observeField("itemSelected", "onItemSelected")
    m.videoGrid.setFocus(true)
    fetchFeed()
end sub
sub fetchFeed()
    m.task = createObject("roSGNode", "FetchTask")
    m.task.url = m.global.backendUrl + "/api/feed/" + m.global.profileId.toStr() + "?limit=40"
    m.task.observeField("response", "onFeedLoaded")
    m.task.control = "RUN"
end sub
sub onFeedLoaded()
    parsed = ParseJson(m.task.response)
    if parsed = invalid then return
    contentNode = createObject("roSGNode", "ContentNode")
    for each video in parsed.videos
        item = createObject("roSGNode", "ContentNode")
        item.addField("videoId", "string", false)
        item.addField("channelName", "string", false)
        item.addField("durationSeconds", "integer", false)
        item.videoId = video.video_id
        item.title = video.title
        item.hdPosterUrl = video.thumbnail_url
        item.channelName = video.channel_name
        item.durationSeconds = video.duration_seconds
        contentNode.appendChild(item)
    end for
    m.videoGrid.content = contentNode
end sub
sub onItemSelected()
    item = m.videoGrid.content.getChild(m.videoGrid.itemSelected)
    if item = invalid then return
    player = m.top.getScene().createChild("VideoPlayer")
    player.videoId = item.videoId
    player.videoTitle = item.title
    player.setFocus(true)
end sub
function onKeyEvent(key as String, press as Boolean) as Boolean
    if press and key = "back"
        m.top.getParent().removeChild(m.top)
        return true
    end if
    return false
end function
```

##### `components/ItemRenderer.xml`
```xml
<?xml version="1.0" encoding="utf-8" ?>
<component name="ItemRenderer" extends="Group">
    <interface>
        <field id="width" type="float" />
        <field id="height" type="float" />
        <field id="itemContent" type="node" />
        <field id="focusPercent" type="float" />
    </interface>
    <script type="text/brightscript" uri="pkg:/components/ItemRenderer.brs" />
    <children>
        <Poster id="thumbnail" width="280" height="157" loadingBitmapOpacity="0.3" />
        <Label id="titleLabel" width="280" height="36" translation="[0, 161]"
               font="font:SmallSystemFont" color="0xFFFFFFFF" wrap="true" maxLines="2" />
        <Label id="channelLabel" width="280" height="20" translation="[0, 197]"
               font="font:SmallSystemFont" color="0xAAAAAAFF" />
    </children>
</component>
```

##### `components/ItemRenderer.brs`
```brightscript
sub init()
    m.thumbnail = m.top.findNode("thumbnail")
    m.titleLabel = m.top.findNode("titleLabel")
    m.channelLabel = m.top.findNode("channelLabel")
    m.top.observeField("itemContent", "onContentSet")
    m.top.observeField("focusPercent", "onFocusChange")
end sub
sub onContentSet()
    c = m.top.itemContent
    if c = invalid then return
    m.thumbnail.uri = c.hdPosterUrl
    m.titleLabel.text = c.title
    m.channelLabel.text = c.channelName
end sub
sub onFocusChange()
    if m.top.focusPercent > 0.5 then m.top.scale = [1.08, 1.08]
    else m.top.scale = [1.0, 1.0]
end sub
```

##### `components/VideoPlayer.xml`
```xml
<?xml version="1.0" encoding="utf-8" ?>
<component name="VideoPlayer" extends="Group">
    <interface>
        <field id="videoId" type="string" />
        <field id="videoTitle" type="string" />
    </interface>
    <script type="text/brightscript" uri="pkg:/components/VideoPlayer.brs" />
    <children>
        <Rectangle id="loadingBg" width="1280" height="720" color="0x000000FF" />
        <Label id="loadingLabel" text="Loading..." width="1280" horizAlign="center"
               translation="[0, 340]" font="font:MediumSystemFont" color="0xFFFFFFFF" />
        <Label id="errorLabel" text="" width="1000" horizAlign="center"
               translation="[140, 340]" font="font:SmallSystemFont" color="0xFF4444FF" visible="false" />
        <Video id="videoNode" width="1280" height="720" translation="[0, 0]" />
    </children>
</component>
```

##### `components/VideoPlayer.brs`
```brightscript
sub init()
    m.videoNode = m.top.findNode("videoNode")
    m.loadingLabel = m.top.findNode("loadingLabel")
    m.errorLabel = m.top.findNode("errorLabel")
    m.videoNode.observeField("state", "onPlayerStateChange")
    m.top.observeField("videoId", "onVideoIdSet")
    m.lastReportedPosition = 0
    m.progressTimer = createObject("roSGNode", "Timer")
    m.progressTimer.duration = 10
    m.progressTimer.repeat = true
    m.progressTimer.observeField("fire", "reportProgress")
end sub
sub onVideoIdSet()
    if m.top.videoId = "" or m.top.videoId = invalid then return
    m.loadingLabel.visible = true
    m.errorLabel.visible = false
    m.streamTask = createObject("roSGNode", "FetchTask")
    m.streamTask.url = m.global.backendUrl + "/api/stream/" + m.top.videoId
    m.streamTask.observeField("response", "onStreamUrlLoaded")
    m.streamTask.control = "RUN"
end sub
sub onStreamUrlLoaded()
    parsed = ParseJson(m.streamTask.response)
    if parsed = invalid or parsed.url = invalid
        m.loadingLabel.visible = false
        m.errorLabel.text = "Stream unavailable"
        m.errorLabel.visible = true
        return
    end if
    m.loadingLabel.visible = false
    content = createObject("roSGNode", "ContentNode")
    content.url = parsed.url
    content.title = m.top.videoTitle
    content.streamFormat = parsed.type  ' "hls" or "mp4"
    m.videoNode.content = content
    m.videoNode.control = "play"
    m.videoNode.setFocus(true)
    m.progressTimer.control = "start"
end sub
sub onPlayerStateChange()
    state = m.videoNode.state
    if state = "finished" or state = "error"
        m.progressTimer.control = "stop"
        reportProgress()
        m.top.getParent().removeChild(m.top)
    end if
end sub
sub reportProgress()
    pos = m.videoNode.position
    dur = m.videoNode.duration
    if pos <= 0 or pos = m.lastReportedPosition then return
    m.lastReportedPosition = pos
    task = createObject("roSGNode", "FetchTask")
    task.url = m.global.backendUrl + "/api/watch-history"
    task.method = "POST"
    task.body = FormatJson({ profile_id: m.global.profileId, video_id: m.top.videoId, progress_seconds: Int(pos), duration_seconds: Int(dur) })
    task.control = "RUN"
end sub
function onKeyEvent(key as String, press as Boolean) as Boolean
    if press and key = "back"
        m.progressTimer.control = "stop"
        reportProgress()
        m.videoNode.control = "stop"
        m.top.getParent().removeChild(m.top)
        return true
    end if
    return false
end function
```

---

#### Part 7: Navigation flow

```
App Start → ProfileSelect (scene root)
  D-pad left/right to toggle Weston / Emery, OK to select
    → HomeScene (createChild)
        MarkupGrid loads /api/feed/:profileId
        OK on a card → VideoPlayer (createChild)
            Fetches /api/stream/:videoId → plays video
            Progress reported every 10s to /api/watch-history
            Back → removeChild → HomeScene
        Back → removeChild → ProfileSelect (Roku shows exit dialog)
```

---

#### Part 8: Package and sideload

```bash
# Build ZIP — must be created from INSIDE roku-app/ so manifest is at ZIP root
cd /home/michael/projects/kidstube/roku-app
zip -r ../kidstube-roku.zip . -x "*.DS_Store"

# Verify manifest is at root (not nested in a subdirectory)
unzip -l ../kidstube-roku.zip | head -5

# Sideload — replace ROKU_IP with the device's LAN IP
curl -s -S -F "mysubmit=Install" -F "archive=@../kidstube-roku.zip" \
  --digest -u rokudev:kidstube123 \
  "http://ROKU_IP/plugin_install"
```

Re-deploy after changes: rebuild ZIP and re-run the curl. No need to delete the channel first.

---

#### Gotchas

- **Manifest format:** No trailing spaces, no leading blank lines — one bad character silently kills the channel
- **roUrlTransfer in component scripts blocks the render thread** — all HTTP must go through `FetchTask` (Task node). Never call `GetToString()` directly in a component `.brs` file
- **Set all Task fields before `control = "RUN"`** — race condition otherwise
- **ZIP must have `manifest` at root** — `zip` from inside `roku-app/` ensures this
- **`--digest` flag required for curl sideload** — Roku uses HTTP Digest auth, not Basic
- **`ui_resolutions=hd` means all coordinates are 1280×720** — do not add `fhd` without retesting layout
- **Thumbnails are async** — `Poster` node loads in background; grid renders before images appear
- **Back on ProfileSelect:** returning `false` from `onKeyEvent` lets Roku show the system "exit channel?" dialog — correct behavior, don't fight it
- **Host LAN IP must be set in `main.brs`** — use `hostname -I | awk '{print $1}'` to find it

---

#### Stop condition — human step required

**Do NOT attempt to sideload.** The Roku does not have developer mode enabled yet — the owner will do that (Home×3, Up×2, Right, Left, Right, Left, Right on the remote) while reviewing the PR. Stop after building the ZIP and opening the PR. Include the exact sideload command in the PR description so it's ready to paste.

#### Acceptance criteria (what the session must verify before opening the PR)

- [ ] `curl http://localhost:3001/api/stream/dQw4w9WgXcQ` returns JSON with a valid `url` field
- [ ] Second call within 25 min returns `"cached": true`
- [ ] `docker compose ps` shows backend healthy after rebuild
- [ ] `roku-app/` directory created with all files (manifest, source/, components/, images/)
- [ ] `unzip -l kidstube-roku.zip | head -5` shows `manifest` at ZIP root (not in a subdirectory)
- [ ] PR description includes the exact sideload curl command with correct server LAN IP filled in

---

## DONE

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

## IN PROGRESS

## DONE
