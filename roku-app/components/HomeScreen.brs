sub init()
    m.rowList = m.top.findNode("rowList")
    m.loadingGroup = m.top.findNode("loadingGroup")
    m.lastSelectedIndex = 0
    m.rowList.observeFieldScoped("rowItemSelected", "onItemSelected")
    ' Pass focus down to RowList when HomeScreen receives focus
    m.top.observeFieldScoped("focusedChild", "onFocusChanged")
end sub

sub onFocusChanged()
    if m.top.isInFocusChain() and not m.rowList.hasFocus()
        m.rowList.setFocus(true)
    end if
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
                ' Force float division to avoid integer truncation to 0
                pct = (item.progress_seconds * 1.0) / (item.duration_seconds * 1.0)
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
