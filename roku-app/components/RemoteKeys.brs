' RemoteKeys — string constants for onKeyEvent key names.
' Usage: keys = RemoteKeys() : if key = keys.back then ...
function RemoteKeys() as object
    return {
        back: "back"
        ok: "OK"
        play: "play"
        replay: "replay"
        options: "options"
        up: "up"
        down: "down"
        left: "left"
        right: "right"
        rewind: "rewind"
        fastForward: "fastforward"
    }
end function
