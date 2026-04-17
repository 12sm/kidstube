import React, { useContext, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ProfileContext } from '../App.jsx';
import BottomNav from '../components/BottomNav.jsx';

const PROFILE_COLORS = { 5: '#2eaa5c', 6: '#d4620e' };
const AVATAR_COLORS  = ['#e05252', '#4e9de0', '#50c878', '#e0a035', '#9b59b6', '#e07c4e'];

function formatDuration(secs) {
  if (!secs) return null;
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// ── Horizontal scroll shelf ───────────────────────────────────────────────────
function VideoShelf({ videos, onVideoClick }) {
  return (
    <div className="flex gap-3 overflow-x-auto scrollbar-hide px-4 pb-1">
      {videos.map(video => {
        const pct = video.duration_seconds > 0
          ? Math.min(100, (video.progress_seconds / video.duration_seconds) * 100)
          : 0;
        return (
          <button
            key={video.video_id}
            onClick={() => onVideoClick(video.video_id)}
            className="flex-shrink-0 w-44 lg:w-[360px] text-left"
          >
            <div className="relative w-full aspect-video rounded-lg overflow-hidden bg-yt-card">
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
            <p className="text-yt-text text-xs lg:text-sm font-medium mt-1.5 line-clamp-2 leading-snug">{video.title}</p>
            <p className="text-yt-muted text-xs lg:text-sm mt-0.5 line-clamp-1">{video.channel_name}</p>
          </button>
        );
      })}
    </div>
  );
}

// ── Section header ────────────────────────────────────────────────────────────
function SectionHeader({ title, onViewAll }) {
  return (
    <div className="flex items-center justify-between px-4 mb-3">
      <h2 className="text-yt-text font-bold text-lg">{title}</h2>
      {onViewAll && (
        <button
          onClick={onViewAll}
          className="text-yt-text text-sm font-medium bg-yt-card px-4 py-1.5 rounded-full hover:bg-yt-hover transition-colors"
        >
          View all
        </button>
      )}
    </div>
  );
}

// ── Simple list row (Downloads placeholder, etc.) ─────────────────────────────
function MenuRow({ icon, label, onClick }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-4 w-full px-4 py-4 hover:bg-yt-hover transition-colors text-left"
    >
      {icon}
      <span className="text-yt-text text-sm font-medium">{label}</span>
    </button>
  );
}

// ── Skeleton shelf ────────────────────────────────────────────────────────────
function SkeletonShelf() {
  return (
    <div className="flex gap-3 overflow-x-auto scrollbar-hide px-4 pb-1">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="flex-shrink-0 w-44 lg:w-[360px]">
          <div className="skeleton w-full aspect-video rounded-lg" />
          <div className="skeleton h-3 w-full mt-2 rounded" />
          <div className="skeleton h-3 w-2/3 mt-1.5 rounded" />
        </div>
      ))}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function Library() {
  const { profileId, profileName, clearProfile } = useContext(ProfileContext);
  const navigate = useNavigate();
  const [history, setHistory]   = useState([]);
  const [loading, setLoading]   = useState(true);

  useEffect(() => {
    if (!profileId) { navigate('/', { replace: true }); return; }
    fetch(`/api/watch-history/${profileId}?limit=100`)
      .then(r => r.json())
      .then(data => setHistory(data.history || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [profileId, navigate]);

  if (!profileId) return null;

  const avatarColor   = PROFILE_COLORS[parseInt(profileId)] ?? AVATAR_COLORS[(parseInt(profileId) - 1) % AVATAR_COLORS.length];
  const avatarInitial = profileName?.charAt(0)?.toUpperCase() || '?';

  // Videos with meaningful progress (> 5%) and not finished (< 95%)
  const continueWatching = history.filter(v =>
    v.duration_seconds > 0 &&
    v.progress_seconds / v.duration_seconds > 0.05 &&
    v.progress_seconds / v.duration_seconds < 0.95
  );

  const goWatch = (videoId) => navigate(`/watch/${videoId}`);

  return (
    <div className="min-h-screen bg-yt-bg pb-24">
      {/* ── Profile header ── */}
      <div
        className="px-4 pt-4 pb-5"
        style={{ paddingTop: 'calc(59px + 1rem)' }}
      >
        <div className="flex items-center gap-4 mb-5">
          <div
            className="w-16 h-16 lg:w-24 lg:h-24 rounded-full flex items-center justify-center text-white text-2xl lg:text-4xl font-bold flex-shrink-0"
            style={{ backgroundColor: avatarColor }}
          >
            {avatarInitial}
          </div>
          <div>
            <h1 className="text-yt-text font-bold text-xl lg:text-3xl leading-tight">{profileName || 'Profile'}</h1>
            <p className="text-yt-muted text-sm mt-0.5">YouTube Profile</p>
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex gap-3">
          <button
            onClick={() => { clearProfile(); navigate('/'); }}
            className="flex items-center gap-2 bg-yt-card text-yt-text text-sm font-medium px-4 py-2 rounded-full hover:bg-yt-hover transition-colors"
          >
            <svg viewBox="0 0 24 24" className="w-4 h-4 fill-current flex-shrink-0">
              <path d="M16 13h-3V3h-2v10H8l4 4 4-4zM4 19v2h16v-2H4z"/>
            </svg>
            Switch Profile
          </button>
        </div>
      </div>


      {/* ── Continue Watching ── */}
      {(loading || continueWatching.length > 0) && (
        <div className="mb-7">
          <SectionHeader title="Continue watching" />
          {loading ? <SkeletonShelf /> : (
            <VideoShelf videos={continueWatching} onVideoClick={goWatch} />
          )}
        </div>
      )}

      {/* ── History ── */}
      <div className="mb-7">
        <SectionHeader
          title="History"
          onViewAll={history.length > 0 ? () => navigate('/library/history') : null}
        />
        {loading ? <SkeletonShelf /> : history.length === 0 ? (
          <p className="px-4 text-yt-muted text-sm">Videos you watch will appear here.</p>
        ) : (
          <VideoShelf videos={history.slice(0, 12)} onVideoClick={goWatch} />
        )}
      </div>


      {/* ── Menu rows ── */}
      <MenuRow
        icon={
          <svg viewBox="0 0 24 24" className="w-6 h-6 fill-yt-muted flex-shrink-0">
            <path d="M4 6H2v14c0 1.1.9 2 2 2h14v-2H4V6zm16-4H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-2 9H10V9h8v2zm-4 4H10v-2h4v2zm4-8H10V9h8v2z"/>
          </svg>
        }
        label="Your videos"
        onClick={() => navigate('/channels')}
      />
      <MenuRow
        icon={
          <svg viewBox="0 0 24 24" className="w-6 h-6 fill-yt-muted flex-shrink-0">
            <path d="M19 9h-4V3H9v6H5l7 7 7-7zm-8 2V5h2v6h1.17L12 13.17 9.83 11H11zm-6 7h14v2H5z"/>
          </svg>
        }
        label="Downloads"
        onClick={() => {}}
      />

      <BottomNav />
    </div>
  );
}
