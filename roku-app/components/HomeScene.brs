sub init()
    m.videoGrid = m.top.findNode("videoGrid")
    m.top.findNode("profileLabel").text = m.global.profileName
    m.videoGrid.itemComponentName = "ItemRenderer"
    m.videoGrid.observeFieldScoped("itemSelected", "onItemSelected")
    m.top.observeField("isPlaying", "onIsPlayingChange")
    m.lastSelectedIndex = 0
    m.videoGrid.setFocus(true)
    fetchFeed()
end sub

sub fetchFeed()
    m.task = createObject("roSGNode", "FetchTask")
    m.task.url = m.global.backendUrl + "/api/feed/" + m.global.profileId.toStr() + "?limit=40"
    m.task.observeFieldScoped("response", "onFeedLoaded")
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
    if m.top.isPlaying then return   ' guard: already in playback
    item = m.videoGrid.content.getChild(m.videoGrid.itemSelected)
    if item = invalid then return
    m.lastSelectedIndex = m.videoGrid.itemSelected
    ' Pass video info to ProfileSelect (which owns VideoPlayer lifecycle) via interface fields
    m.top.pendingVideoId = item.videoId
    m.top.pendingVideoTitle = item.title
    ' ProfileSelect observes isPlaying and creates the VideoPlayer in videoContainer
    m.top.isPlaying = true
end sub

sub onIsPlayingChange()
    ' ProfileSelect sets isPlaying = false when playback ends — restore grid focus
    if not m.top.isPlaying then
        m.videoGrid.setFocus(true)
        if m.lastSelectedIndex > 0
            m.videoGrid.jumpToItem = m.lastSelectedIndex
        end if
    end if
end sub

function onKeyEvent(key as String, press as Boolean) as Boolean
    keys = RemoteKeys()
    if press and key = keys.back then
        m.top.isDone = true
        return true
    end if
    return false
end function
