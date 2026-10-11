import React, { createContext, useCallback, useContext, useRef, useState } from 'react';
import { ProfileContext } from '../App.jsx';

const PlayerContext = createContext(null);

const FALLBACK_NOTICE = "Oops! That video isn't ready yet. Let's watch something else!";

// Videos a parent saved to this device for offline (Trip Mode) live in this
// Cache Storage bucket. They were picked by a parent, so they may play when the
// server can't be reached.
const OFFLINE_CACHE = 'kt-offline-v1';
async function isDownloaded(id) {
  try {
    if (typeof caches === 'undefined') return false;
    const cache = await caches.open(OFFLINE_CACHE);
    return !!(await cache.match(`/offline-media/${id}.mp4`));
  } catch {
    return false;
  }
}

// Ask the backend whether this child may play this video. Search-found videos
// are reviewed for the watching child first; anything that fails review, or
// any error, comes back not playable (fail closed).
async function checkPlayable(id, profileId) {
  let r;
  try {
    r = await fetch(`/api/playable/${encodeURIComponent(id)}?profile_id=${encodeURIComponent(profileId || '')}`);
  } catch {
    // Server unreachable: only parent-downloaded videos may play.
    if (await isDownloaded(id)) return { playable: true };
    return { playable: false, notice: FALLBACK_NOTICE, suggestion: null };
  }
  try {
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } catch {
    return { playable: false, notice: FALLBACK_NOTICE, suggestion: null };
  }
}

export function PlayerProvider({ children }) {
  const profile = useContext(ProfileContext);
  const profileId = profile?.profileId;

  const [videoId, setVideoId]     = useState(null);
  const [minimized, setMinimized] = useState(false);
  const [nextVideo, setNextVideo] = useState(null); // { video_id, title, thumbnail_url }
  const [relatedVideos, setRelatedVideos] = useState([]); // [{ video_id, title, thumbnail_url, channel_name, duration_seconds }]
  const [fullscreen, setFullscreen] = useState(false);
  // Review gate: { videoId, status: 'checking' | 'blocked', notice?, suggestion? } or null
  const [gate, setGate] = useState(null);
  const pendingRef = useRef(null);

  // Open a video in full mode (replaces whatever was playing) — but only once
  // the review gate says this child may play it.
  const openVideo = useCallback((id) => {
    if (!id || pendingRef.current === id) return;
    pendingRef.current = id;
    setVideoId(null);
    setMinimized(false);
    setNextVideo(null);
    setRelatedVideos([]);
    setGate({ videoId: id, status: 'checking' });

    checkPlayable(id, profileId).then((res) => {
      if (pendingRef.current !== id) return; // a newer video was opened meanwhile
      pendingRef.current = null;
      if (res && res.playable) {
        setGate(null);
        setVideoId(id);
      } else {
        setGate({
          videoId: id,
          status: 'blocked',
          notice: res?.notice || FALLBACK_NOTICE,
          suggestion: res?.suggestion || null,
        });
      }
    });
  }, [profileId]);

  const dismissGate = useCallback(() => { pendingRef.current = null; setGate(null); }, []);

  // Shrink to corner, keep playing
  const minimize = useCallback(() => setMinimized(true),  []);

  // Return to full-size (Watch page will navigate)
  const expand   = useCallback(() => setMinimized(false), []);

  // Stop entirely
  const close    = useCallback(() => {
    pendingRef.current = null;
    setVideoId(null);
    setMinimized(false);
    setNextVideo(null);
    setRelatedVideos([]);
    setFullscreen(false);
    setGate(null);
  }, []);

  const enterFullscreen = useCallback(() => setFullscreen(true),  []);
  const exitFullscreen  = useCallback(() => setFullscreen(false), []);

  return (
    <PlayerContext.Provider value={{ videoId, minimized, nextVideo, setNextVideo, relatedVideos, setRelatedVideos, openVideo, minimize, expand, close, fullscreen, enterFullscreen, exitFullscreen, gate, dismissGate }}>
      {children}
    </PlayerContext.Provider>
  );
}

export const usePlayerContext = () => useContext(PlayerContext);
