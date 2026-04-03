sub init()
    ' m.top IS the Video node (extends Video) — no separate child Video needed
    m.top.width = 1280
    m.top.height = 720
    ' Disable the built-in Roku video OSD — it takes over focus and key handling
    ' when state=playing, routing key events away from our onKeyEvent
    m.top.enableUI = false
    ' Roku OS 12.5+: async stop prevents synchronous timeout crashes when
    ' rapidly creating/destroying VideoPlayer nodes
    if m.top.hasField("asyncStopSemantics")
        m.top.asyncStopSemantics = true
    end if
    ' Claim focus immediately — don't wait for the caller to setFocus after creation,
    ' because hiding the grid in onItemSelected can shift focus to the Scene first
    m.top.setFocus(true)
    m.loadingBg = m.top.findNode("loadingBg")
    m.loadingLabel = m.top.findNode("loadingLabel")
    m.top.observeField("state", "onPlayerStateChange")
    m.top.observeField("videoId", "onVideoIdSet")
    m.lastReportedPosition = 0
    m.progressTimer = createObject("roSGNode", "Timer")
    m.progressTimer.duration = 10
    m.progressTimer.repeat = true
    m.progressTimer.observeField("fire", "reportProgress")
end sub

sub onVideoIdSet()
    if m.top.videoId = "" then return
    if m.top.videoId = invalid then return
    m.loadingBg.visible = true
    m.loadingLabel.visible = true
    m.streamTask = createObject("roSGNode", "FetchTask")
    m.streamTask.url = m.global.backendUrl + "/api/stream/" + m.top.videoId
    m.streamTask.observeFieldScoped("response", "onStreamUrlLoaded")
    m.streamTask.control = "RUN"
end sub

sub onStreamUrlLoaded()
    parsed = ParseJson(m.streamTask.response)
    if parsed = invalid then
        print "[VideoPlayer] stream response parse failed"
        m.loadingLabel.visible = false
        showErrorDialog("This video is not available right now.")
        return
    end if
    if parsed.url = invalid then
        print "[VideoPlayer] stream response missing url"
        m.loadingLabel.visible = false
        showErrorDialog("This video is not available right now.")
        return
    end if
    print "[VideoPlayer] got stream url type=" parsed.type
    content = createObject("roSGNode", "ContentNode")
    content.url = parsed.url
    content.title = m.top.videoTitle
    content.streamFormat = parsed.type
    m.top.content = content
    m.top.control = "play"
    m.top.setFocus(true)
    m.progressTimer.control = "start"
end sub

sub onPlayerStateChange()
    state = m.top.state
    if state = "playing" then
        ' Re-assert focus — hiding child nodes can cause Roku to shift focus away
        m.top.setFocus(true)
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
        print "[VideoPlayer] error=" m.top.errorStr
        m.loadingLabel.visible = false
        showErrorDialog("Could not play this video. Please try again.")
    end if
    ' Only signal done after Video node has fully stopped so Roku releases the
    ' media engine before ProfileSelect removes this node and creates a new one
    if state = "stopped" then
        m.top.isDone = true
    end if
end sub

sub showErrorDialog(message as String)
    dialog = createObject("roSGNode", "SimpleDialog")
    dialog.title = "Video Unavailable"
    dialog.message = message
    dialog.buttons = ["OK"]
    dialog.observeFieldScoped("buttonSelected", "onErrorDialogButton")
    m.top.getScene().dialog = dialog
    ' Auto-dismiss after 4 seconds if user doesn't press OK
    m.dismissTimer = createObject("roSGNode", "Timer")
    m.dismissTimer.duration = 4
    m.dismissTimer.repeat = false
    m.dismissTimer.observeFieldScoped("fire", "onDismissTimer")
    m.dismissTimer.control = "start"
end sub

sub onErrorDialogButton()
    m.top.getScene().dialog = invalid
    if m.dismissTimer <> invalid
        m.dismissTimer.control = "stop"
        m.dismissTimer = invalid
    end if
    dismiss()
end sub

sub onDismissTimer()
    m.top.getScene().dialog = invalid
    dismiss()
end sub

sub dismiss()
    m.top.control = "stop"
    ' isDone is set in onPlayerStateChange when state="stopped"
    ' This ensures the media engine is released before the node is removed
end sub

sub reportProgress()
    curPos = m.top.position
    curDur = m.top.duration
    if curPos <= 0 then return
    if curPos = m.lastReportedPosition then return
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
    keys = RemoteKeys()
    if press then
        if key = keys.back then
            m.progressTimer.control = "stop"
            reportProgress()
            dismiss()
            return true
        end if
    end if
    return false
end function
