sub Main(args as Dynamic)
    screen = CreateObject("roSGScreen")
    m.port = CreateObject("roMessagePort")
    screen.setMessagePort(m.port)
    scene = screen.CreateScene("ProfileSelect")
    screen.show()
    globalNode = screen.getGlobalNode()
    globalNode.addFields({ backendUrl: "http://192.168.1.221:3001", profileId: 0, profileName: "" })
    scene.setFocus(true)
    while true
        msg = wait(0, m.port)
        if type(msg) = "roSGScreenEvent" and msg.isScreenClosed() then return
    end while
end sub
