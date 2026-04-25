sub Main(args as Dynamic)
    screen = CreateObject("roSGScreen")
    m.port = CreateObject("roMessagePort")
    screen.setMessagePort(m.port)

    ' Set global fields BEFORE show() so init() in child components can read them
    globalNode = screen.getGlobalNode()
    globalNode.addFields({ backendUrl: "http://LAN_IP:3001", profileId: 0, profileName: "" })

    scene = screen.CreateScene("MainScene")
    screen.show()
    scene.setFocus(true)

    while true
        msg = wait(0, m.port)
        if type(msg) = "roSGScreenEvent" and msg.isScreenClosed() then return
    end while
end sub
