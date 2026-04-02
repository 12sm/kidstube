sub init()
    m.thumbnail = m.top.findNode("thumbnail")
    m.titleLabel = m.top.findNode("titleLabel")
    m.channelLabel = m.top.findNode("channelLabel")
    m.top.observeField("itemContent", "onContentSet")
    m.top.observeField("focusPercent", "onFocusChange")
end sub

sub onContentSet()
    c = m.top.itemContent
    if c = invalid then return
    m.thumbnail.uri = c.hdPosterUrl
    m.titleLabel.text = c.title
    m.channelLabel.text = c.channelName
end sub

sub onFocusChange()
    if m.top.focusPercent > 0.5 then m.top.scale = [1.08, 1.08]
    else m.top.scale = [1.0, 1.0]
end sub
