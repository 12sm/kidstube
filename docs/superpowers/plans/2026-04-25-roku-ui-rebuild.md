# Roku UI Rebuild — RowList Home Screen

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flat MarkupGrid home screen with a YouTube-style RowList layout (horizontal content rows, vertical scrolling between rows), a collapsible NavBar sidebar, and proper video thumbnail cards with duration badges and progress bars — modeled on Playlet's UI patterns.

**Architecture:** The Roku app uses a backend at `http://{LAN_IP}:3001` for everything (feed, streaming, watch history). The UI rebuild replaces 3 files (HomeScene, ItemRenderer, main.brs scene creation) and adds 3 new files (MainScene, NavBar, VideoRowCell). ProfileSelect, VideoPlayer, and FetchTask are kept with minor fixes. All layout uses Roku's `RowList` and `LayoutGroup` — no absolute-pixel grids.

**Tech Stack:** BrightScript, Roku SceneGraph XML, RowList, LayoutGroup

**Reference:** Playlet (github.com/iBicha/playlet) — layout constants and component patterns borrowed from its HomeScreen, NavBar, and VideoRowCell.

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `roku-app/source/main.brs` | **Modify** | Change initial scene from `ProfileSelect` to `MainScene`; set global fields BEFORE `screen.show()` |
| `roku-app/components/MainScene.xml` | **Create** | Root Scene — contains ProfileSelect, NavBar, content area, video container |
| `roku-app/components/MainScene.brs` | **Create** | Scene lifecycle — profile selection flow, screen switching, video player management |
| `roku-app/components/NavBar.xml` | **Create** | Collapsible left sidebar (80px collapsed, expands on focus) with Home icon |
| `roku-app/components/NavBar.brs` | **Create** | NavBar focus/expand/collapse animation logic |
| `roku-app/components/HomeScreen.xml` | **Create** | RowList-based home feed — replaces old HomeScene.xml |
| `roku-app/components/HomeScreen.brs` | **Create** | Feed loading, row population, item selection — replaces old HomeScene.brs |
| `roku-app/components/VideoRowCell.xml` | **Create** | Video thumbnail card — poster + duration badge + progress bar + title + channel |
| `roku-app/components/VideoRowCell.brs` | **Create** | Card content binding and duration formatting |
| `roku-app/components/FetchTask.brs` | **Modify** | Add HTTP timeouts (5s connect, 15s transfer) |
| `roku-app/components/VideoPlayer.brs` | **Modify** | Fix loadingBg visibility on error |
| `roku-app/manifest` | **Modify** | Bump version to 2.0.0 |

**Files kept unchanged:** `FetchTask.xml`, `VideoPlayer.xml`, `RemoteKeys.brs`

**Files deleted:** `HomeScene.xml`, `HomeScene.brs`, `ItemRenderer.xml`, `ItemRenderer.brs`, `ProfileSelect.xml`, `ProfileSelect.brs` (ProfileSelect is now inlined into MainScene)

---

## Backend API Reference (for agentic workers)

The Roku app calls these endpoints on `m.global.backendUrl`:

- **`GET /api/feed/:profileId?limit=20`** — Returns `{ "videos": [{ video_id, title, thumbnail_url, channel_name, duration_seconds, ... }] }`
- **`GET /api/watch-history/:profileId?limit=20`** — Returns `{ "history": [{ video_id, title, thumbnail_url, channel_name, progress_seconds, duration_seconds, ... }] }`
- **`GET /api/stream/:videoId`** — Returns `{ "url": "http://host/api/manifest/VIDEO_ID", "type": "dash" }`
- **`POST /api/watch-history`** — Body: `{ "profile_id": 5, "video_id": "abc", "progress_seconds": 120, "duration_seconds": 600 }`
- **`GET /api/profiles`** — Returns `{ "profiles": [{ "id": 5, "name": "Child1" }, { "id": 6, "name": "Child2" }] }`

---

## Task 1: Fix FetchTask — Add HTTP Timeouts

**Files:**
- Modify: `roku-app/components/FetchTask.brs`

- [ ] **Step 1: Add connect and transfer timeouts to FetchTask**

Replace the full content of `roku-app/components/FetchTask.brs`:

```brightscript
sub init()
    m.top.functionName = "runFetch"
end sub

sub runFetch()
    http = createObject("roUrlTransfer")
    http.setUrl(m.top.url)
    http.setCertificatesFile("common:/certs/ca-bundle.crt")
    http.InitClientCertificates()
    http.setConnectTimeout(5000)
    http.setTransferTimeout(15000)
    if m.top.method = "POST" then
        http.setRequest("POST")
        http.addHeader("Content-Type", "application/json")
        m.top.response = http.postFromString(m.top.body)
    else
        m.top.response = http.GetToString()
    end if
end sub
```

- [ ] **Step 2: Commit**

```bash
cd /home/michael/projects/kidstube
git add roku-app/components/FetchTask.brs
git commit -m "fix(roku): add HTTP timeouts to FetchTask (5s connect, 15s transfer)"
```

---

## Task 2: Fix VideoPlayer — Hide Loading on Error

**Files:**
- Modify: `roku-app/components/VideoPlayer.brs`

- [ ] **Step 1: Hide loadingBg when error occurs**

In `roku-app/components/VideoPlayer.brs`, find the `onPlayerStateChange` sub. In the `state = "error"` block, add `m.loadingBg.visible = false` before the existing `m.loadingLabel.visible = false` line:

```brightscript
    if state = "error" then
        m.progressTimer.control = "stop"
        print "[VideoPlayer] error=" m.top.errorStr
        m.loadingBg.visible = false
        m.loadingLabel.visible = false
        showErrorDialog("Could not play this video. Please try again.")
    end if
```

Also fix the same issue in `onStreamUrlLoaded` — when parse fails or URL is missing, hide loadingBg too. Both error blocks should read:

```brightscript
    if parsed = invalid then
        print "[VideoPlayer] stream response parse failed"
        m.loadingBg.visible = false
        m.loadingLabel.visible = false
        showErrorDialog("This video is not available right now.")
        return
    end if
    if parsed.url = invalid then
        print "[VideoPlayer] stream response missing url"
        m.loadingBg.visible = false
        m.loadingLabel.visible = false
        showErrorDialog("This video is not available right now.")
        return
    end if
```

- [ ] **Step 2: Commit**

```bash
git add roku-app/components/VideoPlayer.brs
git commit -m "fix(roku): hide loading overlay on stream/playback errors"
```

---

## Task 3: Create VideoRowCell — Thumbnail Card Component

**Files:**
- Create: `roku-app/components/VideoRowCell.xml`
- Create: `roku-app/components/VideoRowCell.brs`

This is the card rendered for each video in a RowList row. Layout modeled on Playlet's VideoRowCell: 350x196 thumbnail, duration badge, red progress bar, title (2 lines), channel name.

- [ ] **Step 1: Create VideoRowCell.xml**

```xml
<?xml version="1.0" encoding="utf-8" ?>
<component name="VideoRowCell" extends="Group">
    <interface>
        <field id="itemContent" type="node" onChange="onContentSet" />
    </interface>
    <script type="text/brightscript" uri="pkg:/components/VideoRowCell.brs" />
    <children>
        <LayoutGroup layoutDirection="vert" itemSpacings="[8, 4]">
            <Group id="thumbnailContainer">
                <Poster
                    id="thumbnail"
                    width="350"
                    height="196"
                    loadDisplayMode="scaleToZoom"
                    failedBitmapUri=""
                    loadingBitmapOpacity="0.3" />
                <Rectangle
                    id="durationRect"
                    height="24"
                    color="0x000000CC"
                    translation="[280, 166]"
                    visible="false">
                    <Label
                        id="durationLabel"
                        height="24"
                        font="font:SmallestSystemFont"
                        horizAlign="center"
                        vertAlign="center"
                        translation="[6, 0]" />
                </Rectangle>
                <Rectangle
                    id="progressBar"
                    width="350"
                    height="4"
                    color="0xFF0000FF"
                    translation="[0, 192]"
                    scale="[0, 1]"
                    visible="false" />
            </Group>
            <Label
                id="titleLabel"
                width="350"
                font="font:SmallestBoldSystemFont"
                maxLines="2"
                wrap="true"
                color="0xFFFFFFFF" />
            <Label
                id="channelLabel"
                width="350"
                height="22"
                font="font:SmallestSystemFont"
                color="0xAAAAAAFF" />
        </LayoutGroup>
    </children>
</component>
```

- [ ] **Step 2: Create VideoRowCell.brs**

```brightscript
sub init()
    m.thumbnail = m.top.findNode("thumbnail")
    m.titleLabel = m.top.findNode("titleLabel")
    m.channelLabel = m.top.findNode("channelLabel")
    m.durationRect = m.top.findNode("durationRect")
    m.durationLabel = m.top.findNode("durationLabel")
    m.progressBar = m.top.findNode("progressBar")
end sub

sub onContentSet()
    content = m.top.itemContent
    if content = invalid then return

    m.thumbnail.uri = content.HDPOSTERURL
    m.titleLabel.text = content.TITLE
    m.channelLabel.text = content.DESCRIPTION

    ' Duration badge
    dur = 0
    if content.hasField("duration_seconds")
        dur = content.duration_seconds
    end if
    if dur > 0
        m.durationLabel.text = formatDuration(dur)
        ' Size the badge rectangle to fit the text
        textWidth = m.durationLabel.boundingRect().width + 16
        m.durationRect.width = textWidth
        m.durationRect.translation = [350 - textWidth - 6, 166]
        m.durationRect.visible = true
    else
        m.durationRect.visible = false
    end if

    ' Progress bar (continue watching)
    prog = 0
    if content.hasField("progress_pct")
        prog = content.progress_pct
    end if
    if prog > 0.05 and prog < 0.95
        m.progressBar.scale = [prog, 1]
        m.progressBar.visible = true
    else
        m.progressBar.visible = false
    end if
end sub

function formatDuration(totalSeconds as integer) as string
    hours = totalSeconds \ 3600
    minutes = (totalSeconds MOD 3600) \ 60
    seconds = totalSeconds MOD 60
    secStr = seconds.toStr()
    if seconds < 10 then secStr = "0" + seconds.toStr()
    if hours > 0
        minStr = minutes.toStr()
        if minutes < 10 then minStr = "0" + minutes.toStr()
        return hours.toStr() + ":" + minStr + ":" + secStr
    end if
    return minutes.toStr() + ":" + secStr
end function
```

- [ ] **Step 3: Commit**

```bash
git add roku-app/components/VideoRowCell.xml roku-app/components/VideoRowCell.brs
git commit -m "feat(roku): add VideoRowCell component — thumbnail card with duration badge and progress bar"
```

---

## Task 4: Create HomeScreen — RowList-Based Feed

**Files:**
- Create: `roku-app/components/HomeScreen.xml`
- Create: `roku-app/components/HomeScreen.brs`
- Delete: `roku-app/components/HomeScene.xml`, `roku-app/components/HomeScene.brs`, `roku-app/components/ItemRenderer.xml`, `roku-app/components/ItemRenderer.brs`

The new HomeScreen uses a `RowList` with two rows: "Continue Watching" (from watch history, 5-95% progress) and "Recommended" (from feed endpoint). Each row scrolls horizontally. The list scrolls vertically between rows.

- [ ] **Step 1: Create HomeScreen.xml**

```xml
<?xml version="1.0" encoding="utf-8" ?>
<component name="HomeScreen" extends="Group">
    <interface>
        <field id="profileId" type="integer" onChange="onProfileIdSet" />
        <field id="isDone" type="boolean" value="false" />
        <field id="isPlaying" type="boolean" value="false" />
        <field id="pendingVideoId" type="string" value="" />
        <field id="pendingVideoTitle" type="string" value="" />
    </interface>
    <script type="text/brightscript" uri="pkg:/components/RemoteKeys.brs" />
    <script type="text/brightscript" uri="pkg:/components/HomeScreen.brs" />
    <children>
        <Rectangle width="1280" height="720" color="0x0F0F0FFF" />

        <RowList
            id="rowList"
            itemComponentName="VideoRowCell"
            translation="[0, 20]"
            numRows="2"
            rowItemSize="[[350, 280]]"
            rowItemSpacing="[[20, 0]]"
            itemSize="[1280, 340]"
            itemSpacing="[0, 30]"
            rowLabelOffset="[[60, 10]]"
            focusXOffset="[60]"
            showRowLabel="[true]"
            rowLabelFont="font:SmallBoldSystemFont"
            rowLabelColor="0xFFFFFFFF"
            rowFocusAnimationStyle="floatingFocus"
            vertFocusAnimationStyle="floatingFocus"
            drawFocusFeedback="true"
        />

        <Group id="loadingGroup" translation="[540, 320]">
            <BusySpinner id="spinner" translation="[60, 0]" />
            <Label id="loadingLabel" text="Loading..." translation="[0, 60]"
                   width="200" horizAlign="center"
                   font="font:SmallSystemFont" color="0xAAAAAAFF" />
        </Group>
    </children>
</component>
```

- [ ] **Step 2: Create HomeScreen.brs**

```brightscript
sub init()
    m.rowList = m.top.findNode("rowList")
    m.loadingGroup = m.top.findNode("loadingGroup")
    m.lastSelectedIndex = 0
    m.rowList.observeFieldScoped("rowItemSelected", "onItemSelected")
end sub

sub onProfileIdSet()
    profileId = m.top.profileId
    if profileId = 0 then return

    ' Fetch continue watching (watch history)
    m.historyTask = createObject("roSGNode", "FetchTask")
    m.historyTask.url = m.global.backendUrl + "/api/watch-history/" + profileId.toStr() + "?limit=20"
    m.historyTask.observeFieldScoped("response", "onHistoryLoaded")
    m.historyTask.control = "RUN"

    ' Fetch recommended feed
    m.feedTask = createObject("roSGNode", "FetchTask")
    m.feedTask.url = m.global.backendUrl + "/api/feed/" + profileId.toStr() + "?limit=40"
    m.feedTask.observeFieldScoped("response", "onFeedLoaded")
    m.feedTask.control = "RUN"
end sub

sub onHistoryLoaded()
    m.historyData = []
    parsed = ParseJson(m.historyTask.response)
    if parsed <> invalid and parsed.history <> invalid
        for each item in parsed.history
            ' Continue watching = 5-95% progress
            if item.duration_seconds <> invalid and item.duration_seconds > 0
                pct = item.progress_seconds / item.duration_seconds
                if pct > 0.05 and pct < 0.95
                    item.progress_pct = pct
                    m.historyData.push(item)
                end if
            end if
        end for
    end if
    tryBuildRows()
end sub

sub onFeedLoaded()
    m.feedData = []
    parsed = ParseJson(m.feedTask.response)
    if parsed <> invalid and parsed.videos <> invalid
        m.feedData = parsed.videos
    end if
    tryBuildRows()
end sub

sub tryBuildRows()
    ' Wait for both requests to finish
    if m.historyData = invalid or m.feedData = invalid then return

    m.loadingGroup.visible = false

    content = createObject("roSGNode", "ContentNode")

    ' Row 1: Continue Watching (only if there are items)
    if m.historyData.count() > 0
        cwRow = createObject("roSGNode", "ContentNode")
        cwRow.title = "Continue Watching"
        for each item in m.historyData
            child = createObject("roSGNode", "ContentNode")
            child.title = item.title
            child.HDPosterUrl = item.thumbnail_url
            child.description = item.channel_name
            child.addFields({ video_id: item.video_id, duration_seconds: item.duration_seconds, progress_pct: item.progress_pct })
            cwRow.appendChild(child)
        end for
        content.appendChild(cwRow)
    end if

    ' Row 2: Recommended
    recRow = createObject("roSGNode", "ContentNode")
    recRow.title = "Recommended"
    for each item in m.feedData
        child = createObject("roSGNode", "ContentNode")
        child.title = item.title
        child.HDPosterUrl = item.thumbnail_url
        child.description = item.channel_name
        dur = 0
        if item.duration_seconds <> invalid then dur = item.duration_seconds
        child.addFields({ video_id: item.video_id, duration_seconds: dur, progress_pct: 0 })
        recRow.appendChild(child)
    end for
    content.appendChild(recRow)

    m.rowList.content = content
    m.rowList.setFocus(true)
end sub

sub onItemSelected()
    sel = m.rowList.rowItemSelected
    if sel = invalid then return
    rowIdx = sel[0]
    itemIdx = sel[1]

    row = m.rowList.content.getChild(rowIdx)
    if row = invalid then return
    item = row.getChild(itemIdx)
    if item = invalid then return

    m.lastSelectedIndex = [rowIdx, itemIdx]
    m.top.pendingVideoId = item.video_id
    m.top.pendingVideoTitle = item.title
    m.top.isPlaying = true
end sub

function onKeyEvent(key as string, press as boolean) as boolean
    keys = RemoteKeys()
    if press
        if key = keys.back
            m.top.isDone = true
            return true
        end if
    end if
    return false
end function
```

- [ ] **Step 3: Delete old HomeScene and ItemRenderer files**

```bash
rm -f roku-app/components/HomeScene.xml roku-app/components/HomeScene.brs
rm -f roku-app/components/ItemRenderer.xml roku-app/components/ItemRenderer.brs
```

- [ ] **Step 4: Commit**

```bash
git add roku-app/components/HomeScreen.xml roku-app/components/HomeScreen.brs
git add -u roku-app/components/
git commit -m "feat(roku): replace MarkupGrid with RowList-based HomeScreen — Continue Watching + Recommended rows"
```

---

## Task 5: Create NavBar — Collapsible Left Sidebar

**Files:**
- Create: `roku-app/components/NavBar.xml`
- Create: `roku-app/components/NavBar.brs`

Minimal sidebar: 80px collapsed strip with a YouTube-red "Y" logo, expands to show "Home" label on focus. Modeled on Playlet's NavBar but stripped to one item (Home). The sidebar pushes the content area right when focused.

- [ ] **Step 1: Create NavBar.xml**

```xml
<?xml version="1.0" encoding="utf-8" ?>
<component name="NavBar" extends="Group">
    <interface>
        <field id="isExpanded" type="boolean" value="false" />
    </interface>
    <script type="text/brightscript" uri="pkg:/components/RemoteKeys.brs" />
    <script type="text/brightscript" uri="pkg:/components/NavBar.brs" />
    <children>
        <!-- Collapsed bar (always visible) -->
        <Rectangle
            id="background"
            width="80"
            height="720"
            color="0x212121FF"
            opacity="0.95" />

        <!-- Expanded sidebar (shown on focus) -->
        <Rectangle
            id="expandedBg"
            width="160"
            height="720"
            color="0x212121FF"
            opacity="0.0"
            translation="[80, 0]" />

        <!-- YouTube-style red logo mark -->
        <Rectangle
            id="logoMark"
            width="36"
            height="26"
            color="0xFF0000FF"
            translation="[22, 40]"
            cornerRadius="4" />
        <Label
            id="logoPlay"
            text="▶"
            width="36"
            height="26"
            horizAlign="center"
            vertAlign="center"
            translation="[22, 40]"
            font="font:SmallestSystemFont"
            color="0xFFFFFFFF" />

        <!-- Brand text (visible when expanded) -->
        <Label
            id="brandLabel"
            text="YouTube"
            translation="[22, 78]"
            font="font:SmallBoldSystemFont"
            color="0xFFFFFFFF"
            opacity="0.0" />

        <!-- Home nav item -->
        <Group id="homeItem" translation="[0, 140]">
            <Rectangle
                id="homeFocusRect"
                width="80"
                height="44"
                color="0xFFFFFFFF"
                opacity="0.0" />
            <Label
                id="homeIcon"
                text="⌂"
                width="80"
                height="44"
                horizAlign="center"
                vertAlign="center"
                font="font:MediumBoldSystemFont"
                color="0xFFFFFFFF" />
            <Label
                id="homeLabel"
                text="Home"
                translation="[80, 0]"
                height="44"
                vertAlign="center"
                font="font:SmallSystemFont"
                color="0xFFFFFFFF"
                opacity="0.0" />
        </Group>

        <!-- Expand/collapse animation -->
        <Animation id="expandAnim" duration="0.15" easeFunction="outCubic">
            <FloatFieldInterpolator
                id="expandedBgFade"
                key="[0.0, 1.0]"
                keyValue="[0.0, 0.95]"
                fieldToInterp="expandedBg.opacity" />
            <FloatFieldInterpolator
                id="brandFade"
                key="[0.0, 1.0]"
                keyValue="[0.0, 1.0]"
                fieldToInterp="brandLabel.opacity" />
            <FloatFieldInterpolator
                id="homeLabelFade"
                key="[0.0, 1.0]"
                keyValue="[0.0, 1.0]"
                fieldToInterp="homeLabel.opacity" />
            <FloatFieldInterpolator
                id="homeFocusFade"
                key="[0.0, 1.0]"
                keyValue="[0.0, 0.15]"
                fieldToInterp="homeFocusRect.opacity" />
        </Animation>
    </children>
</component>
```

- [ ] **Step 2: Create NavBar.brs**

```brightscript
sub init()
    m.expandAnim = m.top.findNode("expandAnim")
    m.expandedBgFade = m.top.findNode("expandedBgFade")
    m.brandFade = m.top.findNode("brandFade")
    m.homeLabelFade = m.top.findNode("homeLabelFade")
    m.homeFocusFade = m.top.findNode("homeFocusFade")
    m.homeFocusRect = m.top.findNode("homeFocusRect")
    m.top.observeFieldScoped("focusedChild", "onFocusChange")
end sub

sub onFocusChange()
    hasFocus = m.top.isInFocusChain()
    if hasFocus = m.top.isExpanded then return
    m.top.isExpanded = hasFocus

    m.expandAnim.control = "stop"
    m.expandedBgFade.reverse = not hasFocus
    m.brandFade.reverse = not hasFocus
    m.homeLabelFade.reverse = not hasFocus
    m.homeFocusFade.reverse = not hasFocus
    m.expandAnim.control = "start"

    if hasFocus
        m.homeFocusRect.opacity = 0.15
    end if
end sub

function onKeyEvent(key as string, press as boolean) as boolean
    keys = RemoteKeys()
    if press
        if key = keys.right or key = keys.ok
            ' Signal parent to focus the content area
            ' Parent (MainScene) watches focusedChild changes
            return false
        end if
    end if
    return false
end function
```

- [ ] **Step 3: Commit**

```bash
git add roku-app/components/NavBar.xml roku-app/components/NavBar.brs
git commit -m "feat(roku): add NavBar — collapsible left sidebar with YouTube branding"
```

---

## Task 6: Create MainScene — Root Scene with Navigation

**Files:**
- Create: `roku-app/components/MainScene.xml`
- Create: `roku-app/components/MainScene.brs`
- Modify: `roku-app/source/main.brs`
- Delete: `roku-app/components/ProfileSelect.xml`, `roku-app/components/ProfileSelect.brs`

MainScene is the new root Scene. It owns the full lifecycle: profile selection → home screen → video playback. ProfileSelect logic moves inline (two focusable cards in a Group). The NavBar sits on the left, content area on the right.

- [ ] **Step 1: Create MainScene.xml**

```xml
<?xml version="1.0" encoding="utf-8" ?>
<component name="MainScene" extends="Scene">
    <script type="text/brightscript" uri="pkg:/components/RemoteKeys.brs" />
    <script type="text/brightscript" uri="pkg:/components/MainScene.brs" />
    <children>
        <!-- Profile selection screen -->
        <Group id="profileUI">
            <Rectangle width="1280" height="720" color="0x0F0F0FFF" />
            <Label id="profileTitle" text="Who's watching?"
                   width="1280" horizAlign="center"
                   translation="[0, 180]"
                   font="font:LargeBoldSystemFont" color="0xFFFFFFFF" />
            <Group id="profileCards" translation="[0, 280]">
                <Group id="child1Card" translation="[340, 0]">
                    <Rectangle id="child1Bg" width="200" height="200" color="0x282828FF" cornerRadius="8" />
                    <Poster id="child1Avatar" width="200" height="200" loadDisplayMode="scaleToZoom" />
                    <Rectangle id="child1Focus" width="200" height="200" color="0x00000000" cornerRadius="8" />
                    <Label text="Child1" width="200" horizAlign="center"
                           translation="[0, 210]"
                           font="font:MediumBoldSystemFont" color="0xFFFFFFFF" />
                </Group>
                <Group id="child2Card" translation="[740, 0]">
                    <Rectangle id="child2Bg" width="200" height="200" color="0x282828FF" cornerRadius="8" />
                    <Poster id="child2Avatar" width="200" height="200" loadDisplayMode="scaleToZoom" />
                    <Rectangle id="child2Focus" width="200" height="200" color="0x00000000" cornerRadius="8" />
                    <Label text="Child2" width="200" horizAlign="center"
                           translation="[0, 210]"
                           font="font:MediumBoldSystemFont" color="0xFFFFFFFF" />
                </Group>
            </Group>
        </Group>

        <!-- Main app layout (hidden until profile selected) -->
        <Group id="appLayout" visible="false">
            <NavBar id="navBar" />
            <Group id="contentArea" translation="[80, 0]">
                <Group id="homeWrapper" />
            </Group>
            <Group id="videoContainer" />
        </Group>
    </children>
</component>
```

- [ ] **Step 2: Create MainScene.brs**

```brightscript
sub init()
    m.top.backgroundColor = "0x0F0F0FFF"

    ' Profile selection
    m.profileUI = m.top.findNode("profileUI")
    m.child1Focus = m.top.findNode("child1Focus")
    m.child2Focus = m.top.findNode("child2Focus")
    m.selectedProfile = 0

    ' App layout
    m.appLayout = m.top.findNode("appLayout")
    m.navBar = m.top.findNode("navBar")
    m.contentArea = m.top.findNode("contentArea")
    m.homeWrapper = m.top.findNode("homeWrapper")
    m.videoContainer = m.top.findNode("videoContainer")

    updateProfileHighlight()
end sub

sub updateProfileHighlight()
    if m.selectedProfile = 0
        m.child1Focus.color = "0xFFFFFF33"
        m.child2Focus.color = "0x00000000"
    else
        m.child1Focus.color = "0x00000000"
        m.child2Focus.color = "0xFFFFFF33"
    end if
end sub

sub selectProfile(profileId as integer, profileName as string)
    m.global.profileId = profileId
    m.global.profileName = profileName

    m.profileUI.visible = false
    m.appLayout.visible = true

    m.homeScreen = m.homeWrapper.createChild("HomeScreen")
    m.homeScreen.profileId = profileId
    m.homeScreen.observeFieldScoped("isDone", "onHomeDone")
    m.homeScreen.observeFieldScoped("isPlaying", "onHomePlaying")
    m.homeScreen.setFocus(true)
end sub

sub onHomePlaying()
    if m.homeScreen = invalid then return
    if m.homeScreen.isPlaying
        m.homeWrapper.visible = false
        m.navBar.visible = false
        m.player = m.videoContainer.createChild("VideoPlayer")
        m.player.videoId = m.homeScreen.pendingVideoId
        m.player.videoTitle = m.homeScreen.pendingVideoTitle
        m.player.observeFieldScoped("isDone", "onPlayerDone")
        m.player.setFocus(true)
    else
        m.homeWrapper.visible = true
        m.navBar.visible = true
    end if
end sub

sub onPlayerDone()
    if m.player <> invalid
        m.player.unobserveField("isDone")
        m.videoContainer.removeChild(m.player)
        m.player = invalid
    end if
    if m.homeScreen <> invalid
        m.homeScreen.isPlaying = false
        m.homeScreen.setFocus(true)
    end if
end sub

sub onHomeDone()
    if m.homeScreen <> invalid
        m.homeScreen.unobserveField("isDone")
        m.homeScreen.unobserveField("isPlaying")
        m.homeWrapper.removeChild(m.homeScreen)
        m.homeScreen = invalid
    end if
    m.appLayout.visible = false
    m.profileUI.visible = true
    m.selectedProfile = 0
    updateProfileHighlight()
    m.top.setFocus(true)
end sub

function onKeyEvent(key as string, press as boolean) as boolean
    keys = RemoteKeys()
    if not press then return false

    ' Profile selection mode
    if m.profileUI.visible
        if key = keys.ok or key = keys.play
            if m.selectedProfile = 0
                selectProfile(5, "Child1")
            else
                selectProfile(6, "Child2")
            end if
            return true
        else if key = keys.right and m.selectedProfile = 0
            m.selectedProfile = 1
            updateProfileHighlight()
            return true
        else if key = keys.left and m.selectedProfile = 1
            m.selectedProfile = 0
            updateProfileHighlight()
            return true
        end if
        return false
    end if

    ' App mode — Left arrow from content area goes to NavBar
    if key = keys.left and m.homeScreen <> invalid and m.homeScreen.isInFocusChain()
        m.navBar.setFocus(true)
        return true
    end if

    ' Right arrow from NavBar goes back to content
    if key = keys.right and m.navBar.isInFocusChain()
        if m.homeScreen <> invalid
            m.homeScreen.setFocus(true)
        end if
        return true
    end if

    return false
end function
```

- [ ] **Step 3: Update main.brs — change initial scene and fix global field order**

Replace the full content of `roku-app/source/main.brs`:

```brightscript
sub Main(args as Dynamic)
    screen = CreateObject("roSGScreen")
    m.port = CreateObject("roMessagePort")
    screen.setMessagePort(m.port)

    ' Set global fields BEFORE show() so init() in child components can read them
    globalNode = screen.getGlobalNode()
    globalNode.addFields({ backendUrl: "http://LAN_IP:3001", profileId: 0, profileName: "" })

    scene = screen.CreateScene("MainScene")
    screen.show()
    scene.setFocus(true)

    while true
        msg = wait(0, m.port)
        if type(msg) = "roSGScreenEvent" and msg.isScreenClosed() then return
    end while
end sub
```

**Note:** The `backendUrl` IP address (`LAN_IP`) must match the dev server's LAN IP. Verify with `hostname -I | awk '{print $1}'` on the server and update if different.

- [ ] **Step 4: Delete old ProfileSelect files**

```bash
rm -f roku-app/components/ProfileSelect.xml roku-app/components/ProfileSelect.brs
```

- [ ] **Step 5: Commit**

```bash
git add roku-app/components/MainScene.xml roku-app/components/MainScene.brs roku-app/source/main.brs
git add -u roku-app/components/
git commit -m "feat(roku): MainScene root with profile select, NavBar, and HomeScreen lifecycle"
```

---

## Task 7: Update Manifest and Build ZIP

**Files:**
- Modify: `roku-app/manifest`

- [ ] **Step 1: Bump manifest version**

Replace the content of `roku-app/manifest`:

```
title=KidsTube
subtitle=Parent-controlled videos
major_version=2
minor_version=0
build_version=0
mm_icon_focus_hd=pkg:/images/channel_poster_hd.jpg
mm_icon_focus_sd=pkg:/images/channel_poster_sd.jpg
splash_screen_hd=pkg:/images/splash_hd.jpg
splash_color=#0F0F0F
splash_min_time=1000
ui_resolutions=hd
```

- [ ] **Step 2: Verify the backendUrl IP is correct**

```bash
hostname -I | awk '{print $1}'
```

Compare the output with the IP in `roku-app/source/main.brs`. If different, update `main.brs` to match.

- [ ] **Step 3: Build the ZIP**

```bash
cd /home/michael/projects/kidstube/roku-app
zip -r ../kidstube-roku.zip . -x "*.DS_Store"
```

- [ ] **Step 4: Verify ZIP structure**

```bash
unzip -l ../kidstube-roku.zip | head -25
```

Expected: `manifest` at root level. Files should include `components/MainScene.xml`, `components/HomeScreen.xml`, `components/VideoRowCell.xml`, `components/NavBar.xml`. Should NOT include `HomeScene.xml`, `ItemRenderer.xml`, or `ProfileSelect.xml`.

- [ ] **Step 5: Commit**

```bash
cd /home/michael/projects/kidstube
git add roku-app/manifest kidstube-roku.zip
git commit -m "feat(roku): v2.0.0 — RowList UI rebuild with NavBar, VideoRowCell, and Continue Watching"
```

---

## Sideload Command (for human testing)

After all tasks are complete, sideload to the Roku:

```bash
curl -s -S -F "mysubmit=Install" -F "archive=@kidstube-roku.zip" \
  --digest -u rokudev:(device password) \
  "http://192.168.1.37/plugin_install"
```

**Telnet debug console** (BrightScript print output):

```bash
telnet 192.168.1.37 8085
```

## Smoke Test Checklist

- [ ] App launches, profile selection shows Child1 and Child2 cards
- [ ] Left/Right navigates between cards, focus highlight visible
- [ ] OK selects profile, transitions to home screen with NavBar
- [ ] RowList shows "Continue Watching" row (if watch history exists) and "Recommended" row
- [ ] Horizontal scroll within a row works
- [ ] Video thumbnails load, duration badges show formatted times
- [ ] OK on a video starts playback
- [ ] Back during playback returns to home screen
- [ ] Back on home screen returns to profile select
- [ ] Left arrow from home screen focuses NavBar, sidebar expands
- [ ] Right arrow from NavBar returns to content
