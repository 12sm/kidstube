import React, { useContext, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ProfileContext } from '../App.jsx';
import BottomNav from '../components/BottomNav.jsx';
import VideoCard from '../components/VideoCard.jsx';

function ChannelAvatar({ ch, active, onClick }) {
  const [imgError, setImgError] = useState(false);
  return (
    <button
      onClick={onClick}
      className={`flex-shrink-0 flex flex-col items-center gap-1.5 transition-opacity ${active ? 'opacity-100' : 'opacity-60'}`}
    >
      <div className={`w-14 h-14 rounded-full overflow-hidden bg-yt-card flex-shrink-0 transition-all ${active ? 'ring-2 ring-white' : ''}`}>
        {ch.thumbnail_url && !imgError
          ? <img
              src={ch.thumbnail_url}
              alt={ch.channel_name}
              className="w-full h-full object-cover"
              onError={() => setImgError(true)}
            />
          : <div className="w-full h-full flex items-center justify-center text-lg font-bold text-yt-muted">
              {ch.channel_name?.charAt(0)}
            </div>
        }
      </div>
      <span className="text-xs text-yt-text w-14 text-center leading-tight line-clamp-2">{ch.channel_name}</span>
    </button>
  );
}

export default function Channels() {
  const { profileId } = useContext(ProfileContext);
  const navigate = useNavigate();
  const [channels, setChannels] = useState([]);
  const [videos, setVideos] = useState([]);
  const [loadingChannels, setLoadingChannels] = useState(true);
  const [loadingVideos, setLoadingVideos] = useState(true);
  const [activeChannel, setActiveChannel] = useState('all'); // 'all' | channelId

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

  const handleChannelFilter = (channelId) => {
    setActiveChannel(channelId);
    setVideos([]);
  };

  return (
    <div className="min-h-screen bg-yt-bg pb-24">
      {/* Header */}
      <div
        className="sticky top-0 z-10 bg-yt-bg/95 backdrop-blur-sm"
        style={{ paddingTop: 59 }}
      >
        <div className="px-4 pb-2 pt-2 border-b border-yt-border md:max-w-screen-xl md:mx-auto">
          <h1 className="text-yt-text font-semibold text-xl">Subscriptions</h1>
        </div>

        {/* Channel filter row */}
        <div className="flex gap-3 px-4 py-3 overflow-x-auto scrollbar-hide" style={{ scrollbarWidth: 'none' }}>
          {/* All chip */}
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

          {/* Channel bubbles */}
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
      </div>

      {/* Video feed */}
      <div className="pt-1 md:grid md:grid-cols-2 md:gap-x-4 md:px-4 md:pt-2">
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
              <p className="text-yt-muted text-sm text-center py-12">No videos available.</p>
            )
        }
      </div>

      <BottomNav />
    </div>
  );
}
