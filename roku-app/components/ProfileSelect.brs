sub init()
    m.westonCard = m.top.findNode("westonCard")
    m.emeryCard = m.top.findNode("emeryCard")
    m.top.setFocus(true)
    m.westonCard.setFocus(true)
end sub

function onKeyEvent(key as String, press as Boolean) as Boolean
    if press
        if key = "OK"
            if m.westonCard.hasFocus() then selectProfile(5, "Weston")
            if m.emeryCard.hasFocus() then selectProfile(6, "Emery")
            return true
        else if key = "right" and m.westonCard.hasFocus()
            m.emeryCard.setFocus(true)
            m.emeryCard.color = "0x4A4A8EFF"
            m.westonCard.color = "0x2D2D5EFF"
            return true
        else if key = "left" and m.emeryCard.hasFocus()
            m.westonCard.setFocus(true)
            m.westonCard.color = "0x4A4A8EFF"
            m.emeryCard.color = "0x2D2D5EFF"
            return true
        end if
    end if
    return false  ' back key: let Roku show system exit dialog
end function

sub selectProfile(profileId as Integer, profileName as String)
    m.global.profileId = profileId
    m.global.profileName = profileName
    homeScene = m.top.getScene().createChild("HomeScene")
    homeScene.setFocus(true)
end sub
