sub Main(args as Dynamic)
    screen = CreateObject("roSGScreen")
    m.port = CreateObject("roMessagePort")
    screen.setMessagePort(m.port)
    scene = screen.CreateScene("ProfileSelect")
    screen.show()
    scene.getGlobalNode().addField("backendUrl", "string", false)
    scene.getGlobalNode().addField("profileId", "integer", false)
    scene.getGlobalNode().addField("profileName", "string", false)
    scene.getGlobalNode().backendUrl = "http://172.22.165.254:3001"
    scene.getGlobalNode().profileId = 0
    scene.getGlobalNode().profileName = ""
    while true
        msg = wait(0, m.port)
        if type(msg) = "roSGScreenEvent" and msg.isScreenClosed() then return
    end while
end sub
