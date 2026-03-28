import React, { useContext, useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ProfileContext } from '../App.jsx';
import VideoCard from '../components/VideoCard.jsx';
import BottomNav from '../components/BottomNav.jsx';
import { SkeletonCard } from '../components/SkeletonCard.jsx';

export default function Channel() {
  const { channelId } = useParams();
  const { profileId } = useContext(ProfileContext);
  const navigate = useNavigate();
  const [videos, setVideos] = useState([]);
  const [channelInfo, setChannelInfo] = useState(null);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [initialLoad, setInitialLoad] = useState(true);
  const loaderRef = useRef(null);

  useEffect(() => {
    if (!profileId) navigate('/', { replace: true });
  }, [profileId, navigate]);

  const loadVideos = React.useCallback(async (pageNum) => {
    if (loading) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/channel/${channelId}?page=${pageNum}&limit=20`);
      const data = await res.json();
      if (pageNum === 0) {
        setVideos(data.videos || []);
        setChannelInfo(data.channel || null);
      } else {
        setVideos(prev => [...prev, ...(data.videos || [])]);
      }
      setHasMore((data.videos || []).length === 20);
    } catch {
      setHasMore(false);
    } finally {
      setLoading(false);
      setInitialLoad(false);
    }
  }, [channelId, loading]);

  useEffect(() => {
    if (channelId) loadVideos(0);
  }, [channelId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !loading) {
          const next = page + 1;
          setPage(next);
          loadVideos(next);
        }
      },
      { threshold: 0.1 }
    );
    if (loaderRef.current) observer.observe(loaderRef.current);
    return () => observer.disconnect();
  }, [loadVideos, hasMore, loading, page]);

  return (
    <div className="min-h-screen bg-yt-bg pb-20">
      {/* Header */}
      <div className="bg-yt-bg border-b border-yt-border">
        {/* Back button row */}
        <div className="px-4 pb-2" style={{ paddingTop: 'calc(env(safe-area-inset-top) + 0.75rem)' }}>
          <button
            onClick={() => navigate(-1)}
            className="text-yt-muted hover:text-yt-text transition-colors flex items-center gap-1 text-sm"
          >
            <svg viewBox="0 0 24 24" className="w-4 h-4 fill-current"><path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/></svg>
            Back
          </button>
        </div>

        {/* Channel info — skeleton while loading */}
        {initialLoad ? (
          <div className="px-4 pb-4 flex items-start gap-4">
            <div className="skeleton w-14 h-14 flex-shrink-0 mt-0.5" style={{ borderRadius: '50%' }} />
            <div className="flex-1 min-w-0 space-y-2 pt-1">
              <div className="skeleton h-4 w-40 rounded" />
              <div className="skeleton h-3 w-28 rounded" />
              <div className="skeleton h-3 w-full rounded mt-1" />
            </div>
          </div>
        ) : channelInfo ? (
          <div className="px-4 pb-4 flex items-start gap-4">
            {channelInfo.thumbnail_url && (
              <img src={channelInfo.thumbnail_url} alt={channelInfo.channel_name}
                className="w-14 h-14 rounded-full flex-shrink-0 object-cover mt-0.5" />
            )}
            <div className="flex-1 min-w-0">
              <h1 className="text-yt-text font-bold text-lg leading-tight">{channelInfo.channel_name}</h1>
              {(channelInfo.custom_url || channelInfo.subscriber_count) && (
                <p className="text-yt-muted text-xs mt-0.5">
                  {channelInfo.custom_url && <span>{channelInfo.custom_url}</span>}
                  {channelInfo.custom_url && channelInfo.subscriber_count && <span className="mx-1">·</span>}
                  {channelInfo.subscriber_count && (
                    <span>{(channelInfo.subscriber_count >= 1_000_000
                      ? (channelInfo.subscriber_count / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M'
                      : channelInfo.subscriber_count >= 1_000
                        ? Math.round(channelInfo.subscriber_count / 1_000) + 'K'
                        : channelInfo.subscriber_count) + ' subscribers'}
                    </span>
                  )}
                </p>
              )}
              {channelInfo.description && (
                <p className="text-yt-muted text-xs mt-1.5 line-clamp-2 leading-relaxed">{channelInfo.description}</p>
              )}
            </div>
          </div>
        ) : null}
      </div>

      {/* Video grid */}
      <div className="px-4 py-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {initialLoad
            ? Array.from({ length: 8 }).map((_, i) => <SkeletonCard key={`sk-${i}`} />)
            : videos.map((video, i) => <VideoCard key={`${video.video_id}-${i}`} video={video} />)
          }
        </div>

        <div ref={loaderRef} className="py-6 text-center text-yt-muted text-sm">
          {!initialLoad && loading && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 -mt-2">
              {Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={`sk-more-${i}`} />)}
            </div>
          )}
          {!loading && !hasMore && videos.length > 0 && `${videos.length} videos`}
          {!loading && !hasMore && videos.length === 0 && 'No videos from this channel yet.'}
        </div>
      </div>

      <BottomNav />
    </div>
  );
}
