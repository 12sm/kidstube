sub init()
    m.top.backgroundColor = "0x0F0F0FFF"

    ' Profile selection
    m.profileUI = m.top.findNode("profileUI")
    m.profile1Focus = m.top.findNode("profile1Focus")
    m.profile2Focus = m.top.findNode("profile2Focus")
    m.selectedProfile = 0

    ' Fetch profiles from API
    m.profiles = []
    fetchProfiles()

    ' App layout
    m.appLayout = m.top.findNode("appLayout")
    m.navBar = m.top.findNode("navBar")
    m.contentArea = m.top.findNode("contentArea")
    m.homeWrapper = m.top.findNode("homeWrapper")
    m.videoContainer = m.top.findNode("videoContainer")
    m.contentShiftAnim = m.top.findNode("contentShiftAnim")
    m.contentShiftInterp = m.top.findNode("contentShiftInterp")

    ' Observe NavBar expand/collapse to shift content
    m.navBar.observeFieldScoped("isExpanded", "onNavBarExpand")

    updateProfileHighlight()
end sub

sub onNavBarExpand()
    m.contentShiftAnim.control = "stop"
    m.contentShiftInterp.reverse = not m.navBar.isExpanded
    m.contentShiftAnim.control = "start"
end sub

sub fetchProfiles()
    task = createObject("roSGNode", "FetchTask")
    task.url = m.global.backendUrl + "/api/profiles"
    task.observeFieldScoped("response", "onProfilesFetched")
    task.control = "run"
    m.profileFetchTask = task
end sub

sub onProfilesFetched()
    resp = ParseJson(m.profileFetchTask.response)
    m.profileFetchTask.unobserveField("response")
    if resp <> invalid and resp.profiles <> invalid
        m.profiles = resp.profiles
        if m.profiles.count() > 0
            p1 = m.profiles[0]
            m.top.findNode("profile1Initial").text = left(p1.name, 1)
            m.top.findNode("profile1Name").text = p1.name
        end if
        if m.profiles.count() > 1
            p2 = m.profiles[1]
            m.top.findNode("profile2Initial").text = left(p2.name, 1)
            m.top.findNode("profile2Name").text = p2.name
        end if
    end if
end sub

sub updateProfileHighlight()
    if m.selectedProfile = 0
        m.profile1Focus.color = "0xFFFFFF55"
        m.profile2Focus.color = "0x00000000"
    else
        m.profile1Focus.color = "0x00000000"
        m.profile2Focus.color = "0xFFFFFF55"
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
                selectProfile(m.profiles[0].id, m.profiles[0].name)
            else
                selectProfile(m.profiles[1].id, m.profiles[1].name)
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
