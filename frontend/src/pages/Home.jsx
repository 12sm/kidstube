import React, { useContext, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ProfileContext } from '../App.jsx';
import VideoCard from '../components/VideoCard.jsx';
import BottomNav from '../components/BottomNav.jsx';
import { SkeletonCard } from '../components/SkeletonCard.jsx';

const AVATAR_COLORS = ['#e05252', '#4e9de0', '#50c878', '#e0a035', '#9b59b6', '#e07c4e'];

const CATEGORIES = [
  { id: 'all',      label: 'All' },
  { id: 'gaming',   label: 'Gaming',   keywords: ['minecraft', 'roblox', 'game', 'gaming', 'fortnite', 'among us', 'play'] },
  { id: 'learning', label: 'Learning', keywords: ['learn', 'science', 'math', 'education', 'facts', 'how to', 'school', 'educational', 'experiment', 'discovery', 'why', 'what is'] },
  { id: 'music',    label: 'Music',    keywords: ['music', 'song', 'sing', 'dance', 'nursery', 'rhyme', 'lyrics'] },
  { id: 'animals',  label: 'Animals',  keywords: ['animal', 'pets', 'cat', 'dog', 'wildlife', 'nature', 'dinosaur', 'fish', 'bird', 'zoo', 'puppy', 'kitten'] },
  { id: 'cartoons', label: 'Cartoons', keywords: ['cartoon', 'animation', 'animated', 'bluey', 'peppa', 'paw patrol', 'episode', 'series'] },
];

function videoMatchesCategory(video, categoryId) {
  if (categoryId === 'all') return true;
  const cat = CATEGORIES.find(c => c.id === categoryId);
  if (!cat?.keywords) return false;
  const haystack = `${video.title || ''} ${video.channel_name || ''}`.toLowerCase();
  return cat.keywords.some(kw => haystack.includes(kw));
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function interleaveRecommended(videos) {
  const regular     = videos.filter(v => !v.is_recommended);
  const recommended = videos.filter(v => v.is_recommended);
  if (!recommended.length) return regular;
  const result = [];
  let ri = 0;
  for (let i = 0; i < regular.length; i++) {
    result.push(regular[i]);
    if ((i + 1) % 3 === 0 && ri < recommended.length) result.push(recommended[ri++]);
  }
  while (ri < recommended.length) result.push(recommended[ri++]);
  return result;
}

export default function Home() {
  const { profileId, profileName, clearProfile } = useContext(ProfileContext);
  const navigate = useNavigate();
  const [videos, setVideos]                 = useState([]);
  const [hasMore, setHasMore]               = useState(true);
  const [loading, setLoading]               = useState(false);
  const [initialLoad, setInitialLoad]       = useState(true);
  const [activeCategory, setActiveCategory] = useState('all');
  const [watchHistoryMap, setWatchHistoryMap] = useState({});
  const [pullY, setPullY]                   = useState(0);
  const [refreshing, setRefreshing]         = useState(false);
  const seenIdsRef     = useRef(new Set());  // tracks all video_ids shown this session
  const pullStartY     = useRef(0);
  const isPulling      = useRef(false);
  const refreshingRef  = useRef(false);   // readable inside passive:false listeners
  const pullYRef       = useRef(0);       // ditto
  const loaderRef      = useRef(null);

  useEffect(() => {
    if (!profileId) navigate('/', { replace: true });
  }, [profileId, navigate]);

  useEffect(() => {
    if (!profileId || videos.length === 0) return;
    fetch(`/api/watch-history/${profileId}?limit=200`)
      .then(r => r.json())
      .then(data => {
        const map = {};
        for (const h of (data.history || [])) map[h.video_id] = h;
        setWatchHistoryMap(map);
      })
      .catch(() => {});
  }, [profileId, videos.length]);

  const loadFeed = React.useCallback(async () => {
    if (loading || !hasMore || !profileId) return;
    setLoading(true);
    try {
      const seenParam = [...seenIdsRef.current].join(',');
      const url = `/api/feed/${profileId}?limit=18${seenParam ? `&seen=${seenParam}` : ''}`;
      const res = await fetch(url);
      const data = await res.json();
      const newVideos = shuffle(data.videos || []);
      newVideos.forEach(v => seenIdsRef.current.add(v.video_id));
      setVideos(prev => [...prev, ...newVideos]);
      setHasMore(newVideos.length === 18);
    } catch {
      setHasMore(false);
    } finally {
      setLoading(false);
      setInitialLoad(false);
    }
  }, [profileId, loading, hasMore]);

  useEffect(() => {
    if (profileId) loadFeed();
  }, [profileId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => { if (entries[0].isIntersecting && hasMore && !loading) loadFeed(); },
      { threshold: 0.1 }
    );
    if (loaderRef.current) observer.observe(loaderRef.current);
    return () => observer.disconnect();
  }, [loadFeed, hasMore, loading]);

  // Cross-platform haptic: vibrate API on Android, silent AudioContext click on iOS
  const haptic = (style = 'light') => {
    if (navigator.vibrate) { navigator.vibrate(style === 'medium' ? [10, 40, 10] : 8); return; }
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      gain.gain.setValueAtTime(0.0001, ctx.currentTime);
      osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.01);
      setTimeout(() => ctx.close(), 100);
    } catch { /* ignore */ }
  };

  const selectCategory = (id) => { haptic(); setActiveCategory(id); };

  const doRefresh = React.useCallback(async () => {
    if (refreshingRef.current) return;
    refreshingRef.current = true;
    setRefreshing(true);
    haptic('medium');
    seenIdsRef.current = new Set();
    setVideos([]); setHasMore(true); setInitialLoad(true);
    try {
      const res = await fetch(`/api/feed/${profileId}?limit=18`);
      const data = await res.json();
      const newVideos = shuffle(data.videos || []);
      newVideos.forEach(v => seenIdsRef.current.add(v.video_id));
      setVideos(newVideos); setHasMore(newVideos.length === 18);
    } catch { /* ignore */ }
    setInitialLoad(false);
    setRefreshing(false);
    refreshingRef.current = false;
  }, [profileId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Pull-to-refresh — must use document listeners with passive:false so iOS
  // doesn't swallow the touch before we can call preventDefault()
  useEffect(() => {
    const onStart = (e) => {
      if (e.target.closest('[data-mini-player]')) return;
      if (window.scrollY === 0 && !refreshingRef.current) {
        pullStartY.current = e.touches[0].clientY;
        isPulling.current  = true;
      }
    };
    const onMove = (e) => {
      if (!isPulling.current) return;
      const dy = e.touches[0].clientY - pullStartY.current;
      if (dy > 0 && window.scrollY === 0) {
        e.preventDefault();                          // stops iOS overscroll bounce
        const next = Math.min(dy * 0.4, 72);
        pullYRef.current = next;
        setPullY(next);
      } else {
        isPulling.current = false;
        pullYRef.current  = 0;
        setPullY(0);
      }
    };
    const onEnd = () => {
      if (!isPulling.current) return;
      isPulling.current = false;
      if (pullYRef.current >= 56) doRefresh();
      pullYRef.current = 0;
      setPullY(0);
    };
    document.addEventListener('touchstart', onStart, { passive: true });
    document.addEventListener('touchmove',  onMove,  { passive: false });
    document.addEventListener('touchend',   onEnd,   { passive: true });
    return () => {
      document.removeEventListener('touchstart', onStart);
      document.removeEventListener('touchmove',  onMove);
      document.removeEventListener('touchend',   onEnd);
    };
  }, [doRefresh]);

  if (!profileId) return null;

  const avatarColor = AVATAR_COLORS[(parseInt(profileId) - 1) % AVATAR_COLORS.length];
  const allVideos   = interleaveRecommended(videos);

  const displayVideos = allVideos.filter(v => videoMatchesCategory(v, activeCategory));

  return (
    <div className="min-h-screen bg-yt-bg pb-20">
      {/* Pull-to-refresh indicator */}
      {(pullY > 0 || refreshing) && (
        <div className="flex items-center justify-center overflow-hidden transition-all" style={{ height: refreshing ? 48 : pullY }}>
          <svg viewBox="0 0 24 24" className={`w-6 h-6 fill-yt-muted ${refreshing ? 'animate-spin' : ''}`}
            style={{ transform: refreshing ? undefined : `rotate(${Math.min(pullY / 56, 1) * 360}deg)` }}>
            <path d="M17.65 6.35A7.958 7.958 0 0012 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/>
          </svg>
        </div>
      )}

      {/* ── Sticky header ── */}
      <div className="sticky top-0 z-10 bg-yt-bg/95 backdrop-blur-sm" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
        {/* Top bar */}
        <div className="px-4 py-2.5 lg:py-3 flex items-center justify-between">
          {/* Logo */}
          <div className="flex items-center">
            <svg viewBox="0 0 28 20" className="h-5 lg:h-6 w-auto" xmlns="http://www.w3.org/2000/svg">
              <path fill="#FF0000" d="M27.97 3.45s-.27-1.9-1.1-2.74C25.82.61 24.64.61 24.1.54 20.17-.02 14 0 14 0S7.83-.02 3.9.54C3.36.61 2.18.61 1.13 1.71.3 2.55.03 4.45.03 4.45S-.24 6.65-.24 8.85v2.05c0 2.2.27 4.4.27 4.4s.27 1.9 1.1 2.74c1.05 1.1 2.43 1.07 3.04 1.18C6.17 19.4 14 19.5 14 19.5s6.17-.1 10.1-.63c.54-.07 1.72-.07 2.77-1.17.83-.84 1.1-2.74 1.1-2.74s.27-2.2.27-4.4V7.85c0-2.2-.27-4.4-.27-4.4zM11.12 13.5V5.88l7.46 3.82-7.46 3.8z"/>
            </svg>
            <span className="ml-1.5 text-yt-text font-bold text-sm lg:text-base tracking-tight">YouTube</span>
          </div>

          {/* Right actions */}
          <div className="flex items-center gap-3">
            <button onClick={() => navigate('/search')} className="text-yt-muted hover:text-yt-text transition-colors" aria-label="Search">
              <svg viewBox="0 0 24 24" className="w-6 h-6 lg:w-7 lg:h-7 fill-current"><path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/></svg>
            </button>
            <button onClick={() => { clearProfile(); navigate('/'); }} title={`Switch profile (${profileName})`}>
              <div
                className="w-8 h-8 lg:w-9 lg:h-9 rounded-full flex items-center justify-center text-white text-sm lg:text-base font-bold ring-2 ring-transparent hover:ring-white/30 transition-all"
                style={{ backgroundColor: avatarColor }}
              >
                {profileName?.charAt(0)?.toUpperCase() || '?'}
              </div>
            </button>
          </div>
        </div>

        {/* Category filter chips */}
        <div className="overflow-x-auto scrollbar-hide flex gap-2 px-3 pb-2.5">
          {CATEGORIES.map(cat => (
            <button
              key={cat.id}
              onClick={() => selectCategory(cat.id)}
              className={`flex-shrink-0 px-3 py-1 lg:px-4 lg:py-1.5 rounded-full text-sm font-medium transition-colors whitespace-nowrap ${
                activeCategory === cat.id
                  ? 'bg-yt-text text-yt-bg'
                  : 'bg-yt-card text-yt-text hover:bg-yt-hover'
              }`}
            >
              {cat.label}
            </button>
          ))}
        </div>

      </div>

      {/* Video grid */}
      <div className="pt-2 pb-4">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 md:gap-x-4 lg:gap-4 md:px-4 md:pt-2">
          {initialLoad && Array.from({ length: 8 }).map((_, i) => <SkeletonCard key={`sk-${i}`} />)}
          {!initialLoad && displayVideos.map((video) => (
            <VideoCard
              key={video.video_id}
              video={video}
              watchProgress={watchHistoryMap[video.video_id] || null}
              onRemoved={(videoId) => setVideos(prev => prev.filter(v => v.video_id !== videoId))}
            />
          ))}
        </div>

        <div ref={loaderRef} className="py-6 text-center text-yt-muted text-sm">
          {!initialLoad && loading && activeCategory === 'all' && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 md:gap-x-4 lg:gap-4 md:px-4">
              {Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={`sk-more-${i}`} />)}
            </div>
          )}
          {!loading && displayVideos.length === 0 && !initialLoad && (
            activeCategory !== 'all'
              ? `No ${CATEGORIES.find(c => c.id === activeCategory)?.label} videos in your feed yet`
              : 'No videos yet — enable some channels and run a sync.'
          )}
          {!loading && activeCategory === 'all' && !hasMore && videos.length > 0 && "You're all caught up"}
        </div>
      </div>

      <BottomNav />
    </div>
  );
}
