import React, { useRef, useState, useEffect, useContext } from 'react';
import { useNavigate } from 'react-router-dom';
import { ProfileContext } from '../App.jsx';

function timeAgo(dateStr) {
  if (!dateStr) return '';
  const diff   = Date.now() - new Date(dateStr).getTime();
  const mins   = Math.floor(diff / 60000);
  const hours  = Math.floor(mins / 60);
  const days   = Math.floor(hours / 24);
  const weeks  = Math.floor(days / 7);
  const months = Math.floor(days / 30);
  const years  = Math.floor(days / 365);
  if (years  > 0) return `${years} year${years > 1 ? 's' : ''} ago`;
  if (months > 0) return `${months} month${months > 1 ? 's' : ''} ago`;
  if (weeks  > 0) return `${weeks} week${weeks > 1 ? 's' : ''} ago`;
  if (days   > 0) return `${days} day${days > 1 ? 's' : ''} ago`;
  if (hours  > 0) return `${hours} hour${hours > 1 ? 's' : ''} ago`;
  if (mins   > 0) return `${mins} minute${mins > 1 ? 's' : ''} ago`;
  return 'just now';
}

function formatViews(n) {
  if (!n) return null;
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M views';
  if (n >= 1_000)     return Math.round(n / 1_000) + 'K views';
  return n + ' views';
}

function formatDuration(secs) {
  if (!secs) return null;
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// Only one preview plays at a time across all cards
let stopCurrentPreview = null;

// ── Card menu (bottom sheet) ─────────────────────────────────────────────────
function CardMenu({ video, onClose, onRemoved }) {
  const navigate = useNavigate();
  const { profileId } = useContext(ProfileContext);

  const notInterested = () => {
    fetch('/api/not-interested', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profile_id: profileId, video_id: video.video_id }),
    }).catch(() => {});
    onClose();
    onRemoved?.(video.video_id);
  };

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/50" onClick={onClose} />
      <div className="fixed bottom-0 left-0 right-0 z-50 bg-yt-surface rounded-t-2xl overflow-hidden" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 rounded-full bg-yt-muted/40" />
        </div>

        <div className="flex gap-3 px-4 py-3 border-b border-yt-border">
          <div className="relative w-24 flex-shrink-0 rounded-lg overflow-hidden bg-yt-card" style={{ aspectRatio: '16/9' }}>
            {video.thumbnail_url && <img src={video.thumbnail_url} alt="" className="w-full h-full object-cover" />}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-yt-text text-sm font-medium line-clamp-2 leading-snug">{video.title}</p>
            <p className="text-yt-muted text-xs mt-0.5">{video.channel_name}</p>
          </div>
        </div>

        <button
          onClick={() => { onClose(); navigate(`/channel/${video.channel_id}`); }}
          className="flex items-center gap-4 w-full px-4 py-4 hover:bg-yt-hover transition-colors text-left"
        >
          <svg viewBox="0 0 24 24" className="w-5 h-5 fill-yt-muted flex-shrink-0">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z"/>
          </svg>
          <span className="text-yt-text text-sm">Go to channel</span>
        </button>

        <button
          onClick={notInterested}
          className="flex items-center gap-4 w-full px-4 py-4 hover:bg-yt-hover transition-colors text-left"
        >
          <svg viewBox="0 0 24 24" className="w-5 h-5 fill-yt-muted flex-shrink-0">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/>
          </svg>
          <span className="text-yt-text text-sm">Not interested</span>
        </button>
      </div>
    </>
  );
}

// ── Main component ───────────────────────────────────────────────────────────
export default function VideoCard({ video, compact = false, disablePreview = false, watchProgress = null, onRemoved }) {
  const navigate = useNavigate();
  const cardRef  = useRef(null);

  const goWatch = (videoId) => navigate(`/watch/${videoId}`);
  const timerRef  = useRef(null);
  const [previewing, setPreviewing] = useState(false);
  const [menuOpen,   setMenuOpen]   = useState(false);

  useEffect(() => {
    if (compact || disablePreview || !video?.video_id) return;
    const el = cardRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          timerRef.current = setTimeout(() => {
            if (stopCurrentPreview) stopCurrentPreview();
            stopCurrentPreview = () => setPreviewing(false);
            setPreviewing(true);
          }, 3500);
        } else {
          clearTimeout(timerRef.current);
          setPreviewing(false);
        }
      },
      { threshold: 0.75 }
    );
    observer.observe(el);
    return () => { observer.disconnect(); clearTimeout(timerRef.current); };
  }, [compact, disablePreview, video?.video_id]);

  if (!video) return null;

  const openMenu = (e) => { e.stopPropagation(); e.preventDefault(); if (navigator.vibrate) navigator.vibrate(8); setMenuOpen(true); };

  // ── Compact card (sidebar / Up Next / Library) ───────────────────────────
  if (compact) {
    const metaParts = [video.channel_name, formatViews(video.view_count), timeAgo(video.published_at)].filter(Boolean);
    return (
      <>
        <div className="flex gap-3 w-full hover:bg-yt-hover rounded-lg p-2 -mx-2 transition-colors">
          <button
            onClick={() => goWatch(video.video_id)}
            className="flex gap-3 flex-1 min-w-0 text-left"
          >
            <div className="relative flex-shrink-0 w-36 aspect-video rounded-lg overflow-hidden bg-yt-card">
              {video.thumbnail_url && (
                <img src={video.thumbnail_url} alt={video.title} loading="lazy" className="w-full h-full object-cover" />
              )}
              {formatDuration(video.duration_seconds) && (
                <span className="absolute bottom-1 right-1 bg-black/80 text-white text-xs px-1 rounded font-mono">
                  {formatDuration(video.duration_seconds)}
                </span>
              )}
              {watchProgress && watchProgress.duration_seconds > 0 && (
                <div className="absolute bottom-0 left-0 right-0 h-1 bg-white/20">
                  <div className="h-full bg-yt-red" style={{ width: `${Math.min(100, (watchProgress.progress_seconds / watchProgress.duration_seconds) * 100)}%` }} />
                </div>
              )}
            </div>
            <div className="flex-1 min-w-0 pt-0.5">
              <p className="text-yt-text text-sm font-medium line-clamp-2 leading-snug">{video.title}</p>
              <p className="text-yt-muted text-xs mt-1 line-clamp-1">{metaParts.join(' · ')}</p>
            </div>
          </button>
          <button onClick={openMenu} className="flex-shrink-0 flex items-center justify-center w-8 h-8 text-yt-muted hover:text-yt-text transition-colors self-start mt-0.5" aria-label="More options">
            <svg viewBox="0 0 24 24" className="w-5 h-5 fill-current"><path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/></svg>
          </button>
        </div>
        {menuOpen && <CardMenu video={video} onClose={() => setMenuOpen(false)} onRemoved={onRemoved} />}
      </>
    );
  }

  // ── Full card (home feed) ────────────────────────────────────────────────
  const previewSrc = `https://www.youtube.com/embed/${video.video_id}?autoplay=1&mute=1&controls=0&playsinline=1&rel=0&modestbranding=1&loop=1&playlist=${video.video_id}`;
  const metaParts  = [formatViews(video.view_count), timeAgo(video.published_at)].filter(Boolean);

  return (
    <>
      <div ref={cardRef} className="block w-full group">
        {/* Thumbnail */}
        <button onClick={() => goWatch(video.video_id)} className="block w-full">
          <div className="relative w-full aspect-video overflow-hidden bg-yt-card md:rounded-xl">
            {video.thumbnail_url && (
              <img
                src={video.thumbnail_url}
                alt={video.title}
                loading="lazy"
                className={`w-full h-full object-cover transition-all duration-500 ${previewing ? 'opacity-0' : 'opacity-100 group-hover:scale-105'}`}
              />
            )}
            {previewing && (
              <>
                <iframe src={previewSrc} className="absolute inset-0 w-full h-full border-0" allow="autoplay; encrypted-media" title={video.title} />
                <div className="absolute inset-0 z-10" />
                <div className="absolute bottom-2 left-2 z-20 bg-black/60 rounded-full p-1.5">
                  <svg viewBox="0 0 24 24" className="w-3 h-3 fill-white">
                    <path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/>
                  </svg>
                </div>
              </>
            )}
            {!previewing && formatDuration(video.duration_seconds) && (
              <span className="absolute bottom-2 right-2 bg-black/80 text-white text-xs px-1.5 py-0.5 rounded font-mono">
                {formatDuration(video.duration_seconds)}
              </span>
            )}
            {!previewing && watchProgress && watchProgress.duration_seconds > 0 && (
              <div className="absolute bottom-0 left-0 right-0 h-1 bg-white/20">
                <div className="h-full bg-yt-red" style={{ width: `${Math.min(100, (watchProgress.progress_seconds / watchProgress.duration_seconds) * 100)}%` }} />
              </div>
            )}
          </div>
        </button>

        {/* Info row */}
        <div className="mt-2 px-3 pb-4 flex gap-2 items-start">
          {/* Channel avatar — taps to channel page */}
          <button onClick={() => navigate(`/channel/${video.channel_id}`)} className="flex-shrink-0 mt-0.5" tabIndex={-1}>
            {(video.channel_thumbnail || video.channel_thumbnail_img)
              ? <img src={video.channel_thumbnail || video.channel_thumbnail_img} alt={video.channel_name} className="w-9 h-9 rounded-full object-cover" />
              : <div className="w-9 h-9 rounded-full bg-yt-card flex items-center justify-center text-xs font-bold text-yt-muted">{video.channel_name?.charAt(0)}</div>
            }
          </button>

          {/* Text */}
          <button onClick={() => goWatch(video.video_id)} className="flex-1 min-w-0 text-left">
            <h3 className="text-yt-text text-sm font-medium line-clamp-2 leading-snug">{video.title}</h3>
            <p className="text-yt-muted text-xs mt-0.5">{video.channel_name}</p>
            <p className="text-yt-muted text-xs">{metaParts.join(' · ') || '\u00A0'}</p>
          </button>

          {/* 3-dot menu */}
          <button
            onClick={openMenu}
            className="flex-shrink-0 w-8 h-8 flex items-center justify-center text-yt-muted hover:text-yt-text transition-colors -mr-1"
            aria-label="More options"
          >
            <svg viewBox="0 0 24 24" className="w-5 h-5 fill-current">
              <path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/>
            </svg>
          </button>
        </div>
      </div>

      {menuOpen && <CardMenu video={video} onClose={() => setMenuOpen(false)} onRemoved={onRemoved} />}
    </>
  );
}
