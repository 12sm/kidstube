sub init()
    m.expandAnim = m.top.findNode("expandAnim")
    m.expandedBgFade = m.top.findNode("expandedBgFade")
    m.brandFade = m.top.findNode("brandFade")
    m.homeLabelFade = m.top.findNode("homeLabelFade")
    m.homeFocusFade = m.top.findNode("homeFocusFade")
    m.homeFocusRect = m.top.findNode("homeFocusRect")
    m.top.observeFieldScoped("focusedChild", "onFocusChange")
end sub

sub onFocusChange()
    hasFocus = m.top.isInFocusChain()
    if hasFocus = m.top.isExpanded then return
    m.top.isExpanded = hasFocus

    m.expandAnim.control = "stop"
    m.expandedBgFade.reverse = not hasFocus
    m.brandFade.reverse = not hasFocus
    m.homeLabelFade.reverse = not hasFocus
    m.homeFocusFade.reverse = not hasFocus
    m.expandAnim.control = "start"

    if hasFocus
        m.homeFocusRect.opacity = 0.15
    end if
end sub

function onKeyEvent(key as string, press as boolean) as boolean
    keys = RemoteKeys()
    if press
        if key = keys.right or key = keys.ok
            ' Signal parent to focus the content area
            ' Parent (MainScene) watches focusedChild changes
            return false
        end if
    end if
    return false
end function
