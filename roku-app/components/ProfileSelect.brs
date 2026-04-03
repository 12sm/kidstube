sub init()
    ' Transparent canvas so the hardware video plane shows through during playback
    m.top.backgroundColor = &h00000000
    m.profileUI = m.top.findNode("profileUI")
    m.westonCard = m.top.findNode("westonCard")
    m.emeryCard = m.top.findNode("emeryCard")
    m.homeWrapper = m.top.findNode("homeWrapper")
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
    ' HomeScene lives inside homeWrapper so we can hide/show it by toggling the wrapper
    ' (can't reliably set visible/opacity on a component root node from outside)
    m.homeScene = m.homeWrapper.createChild("HomeScene")
    m.homeScene.observeField("isDone", "onHomeDone")
    m.homeScene.observeField("isPlaying", "onHomeScenePlaying")
    m.homeScene.setFocus(true)
end sub

sub onHomeScenePlaying()
    if m.homeScene = invalid then return
    if m.homeScene.isPlaying then
        print "[ProfileSelect] hiding homeWrapper (video playing)"
        m.homeWrapper.visible = false
    else
        print "[ProfileSelect] showing homeWrapper (video done)"
        m.homeWrapper.visible = true
    end if
end sub

sub onHomeDone()
    m.top.getScene().removeChild(m.homeScene)
    m.homeScene = invalid
    m.profileUI.visible = true
    m.top.setFocus(true)
end sub
