sub init()
    m.top.functionName = "runFetch"
end sub

sub runFetch()
    http = createObject("roUrlTransfer")
    http.setUrl(m.top.url)
    http.setCertificatesFile("common:/certs/ca-bundle.crt")
    http.InitClientCertificates()
    ' Note: setConnectTimeout/setTransferTimeout not available on all Roku firmware
    ' Using SetMinimumTransferRate as a fallback timeout mechanism
    ' If transfer drops below 100 bytes/sec for 15 seconds, abort
    http.EnableFreshConnection(true)
    http.SetMinimumTransferRate(100, 15)
    if m.top.method = "POST" then
        http.setRequest("POST")
        http.addHeader("Content-Type", "application/json")
        m.top.response = http.postFromString(m.top.body)
    else
        m.top.response = http.GetToString()
    end if
end sub
