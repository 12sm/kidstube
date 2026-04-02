sub init()
    m.westonCard = m.top.findNode("westonCard")
    m.emeryCard = m.top.findNode("emeryCard")
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
    if press then
        if key = "OK" or key = "play" then
            if m.selectedIndex = 0 then
                selectProfile(5, "Weston")
            else
                selectProfile(6, "Emery")
            end if
            return true
        else if key = "right" and m.selectedIndex = 0 then
            m.selectedIndex = 1
            updateHighlight()
            return true
        else if key = "left" and m.selectedIndex = 1 then
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
    m.top.findNode("profileUI").visible = false
    m.homeScene = m.top.getScene().createChild("HomeScene")
    m.homeScene.observeField("isDone", "onHomeDone")
    m.homeScene.setFocus(true)
end sub

sub onHomeDone()
    m.top.getScene().removeChild(m.homeScene)
    m.homeScene = invalid
    m.top.findNode("profileUI").visible = true
    m.top.setFocus(true)
end sub
