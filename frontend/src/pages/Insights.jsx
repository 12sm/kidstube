import { useState, useEffect, useRef, useCallback } from 'react';

// ── Analytics Section ────────────────────────────────────────────────────────

function WatchTimeByDay({ data }) {
  if (!data || data.length === 0) return null;
  const max = Math.max(...data.map(d => d.minutes), 1);

  return (
    <div className="bg-yt-card rounded-lg p-4 border border-yt-border">
      <h3 className="text-yt-text text-sm font-semibold mb-3">Watch Time by Day</h3>
      <div className="flex items-end gap-1 h-32">
        {data.map(d => (
          <div key={d.date} className="flex-1 flex flex-col items-center gap-1 min-w-0">
            <div
              className="w-full bg-blue-500 rounded-t min-h-[2px]"
              style={{ height: `${(d.minutes / max) * 100}%` }}
              title={`${d.date}: ${d.minutes} min`}
            />
            <span className="text-[9px] text-yt-muted truncate w-full text-center">
              {d.date.slice(5)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function WatchTimeByHour({ data }) {
  // Fill all 24 hours
  const hours = Array.from({ length: 24 }, (_, i) => {
    const found = data?.find(d => d.hour === i);
    return { hour: i, minutes: found?.minutes || 0 };
  });
  const max = Math.max(...hours.map(h => h.minutes), 1);

  return (
    <div className="bg-yt-card rounded-lg p-4 border border-yt-border">
      <h3 className="text-yt-text text-sm font-semibold mb-3">Watch Time by Hour</h3>
      <div className="grid grid-cols-12 gap-1">
        {hours.map(h => {
          const intensity = h.minutes / max;
          const bg = intensity === 0
            ? 'bg-yt-surface'
            : intensity < 0.33
              ? 'bg-blue-900'
              : intensity < 0.66
                ? 'bg-blue-700'
                : 'bg-blue-500';
          return (
            <div key={h.hour} className="flex flex-col items-center gap-0.5">
              <div
                className={`w-full aspect-square rounded ${bg}`}
                title={`${h.hour}:00 — ${h.minutes} min`}
              />
              {h.hour % 3 === 0 && (
                <span className="text-[9px] text-yt-muted">{h.hour}</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TopTags({ data }) {
  if (!data || data.length === 0) return null;
  const maxMin = Math.max(...data.map(d => d.totalMinutes), 1);

  return (
    <div className="bg-yt-card rounded-lg p-4 border border-yt-border">
      <h3 className="text-yt-text text-sm font-semibold mb-3">Top Tags</h3>
      <div className="space-y-2">
        {data.slice(0, 10).map(t => (
          <div key={t.tag} className="flex items-center gap-2">
            <span className="text-xs text-yt-text w-28 truncate flex-shrink-0">{t.tag}</span>
            <div className="flex-1 h-4 bg-yt-surface rounded overflow-hidden">
              <div
                className="h-full bg-blue-500 rounded"
                style={{ width: `${(t.totalMinutes / maxMin) * 100}%` }}
              />
            </div>
            <span className="text-[10px] text-yt-muted w-16 text-right flex-shrink-0">
              {t.watchCount} / {Math.round(t.totalMinutes)}m
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function TrendingTags({ data }) {
  if (!data || data.length === 0) return null;

  return (
    <div className="bg-yt-card rounded-lg p-4 border border-yt-border">
      <h3 className="text-yt-text text-sm font-semibold mb-3">Trending (7d vs prior 7d)</h3>
      <div className="flex flex-wrap gap-2">
        {data.map(t => {
          const isUp = t.trend >= 1.0;
          const isNew = t.priorCount === 0 && t.recentCount > 0;
          return (
            <span
              key={t.tag}
              className={`px-2 py-1 rounded-full text-xs border ${
                isNew
                  ? 'bg-green-900/30 border-green-700 text-green-400'
                  : isUp
                    ? 'bg-blue-900/30 border-blue-700 text-blue-400'
                    : 'bg-yt-surface border-yt-border text-yt-muted'
              }`}
            >
              {isNew ? '+ ' : isUp ? '\u2191 ' : '\u2193 '}
              {t.tag}
              <span className="ml-1 opacity-60">{t.recentCount}</span>
            </span>
          );
        })}
      </div>
    </div>
  );
}

function AnalyticsSection({ profileId }) {
  const [analytics, setAnalytics] = useState(null);
  const [days, setDays] = useState(30);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/admin/insights/${profileId}?days=${days}`, { credentials: 'include' })
      .then(r => r.json())
      .then(d => { setAnalytics(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [profileId, days]);

  if (loading) return <div className="text-yt-muted text-sm py-8 text-center">Loading analytics...</div>;
  if (!analytics) return null;

  return (
    <div className="space-y-4">
      {/* Summary row */}
      <div className="flex gap-3">
        <div className="flex-1 bg-yt-card rounded-lg p-3 border border-yt-border text-center">
          <div className="text-xl font-bold text-yt-text">{Math.round(analytics.totalWatchMinutes)}</div>
          <div className="text-[10px] text-yt-muted">minutes watched</div>
        </div>
        <div className="flex-1 bg-yt-card rounded-lg p-3 border border-yt-border text-center">
          <div className="text-xl font-bold text-yt-text">{analytics.totalVideosWatched}</div>
          <div className="text-[10px] text-yt-muted">videos watched</div>
        </div>
        <div className="flex-1 bg-yt-card rounded-lg p-3 border border-yt-border text-center">
          <select
            value={days}
            onChange={e => setDays(parseInt(e.target.value))}
            className="bg-yt-surface text-yt-text text-sm rounded px-1 py-0.5 border border-yt-border"
          >
            <option value={7}>7 days</option>
            <option value={14}>14 days</option>
            <option value={30}>30 days</option>
          </select>
        </div>
      </div>

      <WatchTimeByDay data={analytics.watchTimeByDay} />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <WatchTimeByHour data={analytics.watchTimeByHour} />
        <TopTags data={analytics.topTags} />
      </div>
      <TrendingTags data={analytics.trendingTags} />
    </div>
  );
}

// ── Feed Tuning Section ──────────────────────────────────────────────────────

function TagSlider({ tag, weight, multiplier, onChange, isModified }) {
  return (
    <div className="flex items-center gap-2 py-1.5">
      <span className={`text-xs w-32 truncate flex-shrink-0 ${isModified ? 'text-blue-400 font-semibold' : 'text-yt-text'}`}>
        {tag}
      </span>
      <span className="text-[10px] text-yt-muted w-10 text-right flex-shrink-0">
        {weight.toFixed(1)}
      </span>
      <input
        type="range"
        min="0"
        max="3"
        step="0.1"
        value={multiplier}
        onChange={e => onChange(tag, parseFloat(e.target.value))}
        className="flex-1 h-1 accent-blue-500"
      />
      <span className="text-[10px] text-yt-muted w-8 flex-shrink-0">
        {multiplier.toFixed(1)}x
      </span>
    </div>
  );
}

function FeedPreview({ videos, loading }) {
  if (loading) {
    return <div className="text-yt-muted text-sm py-8 text-center">Generating preview...</div>;
  }
  if (!videos || videos.length === 0) {
    return <div className="text-yt-muted text-sm py-8 text-center">No videos to preview</div>;
  }

  return (
    <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
      {videos.map((v, i) => (
        <div key={v.video_id} className="bg-yt-card rounded-lg overflow-hidden border border-yt-border">
          <div className="relative">
            <img
              src={v.thumbnail_url}
              alt={v.title}
              className="w-full aspect-video object-cover"
              loading="lazy"
            />
            <span className="absolute top-1 left-1 bg-black/70 text-white text-[10px] px-1 rounded">
              #{i + 1}
            </span>
          </div>
          <div className="p-2">
            <p className="text-xs text-yt-text line-clamp-2 leading-tight">{v.title}</p>
            <p className="text-[10px] text-yt-muted mt-0.5 truncate">{v.channel_name}</p>
            <div className="mt-1 flex flex-wrap gap-1">
              <span className="text-[9px] text-blue-400 bg-blue-900/30 px-1 rounded">
                score: {v.score}
              </span>
              <span className="text-[9px] text-green-400 bg-green-900/30 px-1 rounded">
                interest: {v.interestScore}
              </span>
            </div>
            {v.matchedTags.length > 0 && (
              <div className="mt-1 flex flex-wrap gap-0.5">
                {v.matchedTags.slice(0, 4).map(t => (
                  <span key={t} className="text-[9px] text-yt-muted bg-yt-surface px-1 rounded">{t}</span>
                ))}
                {v.matchedTags.length > 4 && (
                  <span className="text-[9px] text-yt-muted">+{v.matchedTags.length - 4}</span>
                )}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function FeedTuningSection({ profileId }) {
  const [interests, setInterests] = useState([]);
  const [settings, setSettings] = useState({});
  const [ceiling, setCeiling] = useState(10);
  const [sliders, setSliders] = useState({});          // tag → multiplier (draft)
  const [ceilingDraft, setCeilingDraft] = useState(10);
  const [previewVideos, setPreviewVideos] = useState([]);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const debounceRef = useRef(null);

  // Load current state
  useEffect(() => {
    Promise.all([
      fetch(`/api/admin/interests/${profileId}`, { credentials: 'include' }).then(r => r.json()),
      fetch(`/api/admin/tag-settings/${profileId}`, { credentials: 'include' }).then(r => r.json()),
    ]).then(([intData, setData]) => {
      const behaviorInterests = (intData.interests || []).filter(i => i.source === 'behavior');
      setInterests(behaviorInterests);

      const settingsMap = {};
      for (const s of setData.settings || []) settingsMap[s.tag] = s.multiplier;
      setSettings(settingsMap);

      // Init sliders from persisted settings
      const initial = {};
      for (const i of behaviorInterests) {
        initial[i.tag] = settingsMap[i.tag] ?? 1.0;
      }
      setSliders(initial);
      setCeiling(setData.ceiling);
      setCeilingDraft(setData.ceiling);
    }).catch(() => {});
  }, [profileId]);

  // Fetch preview
  const fetchPreview = useCallback((sliderState, ceilVal) => {
    setPreviewLoading(true);
    const overrides = {};
    for (const [tag, mult] of Object.entries(sliderState)) {
      overrides[tag] = { multiplier: mult };
    }
    fetch(`/api/admin/feed-preview/${profileId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ overrides, ceiling: ceilVal }),
    })
      .then(r => r.json())
      .then(d => { setPreviewVideos(d.videos || []); setPreviewLoading(false); })
      .catch(() => setPreviewLoading(false));
  }, [profileId]);

  // Initial preview load
  useEffect(() => {
    if (interests.length > 0) {
      fetchPreview(sliders, ceilingDraft);
    }
  }, [interests]); // eslint-disable-line react-hooks/exhaustive-deps

  // Debounced preview on slider change
  const handleSliderChange = (tag, value) => {
    const next = { ...sliders, [tag]: value };
    setSliders(next);
    setHasChanges(true);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchPreview(next, ceilingDraft), 300);
  };

  const handleCeilingChange = (value) => {
    setCeilingDraft(value);
    setHasChanges(true);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchPreview(sliders, value), 300);
  };

  // Save all changes
  const handleSave = async () => {
    setSaving(true);
    const promises = [];

    // Save tag settings
    for (const [tag, mult] of Object.entries(sliders)) {
      const persisted = settings[tag] ?? 1.0;
      if (Math.abs(mult - persisted) > 0.01) {
        promises.push(
          fetch(`/api/admin/tag-settings/${profileId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ tag, multiplier: mult }),
          })
        );
      }
    }

    // Save ceiling
    if (Math.abs(ceilingDraft - ceiling) > 0.01) {
      promises.push(
        fetch(`/api/admin/behavior-ceiling/${profileId}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ ceiling: ceilingDraft }),
        })
      );
    }

    await Promise.all(promises);

    // Update persisted state
    const newSettings = { ...settings };
    for (const [tag, mult] of Object.entries(sliders)) {
      newSettings[tag] = mult;
    }
    setSettings(newSettings);
    setCeiling(ceilingDraft);
    setHasChanges(false);
    setSaving(false);
  };

  // Reset to persisted
  const handleReset = () => {
    const reset = {};
    for (const i of interests) {
      reset[i.tag] = settings[i.tag] ?? 1.0;
    }
    setSliders(reset);
    setCeilingDraft(ceiling);
    setHasChanges(false);
    fetchPreview(reset, ceiling);
  };

  return (
    <div className="space-y-4">
      {/* Ceiling control */}
      <div className="bg-yt-card rounded-lg p-4 border border-yt-border">
        <div className="flex items-center gap-3">
          <span className="text-sm text-yt-text font-semibold">Behavior Ceiling</span>
          <input
            type="range"
            min="1"
            max="20"
            step="0.5"
            value={ceilingDraft}
            onChange={e => handleCeilingChange(parseFloat(e.target.value))}
            className="flex-1 h-1 accent-blue-500"
          />
          <span className="text-sm text-yt-muted w-8">{ceilingDraft}</span>
        </div>
        <p className="text-[10px] text-yt-muted mt-1">
          Maximum effective weight for any behavior tag. Lower = more even feed, higher = stronger personalization.
        </p>
      </div>

      {/* Tag sliders */}
      <div className="bg-yt-card rounded-lg p-4 border border-yt-border">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm text-yt-text font-semibold">Tag Weights</h3>
          <div className="flex gap-2">
            {hasChanges && (
              <>
                <button
                  onClick={handleReset}
                  className="px-3 py-1 text-xs bg-yt-surface text-yt-muted rounded border border-yt-border"
                >
                  Reset
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="px-3 py-1 text-xs bg-blue-600 text-white rounded"
                >
                  {saving ? 'Saving...' : 'Save'}
                </button>
              </>
            )}
          </div>
        </div>
        <div className="max-h-72 overflow-y-auto pr-1 space-y-0">
          {interests.map(i => (
            <TagSlider
              key={i.tag}
              tag={i.tag}
              weight={i.weight}
              multiplier={sliders[i.tag] ?? 1.0}
              onChange={handleSliderChange}
              isModified={Math.abs((sliders[i.tag] ?? 1.0) - (settings[i.tag] ?? 1.0)) > 0.01}
            />
          ))}
        </div>
      </div>

      {/* Feed preview */}
      <div>
        <h3 className="text-sm text-yt-text font-semibold mb-3">Feed Preview</h3>
        <FeedPreview videos={previewVideos} loading={previewLoading} />
      </div>
    </div>
  );
}

// ── Main Component ───────────────────────────────────────────────────────────

export default function Insights() {
  const [profiles, setProfiles] = useState([]);
  const [selectedProfile, setSelectedProfile] = useState(null);

  useEffect(() => {
    fetch('/api/profiles', { credentials: 'include' })
      .then(r => r.json())
      .then(d => {
        const list = d.profiles || d;
        setProfiles(list);
        if (list.length > 0) setSelectedProfile(list[0]);
      })
      .catch(() => {});
  }, []);

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 space-y-6">
      {/* Profile selector */}
      <div className="flex items-center gap-3">
        <h2 className="text-lg font-bold text-yt-text">Insights</h2>
        <div className="flex gap-2">
          {profiles.map(p => (
            <button
              key={p.id}
              onClick={() => setSelectedProfile(p)}
              className={`px-3 py-1 text-sm rounded-full border ${
                selectedProfile?.id === p.id
                  ? 'bg-white text-black border-white'
                  : 'bg-yt-surface text-yt-muted border-yt-border'
              }`}
            >
              {p.name}
            </button>
          ))}
        </div>
      </div>

      {selectedProfile && (
        <>
          <AnalyticsSection profileId={selectedProfile.id} />

          <div className="border-t border-yt-border pt-6">
            <h2 className="text-lg font-bold text-yt-text mb-4">Feed Tuning</h2>
            <FeedTuningSection profileId={selectedProfile.id} />
          </div>
        </>
      )}
    </div>
  );
}
