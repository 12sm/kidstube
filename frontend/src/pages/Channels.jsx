import React, { useContext, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ProfileContext } from '../App.jsx';
import BottomNav from '../components/BottomNav.jsx';
import VideoCard from '../components/VideoCard.jsx';

const AVATAR_COLORS = ['#e05252', '#4e9de0', '#50c878', '#e0a035', '#9b59b6', '#e07c4e'];

// lg header height: py-3 (12×2) + h-6 (24) = 48px
const HEADER_H = 48;

// ── Channel avatar bubble (mobile filter row) ─────────────────────────────────
function ChannelAvatar({ ch, active, onClick }) {
  const [imgError, setImgError] = useState(false);
  return (
    <button
      onClick={onClick}
      className={`flex-shrink-0 flex flex-col items-center gap-1.5 transition-opacity ${active ? 'opacity-100' : 'opacity-60'}`}
    >
      <div className={`w-14 h-14 rounded-full overflow-hidden bg-yt-card flex-shrink-0 transition-all ${active ? 'ring-2 ring-white' : ''}`}>
        {ch.thumbnail_url && !imgError
          ? <img src={ch.thumbnail_url} alt={ch.channel_name} className="w-full h-full object-cover" onError={() => setImgError(true)} />
          : <div className="w-full h-full flex items-center justify-center text-lg font-bold text-yt-muted">{ch.channel_name?.charAt(0)}</div>
        }
      </div>
      <span className="text-xs text-yt-text w-14 text-center leading-tight line-clamp-2">{ch.channel_name}</span>
    </button>
  );
}

// ── Sidebar channel row (iPad) ────────────────────────────────────────────────
function SidebarRow({ ch, active, onClick }) {
  const [imgError, setImgError] = useState(false);
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-3 w-full px-3 py-2 rounded-lg transition-colors text-left ${active ? 'bg-yt-card' : 'hover:bg-yt-hover'}`}
    >
      <div className="w-9 h-9 rounded-full overflow-hidden bg-yt-card flex-shrink-0">
        {ch.thumbnail_url && !imgError
          ? <img src={ch.thumbnail_url} alt={ch.channel_name} className="w-full h-full object-cover" onError={() => setImgError(true)} />
          : <div className="w-full h-full flex items-center justify-center text-sm font-bold text-yt-muted">{ch.channel_name?.charAt(0)}</div>
        }
      </div>
      <span className={`text-sm line-clamp-1 ${active ? 'text-yt-text font-medium' : 'text-yt-text'}`}>{ch.channel_name}</span>
    </button>
  );
}

export default function Channels() {
  const { profileId, profileName, clearProfile } = useContext(ProfileContext);
  const navigate = useNavigate();
  const [channels, setChannels]               = useState([]);
  const [videos, setVideos]                   = useState([]);
  const [loadingChannels, setLoadingChannels] = useState(true);
  const [loadingVideos, setLoadingVideos]     = useState(true);
  const [activeChannel, setActiveChannel]     = useState('all');

  useEffect(() => {
    if (!profileId) { navigate('/', { replace: true }); return; }
    fetch(`/api/subscriptions/${profileId}`)
      .then(r => r.json())
      .then(data => setChannels(data.channels || []))
      .catch(() => {})
      .finally(() => setLoadingChannels(false));
  }, [profileId, navigate]);

  useEffect(() => {
    if (!profileId) return;
    setLoadingVideos(true);
    const url = activeChannel === 'all'
      ? `/api/feed/${profileId}?limit=30`
      : `/api/channel/${activeChannel}?limit=30`;
    fetch(url)
      .then(r => r.json())
      .then(data => setVideos(data.videos || []))
      .catch(() => {})
      .finally(() => setLoadingVideos(false));
  }, [profileId, activeChannel]);

  if (!profileId) return null;

  const avatarColor   = AVATAR_COLORS[(parseInt(profileId) - 1) % AVATAR_COLORS.length];
  const avatarInitial = profileName?.charAt(0)?.toUpperCase() || '?';

  const handleChannelFilter = (channelId) => {
    setActiveChannel(channelId);
    setVideos([]);
  };

  const shelfVideos = videos.slice(0, 8);

  return (
    <div className="min-h-screen bg-yt-bg pb-24">

      {/* ── Header (all breakpoints) ── */}
      <div
        className="sticky top-0 z-20 bg-yt-bg/95 backdrop-blur-sm border-b border-yt-border"
        style={{ paddingTop: 'env(safe-area-inset-top)' }}
      >
        <div className="px-4 py-2.5 lg:py-3 flex items-center justify-between">
          <div className="flex items-center">
            <svg viewBox="0 0 28 20" className="h-5 lg:h-6 w-auto" xmlns="http://www.w3.org/2000/svg">
              <path fill="#FF0000" d="M27.97 3.45s-.27-1.9-1.1-2.74C25.82.61 24.64.61 24.1.54 20.17-.02 14 0 14 0S7.83-.02 3.9.54C3.36.61 2.18.61 1.13 1.71.3 2.55.03 4.45.03 4.45S-.24 6.65-.24 8.85v2.05c0 2.2.27 4.4.27 4.4s.27 1.9 1.1 2.74c1.05 1.1 2.43 1.07 3.04 1.18C6.17 19.4 14 19.5 14 19.5s6.17-.1 10.1-.63c.54-.07 1.72-.07 2.77-1.17.83-.84 1.1-2.74 1.1-2.74s.27-2.2.27-4.4V7.85c0-2.2-.27-4.4-.27-4.4zM11.12 13.5V5.88l7.46 3.82-7.46 3.8z"/>
            </svg>
            <span className="ml-1.5 text-yt-text font-bold text-sm lg:text-base tracking-tight">YouTube</span>
          </div>
          <button onClick={() => { clearProfile(); navigate('/'); }} title={`Switch profile (${profileName})`}>
            <div
              className="w-8 h-8 lg:w-9 lg:h-9 rounded-full flex items-center justify-center text-white text-sm lg:text-base font-bold ring-2 ring-transparent hover:ring-white/30 transition-all"
              style={{ backgroundColor: avatarColor }}
            >
              {avatarInitial}
            </div>
          </button>
        </div>

        {/* Mobile only: page title */}
        <div className="lg:hidden px-4 pb-2 pt-1">
          <h1 className="text-yt-text font-semibold text-xl">Subscriptions</h1>
        </div>
      </div>

      {/* ── Below header: sidebar + content ── */}
      <div className="lg:flex">

        {/* ── iPad: left sidebar ── */}
        <div
          className="hidden lg:flex lg:flex-col lg:w-56 lg:shrink-0 lg:border-r lg:border-yt-border lg:sticky lg:overflow-y-auto"
          style={{ top: HEADER_H, height: `calc(100vh - ${HEADER_H}px)` }}
        >
          <div className="px-2 py-3">
            <p className="text-yt-muted text-xs font-medium uppercase tracking-wider px-3 mb-2">Channels</p>

            {/* All channels row */}
            <button
              onClick={() => handleChannelFilter('all')}
              className={`flex items-center gap-3 w-full px-3 py-2 rounded-lg transition-colors text-left ${activeChannel === 'all' ? 'bg-yt-card' : 'hover:bg-yt-hover'}`}
            >
              <div className="w-9 h-9 rounded-full bg-yt-card flex items-center justify-center flex-shrink-0">
                <svg viewBox="0 0 24 24" className="w-5 h-5 fill-yt-text">
                  <path d="M4 6H2v14c0 1.1.9 2 2 2h14v-2H4V6zm16-4H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-8 12.5v-9l6 4.5-6 4.5z"/>
                </svg>
              </div>
              <span className={`text-sm line-clamp-1 ${activeChannel === 'all' ? 'text-yt-text font-medium' : 'text-yt-text'}`}>All channels</span>
            </button>

            {loadingChannels
              ? Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-3 px-3 py-2">
                    <div className="w-9 h-9 rounded-full skeleton flex-shrink-0" />
                    <div className="h-3 skeleton rounded flex-1" />
                  </div>
                ))
              : channels.map(ch => (
                  <SidebarRow
                    key={ch.channel_id}
                    ch={ch}
                    active={activeChannel === ch.channel_id}
                    onClick={() => handleChannelFilter(ch.channel_id)}
                  />
                ))
            }
          </div>
        </div>

        {/* ── Main content ── */}
        <div className="flex-1 min-w-0">

          {/* Mobile: channel bubble filter row */}
          <div className="lg:hidden overflow-x-auto scrollbar-hide">
            <div className="flex gap-3 px-4 py-3">
              <button
                onClick={() => handleChannelFilter('all')}
                className={`flex-shrink-0 flex flex-col items-center gap-1.5 ${activeChannel === 'all' ? 'opacity-100' : 'opacity-60'}`}
              >
                <div className={`w-14 h-14 rounded-full flex items-center justify-center bg-yt-card transition-all ${activeChannel === 'all' ? 'ring-2 ring-white' : ''}`}>
                  <svg viewBox="0 0 24 24" className="w-6 h-6 fill-yt-text">
                    <path d="M4 6H2v14c0 1.1.9 2 2 2h14v-2H4V6zm16-4H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-8 12.5v-9l6 4.5-6 4.5z"/>
                  </svg>
                </div>
                <span className="text-xs text-yt-text font-medium">All</span>
              </button>
              {loadingChannels
                ? Array.from({ length: 6 }).map((_, i) => (
                    <div key={i} className="flex-shrink-0 flex flex-col items-center gap-1.5">
                      <div className="w-14 h-14 rounded-full skeleton" />
                      <div className="w-12 h-2.5 skeleton rounded" />
                    </div>
                  ))
                : channels.map(ch => (
                    <ChannelAvatar
                      key={ch.channel_id}
                      ch={ch}
                      active={activeChannel === ch.channel_id}
                      onClick={() => handleChannelFilter(ch.channel_id)}
                    />
                  ))
              }
            </div>
            <div className="border-b border-yt-border" />
          </div>

          {/* ── iPad: "Most relevant" horizontal shelf ── */}
          <div className="hidden lg:block px-4 pt-5 pb-1">
            <h2 className="text-yt-text font-bold text-base mb-3">Most relevant</h2>
            {loadingVideos ? (
              <div className="flex gap-4 overflow-hidden pb-3">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="flex-shrink-0 w-72">
                    <div className="w-full aspect-video skeleton rounded-xl" />
                    <div className="flex gap-3 mt-2">
                      <div className="w-9 h-9 rounded-full skeleton flex-shrink-0" />
                      <div className="flex-1 space-y-1.5">
                        <div className="h-3.5 skeleton rounded w-full" />
                        <div className="h-3 skeleton rounded w-2/3" />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : shelfVideos.length > 0 ? (
              <div className="flex gap-4 overflow-x-auto scrollbar-hide pb-3">
                {shelfVideos.map(video => (
                  <div key={video.video_id} className="flex-shrink-0 w-72">
                    <VideoCard video={video} disablePreview />
                  </div>
                ))}
              </div>
            ) : null}
            <div className="border-b border-yt-border mt-1" />
          </div>

          {/* ── Video grid ── */}
          <div className="pt-1 md:grid md:grid-cols-2 md:gap-x-4 md:px-4 md:pt-2 lg:grid-cols-3 lg:gap-4 lg:px-4 lg:pt-4">
            {loadingVideos
              ? Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="mb-4 md:mb-0">
                    <div className="w-full aspect-video skeleton" />
                    <div className="flex gap-3 px-3 mt-2">
                      <div className="w-9 h-9 rounded-full skeleton flex-shrink-0" />
                      <div className="flex-1 space-y-1.5">
                        <div className="h-3.5 skeleton rounded w-full" />
                        <div className="h-3.5 skeleton rounded w-3/4" />
                        <div className="h-3 skeleton rounded w-1/2" />
                      </div>
                    </div>
                  </div>
                ))
              : videos.length > 0
                ? videos.map(video => (
                    <VideoCard key={video.video_id} video={video} disablePreview />
                  ))
                : (
                  <p className="text-yt-muted text-sm text-center py-12 lg:col-span-3">No videos available.</p>
                )
            }
          </div>
        </div>
      </div>

      <BottomNav />
    </div>
  );
}
