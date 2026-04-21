import React, { useEffect, useRef, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { usePlayerContext } from '../contexts/PlayerContext.jsx';

const MINI_W  = 192;
const MINI_H  = Math.round(MINI_W * 9 / 16); // 108
const BOTTOM_NAV_H = 68;
const AUTOPLAY_SECS = 5;
const CONTROLS_HIDE_MS = 3500;
const END_CARD_BUFFER_SECS = 20; // show our end screen this many seconds before video ends

function readSafeArea(prop) {
  const el = document.createElement('div');
  el.style.cssText = `position:fixed;top:0;left:0;height:0;padding-top:env(${prop},0px)`;
  document.body.appendChild(el);
  const val = parseInt(getComputedStyle(el).paddingTop) || 0;
  document.body.removeChild(el);
  return val;
}

function fmt(secs) {
  if (!secs && secs !== 0) return '0:00';
  const s = Math.floor(secs);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
  return `${m}:${String(ss).padStart(2, '0')}`;
}

function CountdownRing({ seconds, total }) {
  const r = 22;
  const circ = 2 * Math.PI * r;
  const dash = circ * (seconds / total);
  return (
    <svg width="56" height="56" viewBox="0 0 56 56" className="absolute inset-0 m-auto -rotate-90">
      <circle cx="28" cy="28" r={r} fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth="3" />
      <circle
        cx="28" cy="28" r={r}
        fill="none" stroke="white" strokeWidth="3"
        strokeDasharray={`${dash} ${circ}`}
        strokeLinecap="round"
        style={{ transition: 'stroke-dasharray 0.95s linear' }}
      />
    </svg>
  );
}

export default function MiniPlayer() {
  const {
    videoId, minimized, nextVideo, relatedVideos,
    minimize, expand, close, openVideo,
    fullscreen, enterFullscreen, exitFullscreen
  } = usePlayerContext();
  const navigate  = useNavigate();
  const location  = useLocation();

  const [safeTop]    = useState(59);
  const [safeBottom] = useState(34);
  const [ipSafeTop]  = useState(() => readSafeArea('safe-area-inset-top'));
  const [dims, setDims] = useState({ w: window.innerWidth, h: window.innerHeight });
  const [countdown, setCountdown]   = useState(null);

  const countdownRef    = useRef(null);
  const iframeRef       = useRef(null);
  const gestureLayerRef = useRef(null);
  const touchStartY   = useRef(0);
  const touchStartX   = useRef(0);
  const touchStartT   = useRef(0);
  const didMinimize   = useRef(false);
  const swipeDelta    = useRef(0);

  const [muted, setMuted]         = useState(false);
  const [playing, setPlaying]     = useState(false);
  const playingRef                = useRef(false);
  const [landscape, setLandscape] = useState(() => window.innerWidth > window.innerHeight);

  // Custom controls state
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration]       = useState(0);
  const [dragTime, setDragTime]       = useState(null); // seconds while dragging seek bar
  const [showControls, setShowControls] = useState(true);
  const controlsTimerRef = useRef(null);

  // Seek bar ref for custom touch-based scrubbing
  const seekBarRef = useRef(null);
  const [isSeeking, setIsSeeking] = useState(false);

  // Settings panel
  const [showSettings, setShowSettings]     = useState(false);
  const [showDrawer, setShowDrawer]         = useState(false);
  const [drawerFilter, setDrawerFilter]     = useState('all'); // 'all' | channelId
  const [playbackSpeed, setPlaybackSpeed]   = useState(1);
  const [playbackQuality, setPlaybackQuality] = useState('auto');

  const resetControlsTimer = () => {
    setShowControls(true);
    clearTimeout(controlsTimerRef.current);
    controlsTimerRef.current = setTimeout(() => setShowControls(false), CONTROLS_HIDE_MS);
  };

  // Reset state when video changes, then register for infoDelivery
  useEffect(() => {
    setMuted(false);
    setPlaying(false);
    playingRef.current = false;
    setCurrentTime(0);
    setDuration(0);
    setDragTime(null);
    setShowControls(true);
    setShowDrawer(false);
    setDrawerFilter('all');

    // Register for infoDelivery events once the iframe has initialised
    const listenTimer = setTimeout(() => {
      iframeRef.current?.contentWindow?.postMessage(
        JSON.stringify({ event: 'listening', id: 1 }),
        'https://www.youtube.com'
      );
    }, 1500);

    return () => clearTimeout(listenTimer);
  }, [videoId]);

  // Keep controls pinned open while drawer is visible; resume auto-hide when it closes
  useEffect(() => {
    if (showDrawer) {
      clearTimeout(controlsTimerRef.current);
      setShowControls(true);
    } else if (playingRef.current) {
      resetControlsTimer();
    }
  }, [showDrawer]); // eslint-disable-line react-hooks/exhaustive-deps

  // Show controls when paused; start hide-timer when playing
  useEffect(() => {
    if (!playing) {
      clearTimeout(controlsTimerRef.current);
      setShowControls(true);
    } else {
      resetControlsTimer();
    }
  }, [playing]); // eslint-disable-line react-hooks/exhaustive-deps

  // Smooth time increment when playing — always ticks, caps at duration when known
  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => {
      setCurrentTime(prev => duration > 0 ? Math.min(prev + 1, duration) : prev + 1);
    }, 1000);
    return () => clearInterval(id);
  }, [playing, duration]);

  // Screen Wake Lock — keep the screen on while a video is playing.
  // Supported on iOS 16.4+ in PWA standalone mode.
  // Wake locks are automatically released when the page is hidden, so we
  // re-request when the page becomes visible again and video is still playing.
  useEffect(() => {
    if (!('wakeLock' in navigator)) return;
    let lock = null;

    const request = async () => {
      try {
        lock = await navigator.wakeLock.request('screen');
      } catch (_) { /* denied or unavailable — silently ignore */ }
    };

    const release = () => {
      lock?.release();
      lock = null;
    };

    // Re-request after the page comes back into view (wake lock releases on hide)
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible' && playingRef.current) request();
    };

    if (playing) {
      request();
      document.addEventListener('visibilitychange', onVisibilityChange);
    }

    return () => {
      release();
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [playing]);

  useEffect(() => {
    const onResize = () => {
      setDims({ w: window.innerWidth, h: window.innerHeight });
      setLandscape(window.innerWidth > window.innerHeight);
    };
    // Re-read dims when the app comes back to foreground — iOS/iPadOS reports
    // stale dimensions after app-switching, causing the video pane to shrink.
    const onVisibility = () => {
      if (document.visibilityState === 'visible') setTimeout(onResize, 100);
    };
    window.addEventListener('resize', onResize);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('resize', onResize);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  // Focus the gesture layer whenever we enter full-mode on the Watch page so that
  // keyboard events (spacebar) are captured by it rather than stolen by the iframe.
  useEffect(() => {
    if (minimized || !location.pathname.startsWith('/watch/')) return;
    const timer = setTimeout(() => {
      gestureLayerRef.current?.focus({ preventScroll: true });
    }, 300);
    return () => clearTimeout(timer);
  }, [minimized, location.pathname, videoId]);

  // YouTube postMessage listener
  useEffect(() => {
    const onMessage = (e) => {
      if (!String(e.origin).includes('youtube.com')) return;
      let data;
      try { data = typeof e.data === 'string' ? JSON.parse(e.data) : e.data; } catch { return; }

      // When the player is ready, register as a listener so YouTube
      // sends periodic infoDelivery events with currentTime + duration
      if (data?.event === 'onReady') {
        iframeRef.current?.contentWindow?.postMessage(
          JSON.stringify({ event: 'listening', id: 1 }),
          'https://www.youtube.com'
        );
      }

      if (data?.event === 'infoDelivery' && data?.info) {
        const cur = data.info.currentTime;
        const dur = data.info.duration;
        // Sync currentTime from YouTube (accurate position); allow 0 for video start
        if (typeof cur === 'number') setCurrentTime(Math.floor(cur));
        if (typeof dur === 'number' && dur > 0) setDuration(Math.floor(dur));
      }

      if (data?.event === 'onStateChange') {
        if (data.info === 1) { setPlaying(true);  playingRef.current = true; }
        if (data.info === 2) { setPlaying(false); playingRef.current = false; }
        if (data.info === 0) {
          const onWatchPage = location.pathname.startsWith('/watch/');
          if (!minimized && onWatchPage && nextVideo) {
            setCountdown(AUTOPLAY_SECS);
            setShowDrawer(false);
          }
        }
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [minimized, nextVideo, location.pathname]);

  useEffect(() => {
    clearTimeout(countdownRef.current);
    setCountdown(null);
  }, [location.pathname, minimized, videoId]);

  useEffect(() => {
    if (countdown === null) return;
    if (countdown === 0) {
      clearTimeout(countdownRef.current);
      setCountdown(null);
      if (nextVideo) { openVideo(nextVideo.video_id); navigate(`/watch/${nextVideo.video_id}`, { replace: true }); }
      return;
    }
    countdownRef.current = setTimeout(() => setCountdown(c => c - 1), 1000);
    return () => clearTimeout(countdownRef.current);
  }, [countdown, nextVideo, openVideo, navigate]);

  const cancelCountdown = () => { clearTimeout(countdownRef.current); setCountdown(null); };

  const postCmd = (func, args = '') => {
    iframeRef.current?.contentWindow?.postMessage(
      JSON.stringify({ event: 'command', func, args }),
      'https://www.youtube.com'
    );
  };

  const handleUnmute = () => { setMuted(false); postCmd('unMute'); postCmd('setVolume', [100]); };

  const handleMute = () => {
    setMuted(true);
    postCmd('mute');
  };

  const handleSeek = (seconds) => {
    postCmd('seekTo', [seconds, true]);
    setCurrentTime(Math.floor(seconds));
  };

  if (!videoId) return null;

  const onWatchPage   = location.pathname.startsWith('/watch/');
  const showFull      = !minimized && onWatchPage;

  // On wide viewports (iPad/desktop), constrain video to 63% left column
  const isWide = dims.w >= 1024;
  // Landscape fill only applies to phones — iPad uses the 63/37 split regardless of orientation
  const showLandscape = landscape && !!videoId && !minimized && !isWide;
  const fullW   = isWide ? Math.round(dims.w * 0.68) : dims.w;
  const fullTop = isWide ? ipSafeTop : safeTop;

  const fullStyle = {
    position: 'fixed', top: fullTop, left: 0,
    width: fullW, height: Math.round(fullW * 9 / 16),
    zIndex: 40, borderRadius: 0,
    transition: 'top 0.35s cubic-bezier(0.4,0,0.2,1), left 0.35s cubic-bezier(0.4,0,0.2,1), width 0.35s cubic-bezier(0.4,0,0.2,1), height 0.35s cubic-bezier(0.4,0,0.2,1), border-radius 0.35s ease',
  };

  const landscapeStyle = {
    position: 'fixed', top: 0, left: 0,
    width: '100vw', height: '100vh',
    zIndex: 50, borderRadius: 0, background: '#000',
    transition: 'none',
  };

  const miniTop  = dims.h - safeBottom - BOTTOM_NAV_H - MINI_H - 4;
  const miniLeft = dims.w - 16 - MINI_W;
  const miniStyle = {
    position: 'fixed', top: miniTop, left: miniLeft,
    width: MINI_W, height: MINI_H,
    zIndex: 40, borderRadius: 12, overflow: 'hidden',
    transition: 'top 0.35s cubic-bezier(0.4,0,0.2,1), left 0.35s cubic-bezier(0.4,0,0.2,1), width 0.35s cubic-bezier(0.4,0,0.2,1), height 0.35s cubic-bezier(0.4,0,0.2,1), border-radius 0.35s ease',
    boxShadow: '0 8px 32px rgba(0,0,0,0.7)',
    border: '1px solid rgba(255,255,255,0.1)',
  };

  const src =
    `https://www.youtube.com/embed/${videoId}` +
    `?playsinline=1&rel=0&modestbranding=1&fs=0` +
    `&cc_load_policy=0&iv_load_policy=3&controls=0&enablejsapi=1`;

  // Seek bar progress %
  const displayTime = dragTime ?? currentTime;
  const pct = duration > 0 ? Math.min(100, (displayTime / duration) * 100) : 0;

  const onTouchStart = (e) => {
    touchStartY.current = e.touches[0].clientY;
    touchStartX.current = e.touches[0].clientX;
    touchStartT.current = Date.now();
    swipeDelta.current  = 0;
    didMinimize.current = false;
  };
  const onTouchMove = (e) => {
    if (didMinimize.current) return;
    swipeDelta.current = e.touches[0].clientY - touchStartY.current;
    if (swipeDelta.current > 70) {
      didMinimize.current = true;
      cancelCountdown();
      if (fullscreen) {
        // First pull-down: exit fullscreen only — stay on watch page
        exitFullscreen();
        screen.orientation?.unlock?.();
        setShowDrawer(false);
      } else {
        // Second pull-down (already in normal view): minimize and go back
        minimize();
        navigate(-1);
      }
    }
  };
  const onTouchEnd = (e) => {
    if (didMinimize.current) return;
    const t = e.changedTouches[0];
    const dy = Math.abs(t.clientY - touchStartY.current);
    const dx = Math.abs(t.clientX - touchStartX.current);
    const dt = Date.now() - touchStartT.current;
    if (dy < 20 && dx < 20 && dt < 500) {
      // Tap: show controls if hidden, hide if already visible
      if (showControls) {
        setShowControls(false);
        clearTimeout(controlsTimerRef.current);
      } else {
        resetControlsTimer();
      }
    }
  };

  const handlePlayPause = () => {
    const cmd = playingRef.current ? 'pauseVideo' : 'playVideo';
    playingRef.current = !playingRef.current;
    setPlaying(playingRef.current);
    postCmd(cmd, []);
    resetControlsTimer();
  };

  const handleExpand = () => { expand(); navigate(`/watch/${videoId}`); };
  const handleClose  = (e) => { e.stopPropagation(); close(); };

  // Custom seek bar interaction helpers
  const getSeekSecs = (clientX) => {
    const rect = seekBarRef.current?.getBoundingClientRect();
    if (!rect) return null;
    return Math.max(0, Math.min(duration || 0, ((clientX - rect.left) / rect.width) * (duration || 0)));
  };
  const onSeekTouchStart = (e) => { e.stopPropagation(); setIsSeeking(true); const s = getSeekSecs(e.touches[0].clientX); if (s !== null) setDragTime(s); };
  const onSeekTouchMove  = (e) => { e.stopPropagation(); const s = getSeekSecs(e.touches[0].clientX); if (s !== null) { setDragTime(s); resetControlsTimer(); } };
  const onSeekTouchEnd   = (e) => { e.stopPropagation(); setIsSeeking(false); if (dragTime !== null) { handleSeek(dragTime); setDragTime(null); } };
  const onSeekClick      = (e) => { e.stopPropagation(); const s = getSeekSecs(e.clientX); if (s !== null) { handleSeek(s); resetControlsTimer(); } };

  // Fullscreen always uses landscape style (fills entire viewport regardless of orientation)
  const showFullViewport = showLandscape || (fullscreen && showFull);
  // Always show custom controls (and gesture-blocking layer) in full mode
  const showCustomControls = showFull;

  // Drawer overlays exactly the same area as the video — derived from the active container style
  const drawerStyle = showFullViewport
    ? { position: 'fixed', top: 0, left: 0, width: dims.w, height: dims.h, zIndex: 55 }
    : { position: 'fixed', top: fullTop, left: 0, width: fullW, height: Math.round(fullW * 9 / 16), zIndex: 55 };

  return (
    <div style={showFullViewport ? landscapeStyle : showFull ? fullStyle : miniStyle} className="bg-black">

      <iframe
        key={videoId}
        ref={iframeRef}
        src={src}
        className="w-full h-full border-0"
        allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
        allowFullScreen
        tabIndex={-1}
        title="Video player"
        style={minimized ? { pointerEvents: 'none' } : undefined}
      />

      {/* ── Full-mode custom controls ── */}
      {showCustomControls && (
        <>
          {/* Gesture layer — full video area. Swipe down = minimize, tap = toggle controls.
              tabIndex={0} + outline-none makes it the keyboard focus target so spacebar
              events land here instead of the iframe. */}
          <div
            ref={gestureLayerRef}
            tabIndex={0}
            className="absolute inset-0 z-10 outline-none"
            onTouchStart={onTouchStart}
            onTouchMove={onTouchMove}
            onTouchEnd={onTouchEnd}
            onKeyDown={(e) => { if (e.code === 'Space') { e.preventDefault(); handlePlayPause(); } }}
          />

          {/* ── Settings panel (slides up from bottom) ── */}
          {showSettings && (
            <div className="absolute inset-0 z-30 flex items-end" onClick={() => setShowSettings(false)}>
              <div className="w-full bg-black/95 rounded-t-2xl px-5 pt-4 pb-6" onClick={e => e.stopPropagation()}>
                <div className="w-8 h-1 rounded-full bg-white/30 mx-auto mb-4" />
                <p className="text-white/60 text-xs font-semibold uppercase tracking-wider mb-2">Playback speed</p>
                <div className="flex gap-2 flex-wrap mb-5">
                  {[0.5, 0.75, 1, 1.25, 1.5, 2].map(s => (
                    <button key={s} onClick={() => { setPlaybackSpeed(s); postCmd('setPlaybackRate', [s]); setShowSettings(false); }}
                      className={`px-3 py-1.5 rounded-full text-sm transition-colors ${playbackSpeed === s ? 'bg-white text-black font-semibold' : 'bg-white/20 text-white'}`}>
                      {s === 1 ? 'Normal' : `${s}×`}
                    </button>
                  ))}
                </div>
                <p className="text-white/60 text-xs font-semibold uppercase tracking-wider mb-2">Quality</p>
                <div className="flex gap-2 flex-wrap">
                  {[['auto','Auto'],['hd1080','1080p'],['hd720','720p'],['large','480p'],['medium','360p']].map(([val, label]) => (
                    <button key={val} onClick={() => { setPlaybackQuality(val); postCmd('setPlaybackQuality', [val]); setShowSettings(false); }}
                      className={`px-3 py-1.5 rounded-full text-sm transition-colors ${playbackQuality === val ? 'bg-white text-black font-semibold' : 'bg-white/20 text-white'}`}>
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ── Top bar: chevron-down (minimize) left, gear right ── */}
          <div
            className={`absolute top-0 left-0 right-0 z-20 flex items-center justify-between px-3 h-12 pointer-events-none transition-opacity duration-200 ${showControls ? 'opacity-100' : 'opacity-0'}`}
            style={{ background: 'linear-gradient(to bottom, rgba(0,0,0,0.6), transparent)' }}
          >
            <button onClick={() => { cancelCountdown(); exitFullscreen(); screen.orientation?.unlock?.(); minimize(); navigate(-1); }}
              className={`text-white p-1 ${showControls ? 'pointer-events-auto' : 'pointer-events-none'}`} aria-label="Minimize">
              <svg viewBox="0 0 24 24" className="w-6 h-6 fill-current"><path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z"/></svg>
            </button>
            <button onClick={() => { setShowDrawer(false); setShowSettings(s => !s); resetControlsTimer(); }}
              className={`text-white p-1 ${showControls ? 'pointer-events-auto' : 'pointer-events-none'}`} aria-label="Settings">
              <svg viewBox="0 0 24 24" className="w-6 h-6 fill-current"><path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/></svg>
            </button>
          </div>

          {/* ── Center: skip-back | play/pause | next ── */}
          <div className={`absolute inset-0 z-20 flex items-center justify-center gap-10 pointer-events-none transition-opacity duration-200 ${showControls ? 'opacity-100' : 'opacity-0'}`}>
            {/* Skip back 10s */}
            <button onClick={() => { handleSeek(Math.max(0, currentTime - 10)); resetControlsTimer(); }}
              className={`text-white ${showControls ? 'pointer-events-auto' : 'pointer-events-none'}`} aria-label="Skip back 10s">
              <svg viewBox="0 0 24 24" className="w-9 h-9 fill-white/90">
                <path d="M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z"/>
              </svg>
            </button>
            {/* Play / Pause */}
            <button onClick={handlePlayPause}
              className={`bg-black/50 rounded-full p-4 ${showControls ? 'pointer-events-auto' : 'pointer-events-none'}`} aria-label={playing ? 'Pause' : 'Play'}>
              {playing
                ? <svg viewBox="0 0 24 24" className="w-10 h-10 fill-white"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>
                : <svg viewBox="0 0 24 24" className="w-10 h-10 fill-white"><path d="M8 5v14l11-7z"/></svg>
              }
            </button>
            {/* Next video */}
            <button
              onClick={nextVideo ? () => { cancelCountdown(); openVideo(nextVideo.video_id); navigate(`/watch/${nextVideo.video_id}`, { replace: true }); } : undefined}
              className={`text-white transition-opacity ${nextVideo ? '' : 'opacity-30'} ${showControls ? 'pointer-events-auto' : 'pointer-events-none'}`}
              aria-label="Next video"
            >
              <svg viewBox="0 0 24 24" className="w-9 h-9 fill-white/90">
                <path d="M6 18l8.5-6L6 6v12zm2-8.14L11.03 12 8 14.14V9.86zM16 6h2v12h-2z"/>
              </svg>
            </button>
          </div>

          {/* ── Bottom: gradient + time/mute/fullscreen + seek bar ── */}
          <div
            className={`absolute bottom-0 left-0 right-0 z-20 pointer-events-none transition-opacity duration-200 ${showControls ? 'opacity-100' : 'opacity-0'}`}
            style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.75) 0%, transparent 100%)' }}
          >
            {/* Time + mute + fullscreen */}
            <div className="flex items-center px-4 pt-8 pb-1 gap-3">
              <span className="text-white text-xs font-mono tabular-nums select-none">
                {fmt(displayTime)}<span className="text-white/50 mx-1">/</span>{fmt(duration)}
              </span>
              <div className="flex-1" />
              {/* Mute */}
              <button onClick={() => { muted ? handleUnmute() : handleMute(); resetControlsTimer(); }}
                className={`p-1 ${showControls ? 'pointer-events-auto' : 'pointer-events-none'}`} aria-label={muted ? 'Unmute' : 'Mute'}>
                {muted
                  ? <svg viewBox="0 0 24 24" className="w-5 h-5 fill-white"><path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/></svg>
                  : <svg viewBox="0 0 24 24" className="w-5 h-5 fill-white"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>
                }
              </button>
              {/* More videos pill — only shown when related videos exist; hidden on lg (iPad has sidebar) */}
              {relatedVideos.length > 0 && (
                <button
                  onClick={() => { setShowDrawer(d => !d); setShowSettings(false); resetControlsTimer(); }}
                  className={`lg:hidden flex items-center gap-1.5 rounded-full pl-0.5 pr-2.5 py-0.5 transition-colors ${showControls ? 'pointer-events-auto' : 'pointer-events-none'} ${showDrawer ? 'bg-white/20' : 'bg-black/50'}`}
                  aria-label="More videos"
                >
                  {relatedVideos[0]?.thumbnail_url && (
                    <img
                      src={relatedVideos[0].thumbnail_url}
                      alt=""
                      className="w-10 h-[22px] rounded-full object-cover flex-shrink-0"
                    />
                  )}
                  <span className="text-white text-xs font-medium whitespace-nowrap">More videos</span>
                </button>
              )}
              {/* Fullscreen */}
              <button onClick={() => {
                  if (fullscreen) {
                    exitFullscreen();
                    screen.orientation?.unlock?.();
                  } else {
                    enterFullscreen();
                    screen.orientation?.lock?.('landscape').catch(() => {});
                  }
                  resetControlsTimer();
                }}
                className={`p-1 ${showControls ? 'pointer-events-auto' : 'pointer-events-none'}`} aria-label={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}>
                {fullscreen
                  ? <svg viewBox="0 0 24 24" className="w-5 h-5 fill-white"><path d="M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z"/></svg>
                  : <svg viewBox="0 0 24 24" className="w-5 h-5 fill-white"><path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/></svg>
                }
              </button>
            </div>
            {/* Seek bar — custom div-based for large touch area */}
            <div
              ref={seekBarRef}
              className={`relative h-8 flex items-center px-0 cursor-pointer ${showControls ? 'pointer-events-auto' : 'pointer-events-none'}`}
              onTouchStart={onSeekTouchStart}
              onTouchMove={onSeekTouchMove}
              onTouchEnd={onSeekTouchEnd}
              onClick={onSeekClick}
            >
              {/* Track */}
              <div className="w-full h-1 bg-white/30 rounded-full overflow-hidden">
                <div className="h-full bg-yt-red" style={{ width: `${pct}%` }} />
              </div>
              {/* Thumb — large while dragging, small at rest */}
              <div
                className={`absolute top-1/2 -translate-y-1/2 -translate-x-1/2 bg-white rounded-full shadow-md pointer-events-none transition-all duration-150 ${isSeeking ? 'w-5 h-5' : 'w-3 h-3'}`}
                style={{ left: `${pct}%` }}
              />
            </div>
          </div>

          {/* ── Video queue drawer ── */}
          {showDrawer && relatedVideos.length > 0 && (() => {
            // Unique channels for filter chips
            const channels = [];
            const seen = new Set();
            for (const v of relatedVideos) {
              if (v.channel_id && !seen.has(v.channel_id)) {
                seen.add(v.channel_id);
                channels.push({ id: v.channel_id, name: v.channel_name });
              }
            }
            const filtered = drawerFilter === 'all'
              ? relatedVideos
              : relatedVideos.filter(v => v.channel_id === drawerFilter);
            return (
              <div
                className="bg-black/92 backdrop-blur-sm overflow-hidden"
                style={drawerStyle}
                onClick={e => e.stopPropagation()}
              >
                {/* Header — fixed height 44px */}
                <div className="absolute top-0 left-0 right-0 flex items-center justify-between px-4" style={{ height: 44 }}>
                  <span className="text-white text-sm font-semibold">More videos</span>
                  <button
                    onClick={() => setShowDrawer(false)}
                    className="text-white/70 p-1"
                    aria-label="Close"
                  >
                    <svg viewBox="0 0 24 24" className="w-5 h-5 fill-current">
                      <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
                    </svg>
                  </button>
                </div>
                {/* Filter chips — fixed height 36px, shown when multiple channels */}
                {channels.length > 1 && (
                  <div className="absolute left-0 right-0 flex gap-2 px-4 overflow-x-auto" style={{ top: 44, height: 36, scrollbarWidth: 'none' }}>
                    <button
                      onClick={() => setDrawerFilter('all')}
                      className={`flex-shrink-0 px-3 py-1 rounded-full text-xs font-medium transition-colors ${drawerFilter === 'all' ? 'bg-white text-black' : 'bg-white/15 text-white'}`}
                    >All</button>
                    {channels.map(ch => (
                      <button
                        key={ch.id}
                        onClick={() => setDrawerFilter(ch.id)}
                        className={`flex-shrink-0 px-3 py-1 rounded-full text-xs font-medium transition-colors whitespace-nowrap ${drawerFilter === ch.id ? 'bg-white text-black' : 'bg-white/15 text-white'}`}
                      >From {ch.name}</button>
                    ))}
                  </div>
                )}
                {/* Horizontal scroll row — fills remaining height via absolute top/bottom */}
                <div
                  className="absolute left-0 right-0 bottom-0 flex items-center gap-3 overflow-x-auto px-3"
                  style={{ top: channels.length > 1 ? 80 : 44, scrollbarWidth: 'none', overscrollBehavior: 'contain', touchAction: 'pan-x' }}
                >
                  {filtered.map(video => (
                    <button
                      key={video.video_id}
                      onClick={() => { openVideo(video.video_id); navigate(`/watch/${video.video_id}`, { replace: true }); setShowDrawer(false); }}
                      className={`flex-shrink-0 text-left ${landscape ? 'w-[19rem]' : 'w-36'}`}
                    >
                      <div className="relative w-full aspect-video rounded-lg overflow-hidden bg-white/10">
                        {video.thumbnail_url && (
                          <img src={video.thumbnail_url} alt="" className="w-full h-full object-cover" />
                        )}
                      </div>
                      <p className="text-white text-xs font-medium mt-1.5 line-clamp-2 leading-snug">{video.title}</p>
                      <p className="text-white/50 text-[11px] mt-0.5 line-clamp-1">{video.channel_name}</p>
                    </button>
                  ))}
                </div>
              </div>
            );
          })()}

          {/* Thin progress line when controls hidden — white only, no red */}
          {!showControls && (
            <div className="absolute bottom-0 left-0 right-0 h-0.5 z-20 pointer-events-none bg-white/20">
              <div className="h-full bg-white/60" style={{ width: `${pct}%` }} />
            </div>
          )}
        </>
      )}

      {/* ── Autoplay countdown overlay ── */}
      {showCustomControls && countdown !== null && nextVideo && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-black/80">
          {nextVideo.thumbnail_url && (
            <div className="w-44 rounded-xl overflow-hidden mb-4 shadow-2xl">
              <img src={nextVideo.thumbnail_url} alt={nextVideo.title} className="w-full aspect-video object-cover" />
            </div>
          )}

          <div className="relative w-14 h-14 flex items-center justify-center mb-4">
            <CountdownRing seconds={countdown} total={AUTOPLAY_SECS} />
            <span className="text-white text-lg font-bold relative z-10">{countdown}</span>
          </div>

          <p className="text-white/50 text-xs uppercase tracking-widest mb-1">Up Next</p>
          <p className="text-white text-sm font-medium text-center px-6 line-clamp-2 max-w-xs mb-5">
            {nextVideo.title}
          </p>

          <div className="flex gap-3">
            <button
              onClick={cancelCountdown}
              className="px-5 py-2 rounded-full border border-white/40 text-white text-sm hover:bg-white/10 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={() => { cancelCountdown(); openVideo(nextVideo.video_id); navigate(`/watch/${nextVideo.video_id}`, { replace: true }); }}
              className="px-5 py-2 rounded-full bg-white text-black text-sm font-semibold hover:bg-white/90 transition-colors"
            >
              Play Now
            </button>
          </div>
        </div>
      )}

      {/* ── Landscape fullscreen: rotate hint ── */}
      {showLandscape && !showFull && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-30 flex items-center gap-2 bg-black/60 text-white text-xs px-3 py-1.5 rounded-full pointer-events-none">
          <svg viewBox="0 0 24 24" className="w-4 h-4 fill-current">
            <path d="M16.48 2.52c3.27 1.55 5.61 4.72 5.97 8.48h1.5C23.44 4.84 20.29 1.1 16.04.06l.44 2.46zM7.52 2.52l.44-2.46C3.71 1.1.56 4.84.05 11h1.5c.36-3.76 2.7-6.93 5.97-8.48zM16.04 23.94c4.25-1.04 7.4-4.78 7.91-10.94h-1.5c-.36 3.76-2.7 6.93-5.97 8.48l-.44 2.46zm-8.52 0l-.44-2.46c-3.27-1.55-5.61-4.72-5.97-8.48H.05c.51 6.16 3.66 9.9 7.91 10.94H7.52zM12 6l-4 4h3v4.5c0 .28.22.5.5.5h1c.28 0 .5-.22.5-.5V10h3l-4-4z"/>
          </svg>
          Rotate to portrait
        </div>
      )}

      {/* ── Mini-mode: tap body to expand, play top-left, close top-right ── */}
      {minimized && (
        <>
          {/* Full tap blocker — anywhere on the thumbnail expands back to main player */}
          <div className="absolute inset-0 z-[5]" onClick={handleExpand} />
          {/* Play/pause — top left */}
          <button
            onClick={(e) => { e.stopPropagation(); postCmd(playing ? 'pauseVideo' : 'playVideo', ''); }}
            className="absolute top-1 left-1 z-10 p-1 bg-black/60 rounded-full"
            aria-label={playing ? 'Pause' : 'Play'}
          >
            {playing
              ? <svg viewBox="0 0 24 24" className="w-4 h-4 fill-white"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>
              : <svg viewBox="0 0 24 24" className="w-4 h-4 fill-white"><path d="M8 5v14l11-7z"/></svg>
            }
          </button>
          {/* Close — top right */}
          <button
            onClick={handleClose}
            className="absolute top-1 right-1 z-10 p-1 bg-black/60 rounded-full"
            aria-label="Close"
          >
            <svg viewBox="0 0 24 24" className="w-4 h-4 fill-white"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
          </button>
        </>
      )}
    </div>
  );
}
