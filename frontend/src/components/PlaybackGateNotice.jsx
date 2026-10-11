import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { usePlayerContext } from '../contexts/PlayerContext.jsx';

function formatDuration(secs) {
  if (!secs) return null;
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// Shown on the watch page while a search-found video is being checked, and
// when it can't play: a friendly note (never why) plus one approved video to
// watch instead.
export default function PlaybackGateNotice() {
  const { gate, openVideo, dismissGate } = usePlayerContext();
  const location = useLocation();
  const navigate = useNavigate();

  if (!gate || location.pathname !== `/watch/${gate.videoId}`) return null;

  if (gate.status === 'checking') {
    return (
      <div className="pointer-events-none fixed left-1/2 top-1/4 z-40 -translate-x-1/2 rounded-full bg-black/70 p-4">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-white/30 border-t-white" />
      </div>
    );
  }

  const s = gate.suggestion;
  const playSuggestion = () => {
    dismissGate();
    openVideo(s.video_id);
    navigate(`/watch/${s.video_id}`, { replace: true });
  };
  const goHome = () => { dismissGate(); navigate('/home'); };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-yt-bg/95 px-6"
         style={{ paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}>
      <div className="w-full max-w-md text-center">
        <p className="text-2xl font-bold text-yt-text">{gate.notice}</p>

        {s ? (
          <>
            <p className="mt-2 text-base text-yt-muted">How about this one?</p>
            <button onClick={playSuggestion}
                    className="mt-5 block w-full overflow-hidden rounded-2xl bg-yt-card text-left shadow-lg active:scale-[0.98] transition-transform">
              <div className="relative aspect-video w-full bg-black">
                {s.thumbnail_url && <img src={s.thumbnail_url} alt="" className="h-full w-full object-cover" />}
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="flex h-16 w-16 items-center justify-center rounded-full bg-yt-red/90">
                    <svg viewBox="0 0 24 24" className="ml-1 h-8 w-8 fill-white"><path d="M8 5v14l11-7z" /></svg>
                  </div>
                </div>
                {formatDuration(s.duration_seconds) && (
                  <span className="absolute bottom-2 right-2 rounded bg-black/80 px-1.5 py-0.5 text-xs font-medium text-white">
                    {formatDuration(s.duration_seconds)}
                  </span>
                )}
              </div>
              <div className="px-4 py-3">
                <p className="line-clamp-2 text-base font-medium text-yt-text">{s.title}</p>
                {s.channel_name && <p className="mt-0.5 text-sm text-yt-muted">{s.channel_name}</p>}
              </div>
            </button>
          </>
        ) : null}

        <button onClick={goHome} className="mt-5 rounded-full bg-yt-hover px-6 py-3 text-base font-medium text-yt-text">
          {s ? 'Go home' : 'Find another video'}
        </button>
      </div>
    </div>
  );
}
