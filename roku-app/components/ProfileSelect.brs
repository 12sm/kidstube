sub init()
    ' Transparent canvas so the hardware video plane shows through during playback
    m.top.backgroundColor = &h00000000
    m.profileUI = m.top.findNode("profileUI")
    m.westonCard = m.top.findNode("westonCard")
    m.emeryCard = m.top.findNode("emeryCard")
    m.homeWrapper = m.top.findNode("homeWrapper")
    m.videoContainer = m.top.findNode("videoContainer")
    m.selectedIndex = 0
    updateHighlight()
    m.top.setFocus(true)
end sub

sub updateHighlight()
    if m.selectedIndex = 0 then
        m.westonCard.color = "0x4A4A8EFF"
        m.emeryCard.color = "0x2D2D5EFF"
    else
        m.westonCard.color = "0x2D2D5EFF"
        m.emeryCard.color = "0x4A4A8EFF"
    end if
end sub

function onKeyEvent(key as String, press as Boolean) as Boolean
    keys = RemoteKeys()
    if press then
        if key = keys.ok or key = keys.play then
            if m.selectedIndex = 0 then
                selectProfile(5, "Weston")
            else
                selectProfile(6, "Emery")
            end if
            return true
        else if key = keys.right and m.selectedIndex = 0 then
            m.selectedIndex = 1
            updateHighlight()
            return true
        else if key = keys.left and m.selectedIndex = 1 then
            m.selectedIndex = 0
            updateHighlight()
            return true
        end if
    end if
    return false
end function

sub selectProfile(profileId as Integer, profileName as String)
    m.global.profileId = profileId
    m.global.profileName = profileName
    m.profileUI.visible = false
    ' HomeScene lives inside homeWrapper — toggling the wrapper hides/shows it
    ' (can't reliably set visible/opacity on a component root node from outside)
    m.homeScene = m.homeWrapper.createChild("HomeScene")
    m.homeScene.observeFieldScoped("isDone", "onHomeDone")
    m.homeScene.observeFieldScoped("isPlaying", "onHomeScenePlaying")
    m.homeScene.setFocus(true)
end sub

sub onHomeScenePlaying()
    if m.homeScene = invalid then return
    if m.homeScene.isPlaying then
        ' HomeScene wants to play a video — hide the UI layer and create the player
        m.homeWrapper.visible = false
        m.player = m.videoContainer.createChild("VideoPlayer")
        m.player.videoId = m.homeScene.pendingVideoId
        m.player.videoTitle = m.homeScene.pendingVideoTitle
        m.player.observeFieldScoped("isDone", "onPlayerDone")
        m.player.setFocus(true)
    else
        ' Playback ended — show the UI layer
        m.homeWrapper.visible = true
    end if
end sub

sub onPlayerDone()
    if m.player <> invalid
        m.player.unobserveField("isDone")
        m.videoContainer.removeChild(m.player)
        m.player = invalid
    end if
    ' Tell HomeScene playback is over so it can restore grid focus
    if m.homeScene <> invalid
        m.homeScene.isPlaying = false
    end if
end sub

sub onHomeDone()
    if m.homeScene <> invalid
        m.homeScene.unobserveField("isDone")
        m.homeScene.unobserveField("isPlaying")
        m.homeWrapper.removeChild(m.homeScene)   ' HomeScene is under homeWrapper, not Scene root
        m.homeScene = invalid
    end if
    m.homeWrapper.visible = true
    m.profileUI.visible = true
    m.top.setFocus(true)
end sub
