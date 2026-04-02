sub init()
    m.videoNode = createObject("roSGNode", "Video")
    m.videoNode.width = 1280
    m.videoNode.height = 720
    m.top.appendChild(m.videoNode)
    m.loadingBg = m.top.findNode("loadingBg")
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
    if m.top.videoId = "" then
        return
    end if
    if m.top.videoId = invalid then
        return
    end if
    m.loadingBg.visible = true
    m.loadingLabel.visible = true
    m.errorLabel.visible = false
    m.streamTask = createObject("roSGNode", "FetchTask")
    m.streamTask.url = m.global.backendUrl + "/api/stream/" + m.top.videoId
    m.streamTask.observeField("response", "onStreamUrlLoaded")
    m.streamTask.control = "RUN"
end sub

sub onStreamUrlLoaded()
    parsed = ParseJson(m.streamTask.response)
    if parsed = invalid then
        print "[VideoPlayer] stream response parse failed"
        m.loadingLabel.visible = false
        m.errorLabel.text = "Stream unavailable"
        m.errorLabel.visible = true
        return
    end if
    if parsed.url = invalid then
        print "[VideoPlayer] stream response missing url"
        m.loadingLabel.visible = false
        m.errorLabel.text = "Video unavailable"
        m.errorLabel.visible = true
        m.dismissTimer = createObject("roSGNode", "Timer")
        m.dismissTimer.duration = 2
        m.dismissTimer.repeat = false
        m.dismissTimer.observeField("fire", "onDismissTimer")
        m.dismissTimer.control = "start"
        return
    end if
    print "[VideoPlayer] got stream url type=" parsed.type
    m.loadingLabel.visible = false
    content = createObject("roSGNode", "ContentNode")
    content.url = parsed.url
    content.title = m.top.videoTitle
    content.streamFormat = parsed.type
    m.videoNode.content = content
    m.videoNode.control = "play"
    m.videoNode.setFocus(true)
    m.progressTimer.control = "start"
end sub

sub onPlayerStateChange()
    state = m.videoNode.state
    print "[VideoPlayer] state=" state
    if state = "playing" then
        ' Hide all UI so the hardware video plane shows through
        m.loadingBg.visible = false
        m.loadingLabel.visible = false
    end if
    if state = "finished" then
        m.progressTimer.control = "stop"
        reportProgress()
        dismiss()
    end if
    if state = "error" then
        m.progressTimer.control = "stop"
        print "[VideoPlayer] error=" m.videoNode.errorStr
        m.loadingLabel.visible = false
        m.errorLabel.text = "Video unavailable"
        m.errorLabel.visible = true
        m.dismissTimer = createObject("roSGNode", "Timer")
        m.dismissTimer.duration = 2
        m.dismissTimer.repeat = false
        m.dismissTimer.observeField("fire", "onDismissTimer")
        m.dismissTimer.control = "start"
    end if
end sub

sub onDismissTimer()
    dismiss()
end sub

sub dismiss()
    m.videoNode.control = "stop"
    m.top.isDone = true
end sub

sub reportProgress()
    curPos = m.videoNode.position
    curDur = m.videoNode.duration
    if curPos <= 0 then
        return
    end if
    if curPos = m.lastReportedPosition then
        return
    end if
    m.lastReportedPosition = curPos
    reqBody = {}
    reqBody["profile_id"] = m.global.profileId
    reqBody["video_id"] = m.top.videoId
    reqBody["progress_seconds"] = curPos
    reqBody["duration_seconds"] = curDur
    httpTask = createObject("roSGNode", "FetchTask")
    httpTask.url = m.global.backendUrl + "/api/watch-history"
    httpTask.method = "POST"
    httpTask.body = FormatJson(reqBody)
    httpTask.control = "RUN"
end sub

function onKeyEvent(key as String, press as Boolean) as Boolean
    if press then
        if key = "back" then
            m.progressTimer.control = "stop"
            reportProgress()
            dismiss()
            return true
        end if
    end if
    return false
end function
