sub init()
    m.top.backgroundColor = "0x0F0F0FFF"

    ' Profile selection
    m.profileUI = m.top.findNode("profileUI")
    m.child1Focus = m.top.findNode("child1Focus")
    m.child2Focus = m.top.findNode("child2Focus")
    m.selectedProfile = 0

    ' App layout
    m.appLayout = m.top.findNode("appLayout")
    m.navBar = m.top.findNode("navBar")
    m.contentArea = m.top.findNode("contentArea")
    m.homeWrapper = m.top.findNode("homeWrapper")
    m.videoContainer = m.top.findNode("videoContainer")

    updateProfileHighlight()
end sub

sub updateProfileHighlight()
    if m.selectedProfile = 0
        m.child1Focus.color = "0xFFFFFF33"
        m.child2Focus.color = "0x00000000"
    else
        m.child1Focus.color = "0x00000000"
        m.child2Focus.color = "0xFFFFFF33"
    end if
end sub

sub selectProfile(profileId as integer, profileName as string)
    m.global.profileId = profileId
    m.global.profileName = profileName

    m.profileUI.visible = false
    m.appLayout.visible = true

    m.homeScreen = m.homeWrapper.createChild("HomeScreen")
    m.homeScreen.profileId = profileId
    m.homeScreen.observeFieldScoped("isDone", "onHomeDone")
    m.homeScreen.observeFieldScoped("isPlaying", "onHomePlaying")
    m.homeScreen.setFocus(true)
end sub

sub onHomePlaying()
    if m.homeScreen = invalid then return
    if m.homeScreen.isPlaying
        m.homeWrapper.visible = false
        m.navBar.visible = false
        m.player = m.videoContainer.createChild("VideoPlayer")
        m.player.videoId = m.homeScreen.pendingVideoId
        m.player.videoTitle = m.homeScreen.pendingVideoTitle
        m.player.observeFieldScoped("isDone", "onPlayerDone")
        m.player.setFocus(true)
    else
        m.homeWrapper.visible = true
        m.navBar.visible = true
    end if
end sub

sub onPlayerDone()
    if m.player <> invalid
        m.player.unobserveField("isDone")
        m.videoContainer.removeChild(m.player)
        m.player = invalid
    end if
    if m.homeScreen <> invalid
        m.homeScreen.isPlaying = false
        m.homeScreen.setFocus(true)
    end if
end sub

sub onHomeDone()
    if m.homeScreen <> invalid
        m.homeScreen.unobserveField("isDone")
        m.homeScreen.unobserveField("isPlaying")
        m.homeWrapper.removeChild(m.homeScreen)
        m.homeScreen = invalid
    end if
    m.appLayout.visible = false
    m.profileUI.visible = true
    m.selectedProfile = 0
    updateProfileHighlight()
    m.top.setFocus(true)
end sub

function onKeyEvent(key as string, press as boolean) as boolean
    keys = RemoteKeys()
    if not press then return false

    ' Profile selection mode
    if m.profileUI.visible
        if key = keys.ok or key = keys.play
            if m.selectedProfile = 0
                selectProfile(5, "Child1")
            else
                selectProfile(6, "Child2")
            end if
            return true
        else if key = keys.right and m.selectedProfile = 0
            m.selectedProfile = 1
            updateProfileHighlight()
            return true
        else if key = keys.left and m.selectedProfile = 1
            m.selectedProfile = 0
            updateProfileHighlight()
            return true
        end if
        return false
    end if

    ' App mode — Left arrow from content area goes to NavBar
    if key = keys.left and m.homeScreen <> invalid and m.homeScreen.isInFocusChain()
        m.navBar.setFocus(true)
        return true
    end if

    ' Right arrow from NavBar goes back to content
    if key = keys.right and m.navBar.isInFocusChain()
        if m.homeScreen <> invalid
            m.homeScreen.setFocus(true)
        end if
        return true
    end if

    return false
end function
