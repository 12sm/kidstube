import React, { useContext, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ProfileContext } from '../App.jsx';
import VideoCard from '../components/VideoCard.jsx';
import BottomNav from '../components/BottomNav.jsx';

export default function Search() {
  const { profileId } = useContext(ProfileContext);
  const navigate = useNavigate();
  const inputRef = useRef(null);

  const [query, setQuery]         = useState('');
  const [submitted, setSubmitted] = useState('');
  const [history, setHistory]     = useState([]);
  const [results, setResults]     = useState([]);
  const [loading, setLoading]     = useState(false);

  // Redirect if no profile
  useEffect(() => {
    if (!profileId) navigate('/', { replace: true });
  }, [profileId, navigate]);

  // Auto-focus input on mount
  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 50);
  }, []);

  // Load search history on mount
  useEffect(() => {
    if (!profileId) return;
    fetch(`/api/search/history?profile_id=${profileId}`)
      .then(r => r.json())
      .then(data => setHistory(data.history || []))
      .catch(() => {});
  }, [profileId]);

  const doSearch = async (q) => {
    const trimmed = q.trim();
    if (!trimmed) return;
    setQuery(trimmed);
    setSubmitted(trimmed);
    setLoading(true);
    setResults([]);
    inputRef.current?.blur();
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(trimmed)}&profile_id=${profileId}`);
      const data = await res.json();
      setResults(data.results || []);
      // Refresh history (query was saved server-side)
      fetch(`/api/search/history?profile_id=${profileId}`)
        .then(r => r.json())
        .then(data => setHistory(data.history || []))
        .catch(() => {});
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  };

  const deleteHistory = (e, q) => {
    e.stopPropagation();
    fetch(`/api/search/history/${profileId}/${encodeURIComponent(q)}`, { method: 'DELETE' }).catch(() => {});
    setHistory(prev => prev.filter(h => h !== q));
  };

  const fillQuery = (e, q) => {
    e.stopPropagation();
    setQuery(q);
    setSubmitted('');
    setResults([]);
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  return (
    <div className="min-h-screen bg-yt-bg text-yt-text">
      {/* Header */}
      <div
        className="sticky top-0 z-10 bg-yt-bg/95 backdrop-blur-sm px-3 py-2.5 flex items-center gap-2"
        style={{ paddingTop: 'env(safe-area-inset-top)' }}
      >
        <button
          onClick={() => navigate(-1)}
          className="text-yt-muted hover:text-yt-text transition-colors flex-shrink-0 p-1"
          aria-label="Back"
        >
          <svg viewBox="0 0 24 24" className="w-6 h-6 fill-current">
            <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/>
          </svg>
        </button>

        <form
          className="flex-1 flex items-center gap-2 bg-yt-card border border-yt-border rounded-full px-4 py-2"
          onSubmit={e => { e.preventDefault(); doSearch(query); }}
        >
          <input
            ref={inputRef}
            type="search"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search YouTube"
            className="flex-1 bg-transparent text-yt-text placeholder-yt-muted text-sm outline-none"
          />
          {query && (
            <button
              type="button"
              onClick={() => { setQuery(''); setSubmitted(''); setResults([]); inputRef.current?.focus(); }}
              className="text-yt-muted hover:text-yt-text flex-shrink-0"
            >
              <svg viewBox="0 0 24 24" className="w-4 h-4 fill-current">
                <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
              </svg>
            </button>
          )}
          <button type="submit" className="text-yt-muted hover:text-yt-text flex-shrink-0">
            <svg viewBox="0 0 24 24" className="w-5 h-5 fill-current">
              <path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>
            </svg>
          </button>
        </form>
      </div>

      {/* Body */}
      <div className="pb-24">
        {/* Loading */}
        {loading && (
          <div className="flex justify-center items-center py-16">
            <div className="w-8 h-8 border-2 border-yt-border border-t-white rounded-full animate-spin" />
          </div>
        )}

        {/* Results */}
        {!loading && submitted && results.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-0">
            {results.map(video => (
              <VideoCard key={video.video_id} video={video} />
            ))}
          </div>
        )}

        {/* Empty results */}
        {!loading && submitted && results.length === 0 && (
          <div className="text-center text-yt-muted py-16 px-8">
            <p className="text-lg">No results for "{submitted}"</p>
            <p className="text-sm mt-2">Try different keywords or check your spelling</p>
          </div>
        )}

        {/* History (shown when no submitted search) */}
        {!submitted && !loading && history.length > 0 && (
          <div className="px-2 pt-2">
            {history.map(q => (
              <div
                key={q}
                className="flex items-center gap-3 px-3 py-3 rounded-lg hover:bg-yt-card cursor-pointer"
                onClick={() => doSearch(q)}
              >
                {/* Clock icon */}
                <svg viewBox="0 0 24 24" className="w-5 h-5 fill-current text-yt-muted flex-shrink-0">
                  <path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67V7z"/>
                </svg>
                <span className="flex-1 text-sm text-yt-text truncate">{q}</span>
                {/* Fill-query arrow (north-west diagonal) */}
                <button
                  onClick={e => fillQuery(e, q)}
                  className="text-yt-muted hover:text-yt-text flex-shrink-0 p-1"
                  aria-label="Fill search"
                >
                  <svg viewBox="0 0 24 24" className="w-4 h-4 fill-current" style={{ transform: 'rotate(-45deg)' }}>
                    <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/>
                  </svg>
                </button>
                {/* Delete */}
                <button
                  onClick={e => deleteHistory(e, q)}
                  className="text-yt-muted hover:text-yt-text flex-shrink-0 p-1"
                  aria-label="Remove from history"
                >
                  <svg viewBox="0 0 24 24" className="w-4 h-4 fill-current">
                    <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
                  </svg>
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Empty history */}
        {!submitted && !loading && history.length === 0 && (
          <div className="text-center text-yt-muted py-16">
            <p className="text-sm">Search for videos</p>
          </div>
        )}
      </div>

      <BottomNav />
    </div>
  );
}
