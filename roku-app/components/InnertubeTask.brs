sub init()
    m.top.functionName = "runFetch"
end sub

sub runFetch()
    videoId = m.top.videoId
    if videoId = "" or videoId = invalid then return

    ' Call YouTube Innertube API directly from the Roku.
    ' This ensures CDN URLs have the Roku's public IP baked in (no IP mismatch).
    ' IOS client returns pre-signed URLs — no signature deciphering needed.
    http = createObject("roUrlTransfer")
    http.setUrl("https://www.youtube.com/youtubei/v1/player?prettyPrint=false")
    http.setCertificatesFile("common:/certs/ca-bundle.crt")
    http.InitClientCertificates()
    http.setRequest("POST")
    http.addHeader("Content-Type", "application/json")
    http.addHeader("User-Agent", "com.google.ios.youtube/19.32.8 (iPhone16,2; U; CPU iOS 17_6 like Mac OS X;)")

    body = {
        videoId: videoId,
        context: {
            client: {
                clientName: "IOS",
                clientVersion: "19.32.8",
                deviceMake: "Apple",
                deviceModel: "iPhone16,2",
                osName: "iOS",
                osVersion: "17.6.1.21G93",
                hl: "en",
                gl: "US"
            }
        }
    }

    requestBody = FormatJson(body)
    print "[Innertube] POST to youtube.com/youtubei/v1/player for " videoId

    ' Use async transfer with message port for better error handling
    port = createObject("roMessagePort")
    http.setPort(port)
    http.enableEncodings(true)
    ok = http.asyncPostFromString(requestBody)
    if not ok
        print "[Innertube] asyncPostFromString returned false"
        m.top.response = FormatJson({ error: "Failed to start HTTP request" })
        return
    end if

    msg = wait(15000, port) ' 15 second timeout
    if msg = invalid
        print "[Innertube] Request timed out"
        http.asyncCancel()
        m.top.response = FormatJson({ error: "Innertube request timed out" })
        return
    end if

    respCode = msg.getResponseCode()
    rawResponse = msg.getString()
    print "[Innertube] HTTP " respCode " body len=" len(rawResponse)

    if respCode <> 200
        print "[Innertube] Non-200 response: " respCode " reason: " msg.getFailureReason()
        m.top.response = FormatJson({ error: "Innertube HTTP " + str(respCode) })
        return
    end if

    if len(rawResponse) = 0
        print "[Innertube] Empty response body"
        m.top.response = FormatJson({ error: "Innertube empty response" })
        return
    end if

    parsed = ParseJson(rawResponse)
    if parsed = invalid
        print "[Innertube] JSON parse failed, first 200 chars: " left(rawResponse, 200)
        m.top.response = FormatJson({ error: "Failed to parse Innertube response" })
        return
    end if

    ' Check playability
    status = ""
    if parsed.playabilityStatus <> invalid then status = parsed.playabilityStatus.status
    print "[Innertube] Playability status: " status
    if status <> "OK"
        reason = "Video not playable"
        if parsed.playabilityStatus <> invalid and parsed.playabilityStatus.reason <> invalid
            reason = parsed.playabilityStatus.reason
        end if
        m.top.response = FormatJson({ error: reason })
        return
    end if

    ' Extract adaptive formats
    formats = invalid
    if parsed.streamingData <> invalid then formats = parsed.streamingData.adaptiveFormats
    if formats = invalid or formats.count() = 0
        m.top.response = FormatJson({ error: "No adaptive formats" })
        return
    end if

    ' Find best avc1 video <= 720p
    bestVideo = invalid
    for each f in formats
        if f.mimeType <> invalid and f.url <> invalid
            if instr(1, f.mimeType, "video/mp4") > 0 and instr(1, f.mimeType, "avc1") > 0
                h = 0
                if f.height <> invalid then h = f.height
                if h > 0 and h <= 720
                    if bestVideo = invalid or h > bestVideo.height
                        bestVideo = f
                    end if
                end if
            end if
        end if
    end for

    ' Find best m4a audio
    bestAudio = invalid
    for each f in formats
        if f.mimeType <> invalid and f.url <> invalid
            if instr(1, f.mimeType, "audio/mp4") > 0
                br = 0
                if f.bitrate <> invalid then br = f.bitrate
                if bestAudio = invalid or br > bestAudio.bitrate
                    bestAudio = f
                end if
            end if
        end if
    end for

    if bestVideo <> invalid
        print "[Innertube] bestVideo itag=" bestVideo.itag " " bestVideo.height "p"
    else
        print "[Innertube] bestVideo = NONE"
    end if
    if bestAudio <> invalid
        print "[Innertube] bestAudio itag=" bestAudio.itag " br=" bestAudio.bitrate
    else
        print "[Innertube] bestAudio = NONE"
    end if

    if bestVideo = invalid
        m.top.response = FormatJson({ error: "No suitable video format" })
        return
    end if
    if bestAudio = invalid
        m.top.response = FormatJson({ error: "No suitable audio format" })
        return
    end if

    ' Get duration
    dur = 0
    if parsed.videoDetails <> invalid and parsed.videoDetails.lengthSeconds <> invalid
        dur = val(parsed.videoDetails.lengthSeconds)
    end if

    ' Return structured response for VideoPlayer to build DASH manifest or play directly
    result = {
        video: {
            url: bestVideo.url,
            itag: bestVideo.itag,
            width: bestVideo.width,
            height: bestVideo.height,
            bitrate: bestVideo.bitrate,
            fps: bestVideo.fps,
            mimeType: bestVideo.mimeType,
            initRange: bestVideo.initRange,
            indexRange: bestVideo.indexRange
        },
        audio: {
            url: bestAudio.url,
            itag: bestAudio.itag,
            bitrate: bestAudio.bitrate,
            mimeType: bestAudio.mimeType,
            initRange: bestAudio.initRange,
            indexRange: bestAudio.indexRange
        },
        duration: dur
    }

    m.top.response = FormatJson(result)
end sub
