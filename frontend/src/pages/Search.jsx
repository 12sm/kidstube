import React, { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ProfileContext } from '../App.jsx';
import VideoCard from '../components/VideoCard.jsx';
import BottomNav from '../components/BottomNav.jsx';

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
// Always show mic button — getUserMedia may not be detectable on HTTP/iOS,
// but we handle errors gracefully when tapped
const hasMic = true;

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
  const [interimText, setInterimText] = useState('');
  const [voiceOverlay, setVoiceOverlay] = useState(false);

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

  const doSearch = async (q, rawSpeech = null) => {
    const trimmed = q.trim();
    if (!trimmed) return;
    setQuery(trimmed);
    setSubmitted(trimmed);
    setSuggestions([]);
    setLoading(true);
    setResults([]);
    inputRef.current?.blur();
    try {
      let url = `/api/search?q=${encodeURIComponent(trimmed)}&profile_id=${profileId}`;
      if (rawSpeech) url += `&raw_speech=${encodeURIComponent(rawSpeech)}`;
      const res = await fetch(url);
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
  // Uses SpeechRecognition (live interim text) when available (Chrome/desktop),
  // falls back to MediaRecorder + Whisper (iOS Safari).
  const mediaRef = useRef(null);
  const chunksRef = useRef([]);
  const recognitionRef2 = useRef(null);
  const [transcribing, setTranscribing] = useState(false);

  const processTranscript = async (transcript) => {
    setInterimText(transcript);
    setTranscribing(true);
    try {
      const iRes = await fetch('/api/search/voice-intent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: transcript }),
      });
      const iData = await iRes.json();
      const searchQuery = iData.query || transcript;
      setVoiceOverlay(false);
      setTranscribing(false);
      setQuery(searchQuery);
      doSearch(searchQuery, transcript);
    } catch {
      setVoiceOverlay(false);
      setTranscribing(false);
      doSearch(transcript);
    }
  };

  const startVoiceBrowser = () => {
    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = 'en-US';
    recognitionRef2.current = recognition;

    recognition.onstart = () => setListening(true);
    recognition.onend   = () => setListening(false);
    recognition.onerror = (e) => {
      setListening(false);
      setVoiceOverlay(false);
      setInterimText('');
      if (e.error !== 'aborted' && e.error !== 'no-speech') {
        setVoiceError(e.error === 'not-allowed' ? 'Microphone access denied' : 'Voice search failed');
        setTimeout(() => setVoiceError(''), 3000);
      }
    };
    recognition.onresult = (e) => {
      const result = e.results[0];
      const transcript = result[0].transcript;
      if (!result.isFinal) {
        setInterimText(transcript);
        return;
      }
      setListening(false);
      if (transcript.trim()) processTranscript(transcript.trim());
      else { setVoiceOverlay(false); }
    };
    recognition.start();
    setListening(true);
  };

  const startVoiceWhisper = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      chunksRef.current = [];
      mr.ondataavailable = (e) => chunksRef.current.push(e.data);
      mr.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        if (blob.size < 1000) {
          setVoiceOverlay(false);
          setListening(false);
          return;
        }
        setListening(false);
        setTranscribing(true);
        setInterimText('');
        try {
          const tRes = await fetch('/api/search/transcribe', {
            method: 'POST',
            headers: { 'Content-Type': 'audio/webm' },
            body: blob,
          });
          const tData = await tRes.json();
          const transcript = tData.text?.trim();
          if (!transcript) {
            setVoiceOverlay(false);
            setTranscribing(false);
            return;
          }
          await processTranscript(transcript);
        } catch {
          setVoiceOverlay(false);
          setTranscribing(false);
          setVoiceError('Voice search failed');
          setTimeout(() => setVoiceError(''), 3000);
        }
      };
      mr.start();
      mediaRef.current = mr;
      setListening(true);
    } catch {
      setVoiceOverlay(false);
      setVoiceError('Microphone access denied');
      setTimeout(() => setVoiceError(''), 3000);
    }
  };

  const startVoice = () => {
    if (!hasMic) return;
    if (listening) { stopVoice(); return; }

    setVoiceError('');
    setInterimText('');
    setVoiceOverlay(true);

    if (SpeechRecognition) {
      startVoiceBrowser();
    } else {
      startVoiceWhisper();
    }
  };

  const stopVoice = () => {
    if (recognitionRef2.current) {
      recognitionRef2.current.stop();
    }
    if (mediaRef.current?.state === 'recording') {
      mediaRef.current.stop();
    }
  };

  const cancelVoice = () => {
    if (recognitionRef2.current) {
      recognitionRef2.current.abort?.();
      recognitionRef2.current = null;
    }
    if (mediaRef.current?.state === 'recording') {
      mediaRef.current.ondataavailable = null;
      mediaRef.current.onstop = () => {};
      mediaRef.current.stop();
    }
    setVoiceOverlay(false);
    setListening(false);
    setTranscribing(false);
    setInterimText('');
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
          className="flex-1 flex items-center bg-yt-card border border-yt-border rounded-full px-4 py-2"
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
          {query && (
            <>
              <button
                type="button"
                onClick={clearSearch}
                className="text-yt-muted hover:text-yt-text flex-shrink-0 ml-2"
                aria-label="Clear"
              >
                <svg viewBox="0 0 24 24" className="w-4 h-4 fill-current">
                  <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
                </svg>
              </button>
              <button type="submit" className="text-yt-muted hover:text-yt-text flex-shrink-0 ml-2" aria-label="Search">
                <svg viewBox="0 0 24 24" className="w-5 h-5 fill-current">
                  <path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>
                </svg>
              </button>
            </>
          )}
        </form>

        {/* Mic button — always visible, outside the search bar like YouTube */}
        {hasMic && (
          <button
            type="button"
            onClick={startVoice}
            className="flex-shrink-0 p-2 text-yt-muted hover:text-yt-text transition-colors"
            aria-label="Voice search"
          >
            <svg viewBox="0 0 24 24" className="w-6 h-6 fill-current">
              <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.91-3c-.49 0-.9.36-.98.85C16.52 14.2 14.47 16 12 16s-4.52-1.8-4.93-4.15c-.08-.49-.49-.85-.98-.85-.61 0-1.09.54-1 1.14.49 3 2.89 5.35 5.91 5.78V20c0 .55.45 1 1 1s1-.45 1-1v-2.08c3.02-.43 5.42-2.78 5.91-5.78.1-.6-.39-1.14-1-1.14z"/>
            </svg>
          </button>
        )}
      </div>

      {/* Voice error toast */}
      {voiceError && (
        <div className="mx-4 mt-2 px-4 py-2 bg-red-900/60 text-red-200 text-sm rounded-lg text-center">
          {voiceError}
        </div>
      )}

      {/* ── Fullscreen voice search overlay ── */}
      {voiceOverlay && (
        <div className="fixed inset-0 z-50 bg-black flex flex-col">
          {/* Close button */}
          <div className="pt-[env(safe-area-inset-top)] px-4 pt-4">
            <button
              onClick={cancelVoice}
              className="text-white/70 p-2"
              aria-label="Cancel voice search"
            >
              <svg viewBox="0 0 24 24" className="w-6 h-6 fill-current">
                <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
              </svg>
            </button>
          </div>

          {/* Transcript / status text */}
          <div className="flex-1 flex flex-col justify-between px-8">
            <div className="pt-16">
              <p className="text-2xl text-white/40 min-h-[4rem]">
                {transcribing
                  ? (interimText || 'Processing...')
                  : listening
                    ? 'Speak now'
                    : 'Speak now'}
              </p>
            </div>

            {/* Mic button and hint */}
            <div className="flex flex-col items-center pb-24">
              {!transcribing && (
                <>
                  <p className="text-white/30 text-sm mb-2">Try saying</p>
                  <p className="text-white/50 text-sm italic mb-8">"Play some music"</p>
                </>
              )}
              {transcribing && (
                <div className="mb-8 flex items-center gap-3">
                  <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  <p className="text-white/50 text-sm">Searching...</p>
                </div>
              )}

              {/* Animated mic button */}
              <div className="relative">
                {/* Outer pulse ring — only while recording */}
                {listening && (
                  <div className="absolute inset-0 -m-4 rounded-full bg-white/10 animate-ping" style={{ animationDuration: '2s' }} />
                )}
                {/* Outer ring */}
                <div className="w-28 h-28 rounded-full bg-[#333] flex items-center justify-center">
                  {/* Middle ring */}
                  <div className="w-20 h-20 rounded-full bg-[#555] flex items-center justify-center">
                    {/* Red mic / stop button */}
                    <button
                      onClick={listening ? stopVoice : cancelVoice}
                      disabled={transcribing}
                      className={`w-16 h-16 rounded-full flex items-center justify-center transition-transform active:scale-95 ${transcribing ? 'bg-gray-600' : 'bg-red-600'}`}
                    >
                      {listening ? (
                        /* Stop icon while recording */
                        <svg viewBox="0 0 24 24" className="w-7 h-7 fill-white">
                          <rect x="6" y="6" width="12" height="12" rx="2"/>
                        </svg>
                      ) : (
                        <svg viewBox="0 0 24 24" className="w-7 h-7 fill-white">
                          <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.91-3c-.49 0-.9.36-.98.85C16.52 14.2 14.47 16 12 16s-4.52-1.8-4.93-4.15c-.08-.49-.49-.85-.98-.85-.61 0-1.09.54-1 1.14.49 3 2.89 5.35 5.91 5.78V20c0 .55.45 1 1 1s1-.45 1-1v-2.08c3.02-.43 5.42-2.78 5.91-5.78.1-.6-.39-1.14-1-1.14z"/>
                        </svg>
                      )}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
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
        {showSuggestionArea && !voiceOverlay && (
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
