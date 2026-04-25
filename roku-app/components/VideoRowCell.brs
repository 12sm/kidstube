sub init()
    m.thumbnail = m.top.findNode("thumbnail")
    m.titleLabel = m.top.findNode("titleLabel")
    m.channelLabel = m.top.findNode("channelLabel")
    m.durationRect = m.top.findNode("durationRect")
    m.durationLabel = m.top.findNode("durationLabel")
    m.progressBar = m.top.findNode("progressBar")
end sub

sub onContentSet()
    content = m.top.itemContent
    if content = invalid then return

    m.thumbnail.uri = content.HDPOSTERURL
    m.titleLabel.text = content.TITLE
    m.channelLabel.text = content.DESCRIPTION

    ' Duration badge
    dur = 0
    if content.hasField("duration_seconds")
        dur = content.duration_seconds
    end if
    if dur > 0
        m.durationLabel.text = formatDuration(dur)
        ' Size the badge rectangle to fit the text
        textWidth = m.durationLabel.boundingRect().width + 16
        m.durationRect.width = textWidth
        m.durationRect.translation = [350 - textWidth - 6, 166]
        m.durationRect.visible = true
    else
        m.durationRect.visible = false
    end if

    ' Progress bar (continue watching)
    prog = 0
    if content.hasField("progress_pct")
        prog = content.progress_pct
    end if
    if prog > 0.05 and prog < 0.95
        m.progressBar.scale = [prog, 1]
        m.progressBar.visible = true
    else
        m.progressBar.visible = false
    end if
end sub

function formatDuration(totalSeconds as integer) as string
    hours = totalSeconds \ 3600
    minutes = (totalSeconds MOD 3600) \ 60
    seconds = totalSeconds MOD 60
    secStr = seconds.toStr()
    if seconds < 10 then secStr = "0" + seconds.toStr()
    if hours > 0
        minStr = minutes.toStr()
        if minutes < 10 then minStr = "0" + minutes.toStr()
        return hours.toStr() + ":" + minStr + ":" + secStr
    end if
    return minutes.toStr() + ":" + secStr
end function
