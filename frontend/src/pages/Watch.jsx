import React, { useContext, useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ProfileContext } from '../App.jsx';
import { usePlayerContext } from '../contexts/PlayerContext.jsx';
import VideoCard from '../components/VideoCard.jsx';

// Report watch progress to backend every 15s
const PROGRESS_INTERVAL = 15_000;

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

export default function Watch() {
  const { videoId }  = useParams();
  const { profileId } = useContext(ProfileContext);
  const { openVideo, setNextVideo, setRelatedVideos, fullscreen } = usePlayerContext();
  const navigate      = useNavigate();
  const [videoMeta, setVideoMeta] = useState(null);
  const [related,   setRelated]   = useState([]);
  const [videoEnded, setVideoEnded] = useState(false);
  const [descExpanded,   setDescExpanded]   = useState(false);
  const [relatedFilter,  setRelatedFilter]  = useState('all'); // 'all' | channelId
  const [reaction, setReaction] = useState(null); // null | 'like' | 'dislike'

  const handleReact = (r) => {
    const next = reaction === r ? null : r; // toggle off if same
    setReaction(next);
    if (!profileId || !videoId) return;
    fetch(`/api/video/${videoId}/react`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profile_id: profileId, reaction: next || r }),
    }).catch(() => {});
  };

  // Track progress via postMessage from iframe
  const progressRef    = useRef({ current: 0, duration: 0 });
  const progressTimer  = useRef(null);

  useEffect(() => {
    if (!profileId) navigate('/', { replace: true });
  }, [profileId, navigate]);

  // Only open the video if it isn't already loaded — prevents resetting the
  // player (and losing playback position) when navigating back to this page.
  const { videoId: activeVideoId } = usePlayerContext();
  useEffect(() => {
    if (videoId && videoId !== activeVideoId) openVideo(videoId);
    setVideoEnded(false);
    setReaction(null); // reset on new video
  }, [videoId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!videoId) return;
    fetch(`/api/video/${videoId}`)
      .then(r => r.json())
      .then(data => setVideoMeta(data.video || null))
      .catch(() => {});
  }, [videoId]);

  useEffect(() => {
    if (!videoId) return;
    fetch(`/api/related/${videoId}?profile_id=${profileId}`)
      .then(r => r.json())
      .then(data => {
        const videos = data.videos || [];
        setRelated(videos);
        setRelatedFilter('all');
        if (videos.length > 0) setNextVideo(videos[0]);
        setRelatedVideos(videos);
      })
      .catch(() => {});
  }, [videoId, setNextVideo]);

  // Record video in history immediately on open, then update progress periodically
  useEffect(() => {
    if (!videoId || !profileId) return;

    const save = () => {
      const { current, duration } = progressRef.current;
      fetch('/api/watch-history', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profile_id: profileId, video_id: videoId, progress_seconds: current, duration_seconds: duration })
      }).catch(() => {});
    };

    // Record immediately so it always shows in history
    save();

    // Listen for YouTube iframe time updates + video end
    const onMessage = (e) => {
      if (!String(e.origin).includes('youtube.com')) return;
      let data;
      try { data = typeof e.data === 'string' ? JSON.parse(e.data) : e.data; } catch { return; }
      if (data?.event === 'infoDelivery' && data?.info) {
        const cur = data.info.currentTime;
        const dur = data.info.duration;
        if (cur > 0) progressRef.current = { current: Math.floor(cur), duration: Math.floor(dur || 0) };
        // Show our end-screen 20s before video ends to block YouTube's end-card overlays
        if (cur > 0 && dur > 30) {
          if (dur - cur <= 20) setVideoEnded(true);
          else setVideoEnded(false);
        }
      }
      if (data?.event === 'onStateChange' && data?.info === 0) {
        setVideoEnded(true);
      }
    };
    window.addEventListener('message', onMessage);

    progressTimer.current = setInterval(save, PROGRESS_INTERVAL);
    return () => {
      clearInterval(progressTimer.current);
      window.removeEventListener('message', onMessage);
      save();
    };
  }, [videoId, profileId]);

  if (!profileId) return null;

  return (
    /* On mobile: full-height flex column so the content below the video
       lives in its own scroll container and can never scroll behind the
       fixed MiniPlayer.  On desktop: revert to normal block layout. */
    <div className="bg-yt-bg flex flex-col h-dvh pt-[59px] lg:pt-0">
      <div className="flex flex-col flex-1 overflow-hidden lg:flex-row">

        <div className={`flex flex-col flex-1 overflow-hidden lg:flex-shrink-0 min-w-0 ${fullscreen ? 'lg:w-full' : 'lg:w-[68%]'}`}>

          {/* Video spacer — MiniPlayer overlays this area in full mode.
              flex-shrink-0 keeps it from being squeezed by the scroll container.
              The back + minimize buttons live inside MiniPlayer's overlay. */}
          <div className="relative w-full aspect-video bg-black flex-shrink-0 lg:rounded-xl">
            {/* ── End-screen overlay — shown when video finishes ── */}
            {videoEnded && related.length > 0 && (
              <div className="absolute inset-0 z-50 bg-black/95 lg:rounded-xl flex flex-col justify-center">
                <p className="text-white/50 text-xs uppercase tracking-widest mb-3 text-center flex-shrink-0">Up Next</p>
                <div className="flex gap-3 overflow-x-auto px-3 pb-1" style={{ scrollbarWidth: 'none' }}>
                  {related.map(video => (
                    <button
                      key={video.video_id}
                      onClick={() => { openVideo(video.video_id); navigate(`/watch/${video.video_id}`); }}
                      className="flex-shrink-0 w-36 text-left group"
                    >
                      <div className="relative w-full aspect-video rounded-lg overflow-hidden bg-yt-card">
                        {video.thumbnail_url && (
                          <img src={video.thumbnail_url} alt={video.title} className="w-full h-full object-cover group-active:scale-95 transition-transform" />
                        )}
                        {formatDuration(video.duration_seconds) && (
                          <span className="absolute bottom-1 right-1 bg-black/80 text-white text-xs px-1 rounded font-mono">
                            {formatDuration(video.duration_seconds)}
                          </span>
                        )}
                      </div>
                      <p className="text-white text-xs font-medium mt-1 line-clamp-2 leading-snug">{video.title}</p>
                      <p className="text-white/50 text-xs mt-0.5 line-clamp-1">{video.channel_name}</p>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Scrollable content below the video (mobile).
              On desktop this is just a normal block. */}
          <div
            className="flex-1 overflow-y-auto"
            style={{ WebkitOverflowScrolling: 'touch' }}
          >

          {/* Video info */}
          {videoMeta && (
            <div className="px-4 pt-3 pb-2">
              {/* Title */}
              <h1 className="text-yt-text font-semibold text-base leading-snug mb-1">{videoMeta.title}</h1>

              {/* Views + date + channel row (tappable → description expand) */}
              <button
                className="w-full text-left"
                onClick={() => setDescExpanded(v => !v)}
              >
                <p className="text-yt-muted text-sm">
                  {[
                    formatViews(videoMeta.view_count),
                    videoMeta.published_at
                      ? new Date(videoMeta.published_at).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
                      : null,
                  ].filter(Boolean).join(' · ')}
                </p>

                {/* Description snippet / expanded */}
                {videoMeta.description && (
                  <p className={`text-yt-muted text-sm mt-1 ${descExpanded ? '' : 'line-clamp-2'}`}>
                    {videoMeta.description}
                  </p>
                )}

                <span className="text-yt-text text-xs font-semibold mt-0.5 inline-block">
                  {descExpanded ? 'Show less' : '...more'}
                </span>
              </button>

              {/* Channel row */}
              <button
                onClick={() => navigate(`/channel/${videoMeta.channel_id}`)}
                className="flex items-center gap-3 group mt-3"
              >
                {(videoMeta.channel_thumbnail_img || videoMeta.channel_thumbnail) && (
                  <img
                    src={videoMeta.channel_thumbnail_img || videoMeta.channel_thumbnail}
                    alt={videoMeta.channel_name}
                    className="w-9 h-9 rounded-full flex-shrink-0 object-cover"
                  />
                )}
                <span className="text-yt-text text-sm font-medium group-hover:text-yt-muted transition-colors">
                  {videoMeta.channel_name}
                </span>
              </button>

              {/* Action bar */}
              <div className="mt-4 flex items-center gap-2 overflow-x-auto scrollbar-hide pb-1">
                {/* Like / Dislike pill */}
                <div className="flex items-center bg-yt-card rounded-full flex-shrink-0">
                  <button
                    className={`flex items-center gap-1.5 pl-4 pr-3 py-2 transition-colors ${reaction === 'like' ? 'text-yt-text' : 'text-yt-muted'}`}
                    onClick={() => handleReact('like')}
                  >
                    <svg viewBox="0 0 24 24" className={`w-[18px] h-[18px] flex-shrink-0 ${reaction === 'like' ? 'fill-yt-text' : 'fill-yt-muted'}`}>
                      <path d="M1 21h4V9H1v12zm22-11c0-1.1-.9-2-2-2h-6.31l.95-4.57.03-.32c0-.41-.17-.79-.44-1.06L14.17 1 7.59 7.59C7.22 7.95 7 8.45 7 9v10c0 1.1.9 2 2 2h9c.83 0 1.54-.5 1.84-1.22l3.02-7.05c.09-.23.14-.47.14-.73v-2z"/>
                    </svg>
                    <span className="text-sm font-medium">Like</span>
                  </button>
                  <div className="w-px h-5 bg-yt-border flex-shrink-0" />
                  <button
                    className="flex items-center px-3 py-2"
                    onClick={() => handleReact('dislike')}
                  >
                    <svg viewBox="0 0 24 24" className={`w-[18px] h-[18px] flex-shrink-0 ${reaction === 'dislike' ? 'fill-yt-text' : 'fill-yt-muted'}`}>
                      <path d="M15 3H6c-.83 0-1.54.5-1.84 1.22l-3.02 7.05c-.09.23-.14.47-.14.73v2c0 1.1.9 2 2 2h6.31l-.95 4.57-.03.32c0 .41.17.79.44 1.06L9.83 23l6.59-6.59c.36-.36.58-.86.58-1.41V5c0-1.1-.9-2-2-2zm4 0v12h4V3h-4z"/>
                    </svg>
                  </button>
                </div>

                {/* Share */}
                <button className="flex items-center gap-1.5 bg-yt-card rounded-full px-4 py-2 flex-shrink-0">
                  <svg viewBox="0 0 24 24" className="w-[18px] h-[18px] fill-yt-text flex-shrink-0">
                    <path d="M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7c.05-.23.09-.46.09-.7s-.04-.47-.09-.7l7.05-4.11c.54.5 1.25.81 2.04.81 1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3c0 .24.04.47.09.7L8.04 9.81C7.5 9.31 6.79 9 6 9c-1.66 0-3 1.34-3 3s1.34 3 3 3c.79 0 1.5-.31 2.04-.81l7.12 4.16c-.05.21-.08.43-.08.65 0 1.61 1.31 2.92 2.92 2.92s2.92-1.31 2.92-2.92-1.31-2.92-2.92-2.92z"/>
                  </svg>
                  <span className="text-yt-text text-sm font-medium">Share</span>
                </button>

                {/* Save */}
                <button className="flex items-center gap-1.5 bg-yt-card rounded-full px-4 py-2 flex-shrink-0">
                  <svg viewBox="0 0 24 24" className="w-[18px] h-[18px] fill-yt-text flex-shrink-0">
                    <path d="M17 3H7c-1.1 0-2 .9-2 2v16l7-3 7 3V5c0-1.1-.9-2-2-2z"/>
                  </svg>
                  <span className="text-yt-text text-sm font-medium">Save</span>
                </button>
              </div>

              {/* Divider */}
              <div className="mt-3 border-t border-yt-border" />
            </div>
          )}

          {/* Sticky filter chips + Up Next list (mobile) */}
          {related.length > 0 && (
            <div
              className="lg:hidden"
              style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 2rem)' }}
            >
              {/* Filter chips — sticky within the scroll container */}
              <div className="sticky top-0 z-10 bg-yt-bg/95 backdrop-blur-sm overflow-x-auto scrollbar-hide flex gap-2 px-4 py-2.5" style={{ scrollbarWidth: 'none' }}>
                <button
                  onClick={() => setRelatedFilter('all')}
                  className={`flex-shrink-0 px-3 py-1 rounded-full text-sm font-medium transition-colors whitespace-nowrap ${relatedFilter === 'all' ? 'bg-yt-text text-yt-bg' : 'bg-yt-card text-yt-text'}`}
                >
                  All
                </button>
                {videoMeta?.channel_id && (
                  <button
                    onClick={() => setRelatedFilter(videoMeta.channel_id)}
                    className={`flex-shrink-0 px-3 py-1 rounded-full text-sm font-medium transition-colors whitespace-nowrap ${relatedFilter === videoMeta.channel_id ? 'bg-yt-text text-yt-bg' : 'bg-yt-card text-yt-text'}`}
                  >
                    From {videoMeta.channel_name}
                  </button>
                )}
              </div>

              {/* Video list */}
              {related
                .filter(v => relatedFilter === 'all' || v.channel_id === relatedFilter)
                .slice(0, 8)
                .map(video => (
                  <VideoCard key={video.video_id} video={video} disablePreview />
                ))
              }
            </div>
          )}

          </div>{/* end scroll container */}
        </div>

        {/* Up Next — iPad/desktop sidebar (hidden in fullscreen) */}
        {!fullscreen && related.length > 0 && (
          <div className="hidden lg:flex lg:flex-col lg:w-[32%] lg:flex-shrink-0 lg:overflow-y-auto lg:px-4 lg:py-4">
            <h2 className="text-yt-muted text-xs font-semibold uppercase tracking-wider mb-3">Up Next</h2>
            <div className="space-y-4">
              {related.map(video => (
                <VideoCard key={video.video_id} video={video} stacked />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
