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
