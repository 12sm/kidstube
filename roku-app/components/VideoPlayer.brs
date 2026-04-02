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
