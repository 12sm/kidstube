import React, { useEffect, useRef, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { usePlayerContext } from '../contexts/PlayerContext.jsx';

const MINI_W  = 192;
const MINI_H  = Math.round(MINI_W * 9 / 16); // 108
const BOTTOM_NAV_H = 68; // nav content height (safeBottom handles home indicator)
const AUTOPLAY_SECS = 5;

function readSafeArea(prop) {
  const el = document.createElement('div');
  el.style.cssText = `position:fixed;top:0;left:0;height:0;padding-top:env(${prop},0px)`;
  document.body.appendChild(el);
  const val = parseInt(getComputedStyle(el).paddingTop) || 0;
  document.body.removeChild(el);
  return val;
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
  const { videoId, minimized, nextVideo, minimize, expand, close, openVideo } = usePlayerContext();
  const navigate  = useNavigate();
  const location  = useLocation();

  // safeTop: clamp to ≥44 so buttons clear any notch/Dynamic Island even if
  // env() resolves late or to 0 (e.g. Safari browser mode vs PWA standalone).
  const [safeTop]    = useState(59);   // iPhone Dynamic Island / notch floor
  const [safeBottom] = useState(34);   // iPhone home indicator floor
  const [dims, setDims] = useState({ w: window.innerWidth, h: window.innerHeight });
  const [countdown, setCountdown]   = useState(null);
  const [showOverlay, setShowOverlay] = useState(true);

  const countdownRef  = useRef(null);
  const iframeRef     = useRef(null);
  const touchStartY   = useRef(0);
  const touchStartX   = useRef(0);
  const touchStartT   = useRef(0);
  const didMinimize   = useRef(false);
  const swipeDelta    = useRef(0);

  const [muted, setMuted]           = useState(true);
  const [playing, setPlaying]       = useState(true);
  const playingRef                  = useRef(true); // always current, safe in closures
  const [landscape, setLandscape]   = useState(() => window.innerWidth > window.innerHeight);

  // Reset muted state whenever a new video loads
  useEffect(() => { setMuted(true); }, [videoId]);

  useEffect(() => {
    const onResize = () => {
      setDims({ w: window.innerWidth, h: window.innerHeight });
      setLandscape(window.innerWidth > window.innerHeight);
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Listen for YouTube iframe postMessage — state 0 = video ended
  useEffect(() => {
    const onMessage = (e) => {
      if (!String(e.origin).includes('youtube.com')) return;
      let data;
      try { data = typeof e.data === 'string' ? JSON.parse(e.data) : e.data; } catch { return; }
      if (data?.event === 'onStateChange') {
        if (data.info === 1) { setPlaying(true);  playingRef.current = true; }
        if (data.info === 2) { setPlaying(false); playingRef.current = false; }
        if (data.info === 0) {
          const onWatchPage = location.pathname.startsWith('/watch/');
          if (!minimized && onWatchPage && nextVideo) setCountdown(AUTOPLAY_SECS);
        }
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [minimized, nextVideo, location.pathname]);

  // Cancel countdown on navigate/minimize/video-change
  useEffect(() => {
    clearTimeout(countdownRef.current);
    setCountdown(null);
  }, [location.pathname, minimized, videoId]);

  // Tick the countdown
  useEffect(() => {
    if (countdown === null) return;
    if (countdown === 0) {
      clearTimeout(countdownRef.current);
      setCountdown(null);
      if (nextVideo) { openVideo(nextVideo.video_id); navigate(`/watch/${nextVideo.video_id}`); }
      return;
    }
    countdownRef.current = setTimeout(() => setCountdown(c => c - 1), 1000);
    return () => clearTimeout(countdownRef.current);
  }, [countdown, nextVideo, openVideo, navigate]);

  const cancelCountdown = () => { clearTimeout(countdownRef.current); setCountdown(null); };

  const handleUnmute = () => {
    setMuted(false);
    iframeRef.current?.contentWindow?.postMessage(
      JSON.stringify({ event: 'command', func: 'unMute', args: '' }),
      'https://www.youtube.com'
    );
    iframeRef.current?.contentWindow?.postMessage(
      JSON.stringify({ event: 'command', func: 'setVolume', args: [100] }),
      'https://www.youtube.com'
    );
  };

  if (!videoId) return null;

  const onWatchPage  = location.pathname.startsWith('/watch/');
  const showFull     = !minimized && onWatchPage;
  // Fill the entire screen when landscape (video playing anywhere)
  const showLandscape = landscape && !!videoId && !minimized;

  const fullStyle = {
    position: 'fixed', top: 59, left: 0,
    width: dims.w, height: Math.round(dims.w * 9 / 16),
    zIndex: 40, borderRadius: 0,
    transition: 'top 0.35s cubic-bezier(0.4,0,0.2,1), left 0.35s cubic-bezier(0.4,0,0.2,1), width 0.35s cubic-bezier(0.4,0,0.2,1), height 0.35s cubic-bezier(0.4,0,0.2,1), border-radius 0.35s ease',
  };

  const landscapeStyle = {
    position: 'fixed', top: 0, left: 0,
    width: dims.w, height: dims.h,
    zIndex: 50, borderRadius: 0,
    background: '#000',
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
    `?autoplay=1&mute=1&playsinline=1&rel=0&modestbranding=1&fs=0` +
    `&cc_load_policy=0&iv_load_policy=3&controls=1&enablejsapi=1`;

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
      minimize();
      navigate('/home');
    }
  };
  const onTouchEnd = (e) => {
    if (didMinimize.current) return;
    const t = e.changedTouches[0];
    const dy = Math.abs(t.clientY - touchStartY.current);
    const dx = Math.abs(t.clientX - touchStartX.current);
    const dt = Date.now() - touchStartT.current;
    if (dy < 20 && dx < 20 && dt < 500) {
      // Tap — toggle play/pause via postMessage (use ref to avoid stale closure)
      const cmd = playingRef.current ? 'pauseVideo' : 'playVideo';
      playingRef.current = !playingRef.current;
      setPlaying(playingRef.current);
      iframeRef.current?.contentWindow?.postMessage(
        JSON.stringify({ event: 'command', func: cmd, args: [] }),
        'https://www.youtube.com'
      );
    }
  };

  const handleExpand = () => { expand(); navigate(`/watch/${videoId}`); };
  const handleClose  = (e) => { e.stopPropagation(); close(); };

  return (
    <div style={showLandscape ? landscapeStyle : showFull ? fullStyle : miniStyle} className="bg-black">

      <iframe
        key={videoId}
        ref={iframeRef}
        src={src}
        className="w-full h-full border-0"
        allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
        allowFullScreen
        title="Video player"
      />

      {/* Unmute button — video autoplays muted (iOS-safe), tap to unmute */}
      {(showFull || showLandscape) && muted && (
        <button
          onClick={handleUnmute}
          className="absolute bottom-14 right-3 z-30 flex items-center gap-1.5 bg-black/70 text-white text-xs font-medium px-3 py-1.5 rounded-full backdrop-blur-sm"
          aria-label="Unmute"
        >
          <svg viewBox="0 0 24 24" className="w-4 h-4 fill-current flex-shrink-0">
            <path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/>
          </svg>
          Tap to unmute
        </button>
      )}

      {/* ── Full-mode: swipe-to-minimize covers whole video; buttons at top ── */}
      {showFull && !showLandscape && (
        <>
          {/* Full-video gesture layer — tap = play/pause, swipe down = minimize.
              Stops 48px from the bottom so the YouTube progress/seek bar
              remains touchable (touch events pass through to the iframe). */}
          <div
            className="absolute inset-x-0 top-0 bottom-12 z-10"
            onTouchStart={onTouchStart}
            onTouchMove={onTouchMove}
            onTouchEnd={onTouchEnd}
          />
          {/* Buttons row — on top of swipe catcher */}
          <div
            className="absolute top-0 left-0 right-0 z-20 flex items-center justify-between h-12 px-1 pointer-events-none"
            style={{ background: 'linear-gradient(to bottom, rgba(0,0,0,0.5), transparent)' }}
          >
            <div className="absolute top-1.5 left-1/2 -translate-x-1/2 w-10 h-1 rounded-full bg-white/30" />
            <button
              onClick={() => { cancelCountdown(); close(); navigate('/home'); }}
              className="bg-black/40 text-white rounded-full p-1.5 pointer-events-auto"
              aria-label="Back"
            >
              <svg viewBox="0 0 24 24" className="w-5 h-5 fill-current"><path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/></svg>
            </button>
            <button
              onClick={() => { cancelCountdown(); minimize(); navigate('/home'); }}
              className="bg-black/40 text-white rounded-full p-1.5 pointer-events-auto"
              aria-label="Minimize"
            >
              <svg viewBox="0 0 24 24" className="w-5 h-5 fill-current"><path d="M19 13H5v-2h14v2z"/></svg>
            </button>
          </div>
        </>
      )}

      {/* Block the YouTube logo/watermark in the bottom-right so it can't
          launch the YouTube app. Covers the ~48×48px tap target. */}
      <div className="absolute bottom-0 right-0 w-16 h-12 z-20" style={{ pointerEvents: 'auto' }} />

      {/* ── Autoplay countdown overlay ── */}
      {showFull && countdown !== null && nextVideo && (
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
              onClick={() => { cancelCountdown(); openVideo(nextVideo.video_id); navigate(`/watch/${nextVideo.video_id}`); }}
              className="px-5 py-2 rounded-full bg-white text-black text-sm font-semibold hover:bg-white/90 transition-colors"
            >
              Play Now
            </button>
          </div>
        </div>
      )}

      {/* ── Landscape fullscreen overlay — rotate-back hint ── */}
      {showLandscape && !showFull && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-30 flex items-center gap-2 bg-black/60 text-white text-xs px-3 py-1.5 rounded-full pointer-events-none">
          <svg viewBox="0 0 24 24" className="w-4 h-4 fill-current">
            <path d="M16.48 2.52c3.27 1.55 5.61 4.72 5.97 8.48h1.5C23.44 4.84 20.29 1.1 16.04.06l.44 2.46zM7.52 2.52l.44-2.46C3.71 1.1.56 4.84.05 11h1.5c.36-3.76 2.7-6.93 5.97-8.48zM16.04 23.94c4.25-1.04 7.4-4.78 7.91-10.94h-1.5c-.36 3.76-2.7 6.93-5.97 8.48l-.44 2.46zm-8.52 0l-.44-2.46c-3.27-1.55-5.61-4.72-5.97-8.48H.05c.51 6.16 3.66 9.9 7.91 10.94H7.52zM12 6l-4 4h3v4.5c0 .28.22.5.5.5h1c.28 0 .5-.22.5-.5V10h3l-4-4z"/>
          </svg>
          Rotate to portrait
        </div>
      )}

      {/* ── Mini-mode overlay — tap thumbnail to expand, buttons: play/pause + X ── */}
      {minimized && (
        <>
          {/* Tap anywhere on thumbnail to expand */}
          <div className="absolute inset-0 z-[5]" onClick={handleExpand} />
          {/* Play/pause + close — right side */}
          <div className="absolute top-0 right-0 bottom-0 z-10 flex items-center gap-0.5 pr-1">
            <button
              onClick={(e) => {
                e.stopPropagation();
                const cmd = playing ? 'pauseVideo' : 'playVideo';
                iframeRef.current?.contentWindow?.postMessage(
                  JSON.stringify({ event: 'command', func: cmd, args: '' }),
                  'https://www.youtube.com'
                );
              }}
              className="p-1.5" aria-label={playing ? 'Pause' : 'Play'}
            >
              {playing
                ? <svg viewBox="0 0 24 24" className="w-5 h-5 fill-white"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>
                : <svg viewBox="0 0 24 24" className="w-5 h-5 fill-white"><path d="M8 5v14l11-7z"/></svg>
              }
            </button>
            <button onClick={handleClose} className="p-1.5" aria-label="Close">
              <svg viewBox="0 0 24 24" className="w-5 h-5 fill-white"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
            </button>
          </div>
        </>
      )}
    </div>
  );
}
