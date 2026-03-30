import React, { createContext, useCallback, useContext, useState } from 'react';

const PlayerContext = createContext(null);

export function PlayerProvider({ children }) {
  const [videoId, setVideoId]     = useState(null);
  const [minimized, setMinimized] = useState(false);
  const [nextVideo, setNextVideo] = useState(null); // { video_id, title, thumbnail_url }
  const [fullscreen, setFullscreen] = useState(false);

  // Open a video in full mode (replaces whatever was playing)
  const openVideo = useCallback((id) => {
    setVideoId(id);
    setMinimized(false);
    setNextVideo(null); // clear stale next-video until Watch sets it
  }, []);

  // Shrink to corner, keep playing
  const minimize = useCallback(() => setMinimized(true),  []);

  // Return to full-size (Watch page will navigate)
  const expand   = useCallback(() => setMinimized(false), []);

  // Stop entirely
  const close    = useCallback(() => { setVideoId(null); setMinimized(false); setNextVideo(null); setFullscreen(false); }, []);

  const enterFullscreen = useCallback(() => setFullscreen(true),  []);
  const exitFullscreen  = useCallback(() => setFullscreen(false), []);

  return (
    <PlayerContext.Provider value={{ videoId, minimized, nextVideo, setNextVideo, openVideo, minimize, expand, close, fullscreen, enterFullscreen, exitFullscreen }}>
      {children}
    </PlayerContext.Provider>
  );
}

export const usePlayerContext = () => useContext(PlayerContext);
