sub init()
    m.videoGrid = m.top.findNode("videoGrid")
    m.top.findNode("profileLabel").text = m.global.profileName
    m.videoGrid.itemComponentName = "ItemRenderer"
    m.videoGrid.observeFieldScoped("itemSelected", "onItemSelected")
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
    if m.player <> invalid then return
    item = m.videoGrid.content.getChild(m.videoGrid.itemSelected)
    if item = invalid then return
    m.lastSelectedIndex = m.videoGrid.itemSelected
    ' Signal the parent (ProfileSelect) to hide us — a component cannot modify its own
    ' root node's rendering properties (visible/opacity) from within its own BrightScript
    m.top.isPlaying = true
    m.player = m.top.getScene().createChild("VideoPlayer")
    m.player.videoId = item.videoId
    m.player.videoTitle = item.title
    m.player.observeFieldScoped("isDone", "onPlaybackDone")
    m.player.setFocus(true)
end sub

sub onPlaybackDone()
    print "[HomeScene] onPlaybackDone — restoring UI and focus"
    m.top.getScene().removeChild(m.player)
    m.player = invalid
    m.top.isPlaying = false
    m.videoGrid.setFocus(true)
    if m.lastSelectedIndex > 0
        m.videoGrid.jumpToItem = m.lastSelectedIndex
    end if
end sub

function onKeyEvent(key as String, press as Boolean) as Boolean
    print "[HomeScene] onKeyEvent key=" key " press=" press
    keys = RemoteKeys()
    if press and key = keys.back then
        m.top.isDone = true
        return true
    end if
    return false
end function
