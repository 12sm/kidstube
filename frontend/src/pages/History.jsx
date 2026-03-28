import React, { useContext, useEffect, useState, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { ProfileContext } from '../App.jsx';

function HistoryMenu({ video, profileId, onClose, onRemoved, onBlocked }) {
  const navigate = useNavigate();

  const removeFromHistory = () => {
    fetch(`/api/watch-history/${profileId}/${video.video_id}`, { method: 'DELETE' }).catch(() => {});
    onClose();
    onRemoved(video.video_id);
  };

  const notInterested = () => {
    fetch('/api/not-interested', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profile_id: profileId, video_id: video.video_id }),
    }).catch(() => {});
    onClose();
    onBlocked(video.video_id);
  };

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/50" onClick={onClose} />
      <div className="fixed bottom-0 left-0 right-0 z-50 bg-yt-surface rounded-t-2xl overflow-hidden" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 rounded-full bg-yt-muted/40" />
        </div>

        {/* Video preview */}
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
          onClick={removeFromHistory}
          className="flex items-center gap-4 w-full px-4 py-4 hover:bg-yt-hover transition-colors text-left"
        >
          <svg viewBox="0 0 24 24" className="w-5 h-5 fill-yt-muted flex-shrink-0">
            <path d="M13 3a9 9 0 1 0 .001 18.001A9 9 0 0 0 13 3zm0 16c-3.86 0-7-3.14-7-7s3.14-7 7-7 7 3.14 7 7-3.14 7-7 7zm.5-11H12v6l5.25 3.15.75-1.23-4.5-2.67V8z"/>
          </svg>
          <span className="text-yt-text text-sm">Remove from watch history</span>
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

function formatDuration(secs) {
  if (!secs) return null;
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function formatViews(n) {
  if (!n) return null;
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M views';
  if (n >= 1_000) return Math.round(n / 1_000) + 'K views';
  return n + ' views';
}

function dayLabel(dateStr) {
  const d = new Date(dateStr);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const target = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diffDays = Math.round((today - target) / 86400000);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return d.toLocaleDateString('en-US', { weekday: 'long' });
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
}

function groupByDay(history) {
  const groups = [];
  const seen = {};
  for (const video of history) {
    const label = dayLabel(video.watched_at);
    if (!seen[label]) { seen[label] = true; groups.push({ label, videos: [] }); }
    groups[groups.length - 1].videos.push(video);
  }
  return groups;
}

function SkeletonRow() {
  return (
    <div className="flex gap-3 px-4 py-2">
      <div className="skeleton flex-shrink-0 rounded-lg" style={{ width: 160, aspectRatio: '16/9' }} />
      <div className="flex-1 pt-1 space-y-2">
        <div className="skeleton h-3.5 w-full rounded" />
        <div className="skeleton h-3.5 w-4/5 rounded" />
        <div className="skeleton h-3 w-1/2 rounded mt-1" />
      </div>
    </div>
  );
}

export default function History() {
  const { profileId } = useContext(ProfileContext);
  const navigate = useNavigate();
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [menuVideo, setMenuVideo] = useState(null);
  const searchRef = useRef(null);

  const removeVideo = useCallback((videoId) => {
    setHistory(prev => prev.filter(v => v.video_id !== videoId));
  }, []);

  useEffect(() => {
    if (!profileId) { navigate('/', { replace: true }); return; }
    fetch(`/api/watch-history/${profileId}?limit=200`)
      .then(r => r.json())
      .then(data => setHistory(data.history || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [profileId, navigate]);

  if (!profileId) return null;

  const filtered = query.trim()
    ? history.filter(v =>
        v.title?.toLowerCase().includes(query.toLowerCase()) ||
        v.channel_name?.toLowerCase().includes(query.toLowerCase())
      )
    : history;

  const groups = groupByDay(filtered);

  return (
    <div className="min-h-screen bg-yt-bg pb-10">
      {/* Header */}
      <div
        className="sticky top-0 z-10 bg-yt-bg"
        style={{ paddingTop: 'env(safe-area-inset-top)' }}
      >
        <div className="flex items-center gap-2 px-2 py-2">
          <button
            onClick={() => navigate('/library')}
            className="w-10 h-10 flex items-center justify-center text-yt-text hover:bg-yt-hover rounded-full transition-colors"
          >
            <svg viewBox="0 0 24 24" className="w-6 h-6 fill-current">
              <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/>
            </svg>
          </button>
          <h1 className="text-yt-text font-bold text-xl flex-1">History</h1>
        </div>

        {/* Search bar */}
        <div className="px-4 pb-3">
          <div className="flex items-center gap-3 bg-yt-card rounded-full px-4 py-2.5">
            <svg viewBox="0 0 24 24" className="w-5 h-5 fill-yt-muted flex-shrink-0">
              <path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>
            </svg>
            <input
              ref={searchRef}
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search watch history"
              className="flex-1 bg-transparent text-yt-text placeholder-yt-muted text-sm outline-none"
            />
            {query && (
              <button onClick={() => setQuery('')} className="text-yt-muted">
                <svg viewBox="0 0 24 24" className="w-4 h-4 fill-current">
                  <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
                </svg>
              </button>
            )}
          </div>
        </div>

      </div>

      {/* Content */}
      {loading && (
        <div className="pt-3 space-y-1">
          {Array.from({ length: 6 }).map((_, i) => <SkeletonRow key={i} />)}
        </div>
      )}

      {!loading && filtered.length === 0 && (
        <div className="text-center py-20 px-6">
          <svg viewBox="0 0 24 24" className="w-12 h-12 fill-yt-muted mx-auto mb-3">
            <path d="M13 3a9 9 0 1 0 .001 18.001A9 9 0 0 0 13 3zm0 16c-3.86 0-7-3.14-7-7s3.14-7 7-7 7 3.14 7 7-3.14 7-7 7zm.5-11H12v6l5.25 3.15.75-1.23-4.5-2.67V8z"/>
          </svg>
          <p className="text-yt-muted text-sm">
            {query ? `No results for "${query}"` : 'No watch history yet.'}
          </p>
        </div>
      )}

      {!loading && groups.map(({ label, videos }) => (
        <div key={label} className="pt-4">
          <h2 className="text-yt-text font-bold text-base px-4 mb-2">{label}</h2>
          {videos.map(video => {
            const pct = video.duration_seconds > 0
              ? Math.min(100, (video.progress_seconds / video.duration_seconds) * 100)
              : 0;
            const meta = [video.channel_name, formatViews(video.view_count)].filter(Boolean).join(' · ');
            return (
              <button
                key={video.video_id + video.watched_at}
                onClick={() => navigate(`/watch/${video.video_id}`)}
                className="flex gap-3 w-full px-4 py-2.5 hover:bg-yt-hover transition-colors text-left"
              >
                {/* Thumbnail */}
                <div className="relative flex-shrink-0 rounded-lg overflow-hidden bg-yt-card" style={{ width: 160, aspectRatio: '16/9' }}>
                  {video.thumbnail_url && (
                    <img src={video.thumbnail_url} alt={video.title} className="w-full h-full object-cover" />
                  )}
                  {formatDuration(video.duration_seconds) && (
                    <span className="absolute bottom-1 right-1 bg-black/80 text-white text-xs px-1 rounded font-mono">
                      {formatDuration(video.duration_seconds)}
                    </span>
                  )}
                  {pct > 0 && (
                    <div className="absolute bottom-0 left-0 right-0 h-1 bg-white/20">
                      <div className="h-full bg-yt-red" style={{ width: `${pct}%` }} />
                    </div>
                  )}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0 pt-0.5">
                  <p className="text-yt-text text-sm font-medium line-clamp-2 leading-snug">{video.title}</p>
                  <p className="text-yt-muted text-xs mt-1">{meta}</p>
                </div>

                {/* 3-dot */}
                <button
                  onClick={e => { e.stopPropagation(); setMenuVideo(video); }}
                  className="flex-shrink-0 w-8 h-8 flex items-center justify-center text-yt-muted self-start mt-0.5"
                >
                  <svg viewBox="0 0 24 24" className="w-5 h-5 fill-current">
                    <path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/>
                  </svg>
                </button>
              </button>
            );
          })}
        </div>
      ))}

      {menuVideo && (
        <HistoryMenu
          video={menuVideo}
          profileId={profileId}
          onClose={() => setMenuVideo(null)}
          onRemoved={removeVideo}
          onBlocked={removeVideo}
        />
      )}
    </div>
  );
}
