import React, { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ProfileContext } from '../App.jsx';
import VideoCard from '../components/VideoCard.jsx';
import BottomNav from '../components/BottomNav.jsx';

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

export default function Search() {
  const { profileId } = useContext(ProfileContext);
  const navigate = useNavigate();
  const inputRef = useRef(null);
  const recognitionRef = useRef(null);
  const suggestDebounce = useRef(null);

  const [query, setQuery]           = useState('');
  const [submitted, setSubmitted]   = useState('');
  const [history, setHistory]       = useState([]);
  const [suggestions, setSuggestions] = useState([]);  // { text, type }[]
  const [results, setResults]       = useState([]);
  const [loading, setLoading]       = useState(false);
  const [listening, setListening]   = useState(false);
  const [voiceError, setVoiceError] = useState('');

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
    setSuggestions([]);
    setLoading(true);
    setResults([]);
    inputRef.current?.blur();
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(trimmed)}&profile_id=${profileId}`);
      const data = await res.json();
      setResults(data.results || []);
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

  const handleQueryChange = useCallback((value) => {
    setQuery(value);
    setSubmitted('');
    setResults([]);

    clearTimeout(suggestDebounce.current);
    if (!value.trim()) {
      setSuggestions([]);
      return;
    }
    suggestDebounce.current = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/search/suggestions?q=${encodeURIComponent(value.trim())}&profile_id=${profileId}`
        );
        const data = await res.json();
        setSuggestions(data.suggestions || []);
      } catch {
        setSuggestions([]);
      }
    }, 200);
  }, [profileId]);

  const clearSearch = () => {
    setQuery('');
    setSubmitted('');
    setResults([]);
    setSuggestions([]);
    inputRef.current?.focus();
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
    setSuggestions([]);
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  // ── Voice search ─────────────────────────────────────────────────────────────

  const startVoice = () => {
    if (!SpeechRecognition) return;
    if (listening) {
      recognitionRef.current?.stop();
      return;
    }

    setVoiceError('');
    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = 'en-US';
    recognitionRef.current = recognition;

    recognition.onstart = () => setListening(true);
    recognition.onend   = () => setListening(false);
    recognition.onerror = (e) => {
      setListening(false);
      if (e.error !== 'aborted' && e.error !== 'no-speech') {
        setVoiceError(e.error === 'not-allowed' ? 'Microphone access denied' : 'Voice search failed');
        setTimeout(() => setVoiceError(''), 3000);
      }
    };
    recognition.onresult = (e) => {
      const transcript = e.results[0][0].transcript;
      setQuery(transcript);
      setSuggestions([]);
      doSearch(transcript);
    };

    recognition.start();
  };

  // Filtered history for the suggestion area
  const filteredHistory = query.trim()
    ? history.filter(h => h.toLowerCase().includes(query.toLowerCase()))
    : history;

  // Deduplicate suggestions against history items already shown
  const historySet = new Set(filteredHistory.map(h => h.toLowerCase()));
  const dedupedSuggestions = suggestions.filter(s => !historySet.has(s.text.toLowerCase()));

  const showSuggestionArea = !submitted && !loading;

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
            onChange={e => handleQueryChange(e.target.value)}
            placeholder="Search YouTube"
            className="flex-1 bg-transparent text-yt-text placeholder-yt-muted text-sm outline-none"
          />
          {query ? (
            <>
              <button
                type="button"
                onClick={clearSearch}
                className="text-yt-muted hover:text-yt-text flex-shrink-0"
                aria-label="Clear"
              >
                <svg viewBox="0 0 24 24" className="w-4 h-4 fill-current">
                  <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
                </svg>
              </button>
              <button type="submit" className="text-yt-muted hover:text-yt-text flex-shrink-0" aria-label="Search">
                <svg viewBox="0 0 24 24" className="w-5 h-5 fill-current">
                  <path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>
                </svg>
              </button>
            </>
          ) : SpeechRecognition ? (
            <button
              type="button"
              onClick={startVoice}
              className={`flex-shrink-0 transition-colors ${listening ? 'text-red-500' : 'text-yt-muted hover:text-yt-text'}`}
              aria-label={listening ? 'Stop listening' : 'Voice search'}
            >
              {listening ? (
                // Animated mic while recording
                <svg viewBox="0 0 24 24" className="w-5 h-5 fill-current animate-pulse">
                  <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.91-3c-.49 0-.9.36-.98.85C16.52 14.2 14.47 16 12 16s-4.52-1.8-4.93-4.15c-.08-.49-.49-.85-.98-.85-.61 0-1.09.54-1 1.14.49 3 2.89 5.35 5.91 5.78V20c0 .55.45 1 1 1s1-.45 1-1v-2.08c3.02-.43 5.42-2.78 5.91-5.78.1-.6-.39-1.14-1-1.14z"/>
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" className="w-5 h-5 fill-current">
                  <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.91-3c-.49 0-.9.36-.98.85C16.52 14.2 14.47 16 12 16s-4.52-1.8-4.93-4.15c-.08-.49-.49-.85-.98-.85-.61 0-1.09.54-1 1.14.49 3 2.89 5.35 5.91 5.78V20c0 .55.45 1 1 1s1-.45 1-1v-2.08c3.02-.43 5.42-2.78 5.91-5.78.1-.6-.39-1.14-1-1.14z"/>
                </svg>
              )}
            </button>
          ) : null}
        </form>
      </div>

      {/* Voice error toast */}
      {voiceError && (
        <div className="mx-4 mt-2 px-4 py-2 bg-red-900/60 text-red-200 text-sm rounded-lg text-center">
          {voiceError}
        </div>
      )}

      {/* Listening indicator */}
      {listening && (
        <div className="flex flex-col items-center py-12 gap-3">
          <div className="relative">
            <div className="w-16 h-16 rounded-full bg-red-600/20 flex items-center justify-center">
              <div className="absolute inset-0 rounded-full bg-red-600/20 animate-ping" />
              <svg viewBox="0 0 24 24" className="w-8 h-8 fill-current text-red-500 relative">
                <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.91-3c-.49 0-.9.36-.98.85C16.52 14.2 14.47 16 12 16s-4.52-1.8-4.93-4.15c-.08-.49-.49-.85-.98-.85-.61 0-1.09.54-1 1.14.49 3 2.89 5.35 5.91 5.78V20c0 .55.45 1 1 1s1-.45 1-1v-2.08c3.02-.43 5.42-2.78 5.91-5.78.1-.6-.39-1.14-1-1.14z"/>
              </svg>
            </div>
          </div>
          <p className="text-yt-muted text-sm">Listening...</p>
        </div>
      )}

      {/* Body */}
      <div className="pb-24">
        {/* Loading spinner */}
        {loading && (
          <div className="flex justify-center items-center py-16">
            <div className="w-8 h-8 border-2 border-yt-border border-t-white rounded-full animate-spin" />
          </div>
        )}

        {/* Results */}
        {!loading && submitted && results.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 sm:gap-4 sm:px-4 lg:px-4 lg:pt-2">
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

        {/* Suggestion / history area */}
        {showSuggestionArea && !listening && (
          <div className="px-2 pt-2">
            {/* Filtered history items */}
            {filteredHistory.map(q => (
              <div
                key={`h-${q}`}
                className="flex items-center gap-3 px-3 py-3 rounded-lg hover:bg-yt-card cursor-pointer"
                onClick={() => doSearch(q)}
              >
                <svg viewBox="0 0 24 24" className="w-5 h-5 fill-current text-yt-muted flex-shrink-0">
                  <path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67V7z"/>
                </svg>
                <span className="flex-1 text-sm text-yt-text truncate">{q}</span>
                <button
                  onClick={e => fillQuery(e, q)}
                  className="text-yt-muted hover:text-yt-text flex-shrink-0 p-1"
                  aria-label="Fill search"
                >
                  <svg viewBox="0 0 24 24" className="w-4 h-4 fill-current" style={{ transform: 'rotate(-45deg)' }}>
                    <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/>
                  </svg>
                </button>
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

            {/* DB suggestions (channels + video title matches) */}
            {dedupedSuggestions.map((s, i) => (
              <div
                key={`s-${i}`}
                className="flex items-center gap-3 px-3 py-3 rounded-lg hover:bg-yt-card cursor-pointer"
                onClick={() => doSearch(s.text)}
              >
                {s.type === 'channel' ? (
                  <svg viewBox="0 0 24 24" className="w-5 h-5 fill-current text-yt-muted flex-shrink-0">
                    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 14.5v-9l6 4.5-6 4.5z"/>
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24" className="w-5 h-5 fill-current text-yt-muted flex-shrink-0">
                    <path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>
                  </svg>
                )}
                <span className="flex-1 text-sm text-yt-text truncate">{s.text}</span>
                <button
                  onClick={e => { e.stopPropagation(); fillQuery(e, s.text); }}
                  className="text-yt-muted hover:text-yt-text flex-shrink-0 p-1"
                  aria-label="Fill search"
                >
                  <svg viewBox="0 0 24 24" className="w-4 h-4 fill-current" style={{ transform: 'rotate(-45deg)' }}>
                    <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/>
                  </svg>
                </button>
              </div>
            ))}

            {/* Empty state */}
            {filteredHistory.length === 0 && dedupedSuggestions.length === 0 && (
              <div className="text-center text-yt-muted py-16">
                <p className="text-sm">{query ? `No suggestions for "${query}"` : 'Search for videos'}</p>
              </div>
            )}
          </div>
        )}
      </div>

      <BottomNav />
    </div>
  );
}
