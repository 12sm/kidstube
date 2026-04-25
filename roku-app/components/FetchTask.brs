sub init()
    m.top.functionName = "runFetch"
end sub

sub runFetch()
    http = createObject("roUrlTransfer")
    http.setUrl(m.top.url)
    http.setCertificatesFile("common:/certs/ca-bundle.crt")
    http.InitClientCertificates()
    http.setConnectTimeout(5000)
    http.setTransferTimeout(15000)
    if m.top.method = "POST" then
        http.setRequest("POST")
        http.addHeader("Content-Type", "application/json")
        m.top.response = http.postFromString(m.top.body)
    else
        m.top.response = http.GetToString()
    end if
end sub
