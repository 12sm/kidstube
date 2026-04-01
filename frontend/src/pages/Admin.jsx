import React, { useState, useEffect, useRef } from 'react';
import { Routes, Route, useNavigate, Link } from 'react-router-dom';

// Simple admin auth — JWT stored in cookie by backend, checked here
function useAdminAuth() {
  const [authed, setAuthed] = useState(false);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    fetch('/api/admin/me', { credentials: 'include' })
      .then(r => {
        setAuthed(r.ok);
        setChecking(false);
      })
      .catch(() => {
        setAuthed(false);
        setChecking(false);
      });
  }, []);

  return { authed, setAuthed, checking };
}

function AdminLogin({ onLogin }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ password })
      });
      if (res.ok) {
        onLogin();
      } else {
        setError('Incorrect password');
      }
    } catch {
      setError('Connection error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-yt-bg flex items-center justify-center p-6">
      <div className="bg-yt-surface rounded-xl p-8 w-full max-w-sm border border-yt-border">
        <h1 className="text-xl font-semibold text-yt-text mb-6">YouTube Admin</h1>
        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            type="password"
            placeholder="Admin password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            className="w-full bg-yt-card border border-yt-border rounded-lg px-4 py-2 text-yt-text focus:outline-none focus:border-blue-500"
          />
          {error && <p className="text-red-400 text-sm">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white rounded-lg px-4 py-2 font-medium disabled:opacity-50"
          >
            {loading ? 'Logging in...' : 'Log In'}
          </button>
        </form>
      </div>
    </div>
  );
}

function ChannelRecommendations({ profileId, profileName }) {
  const [recs, setRecs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(null);

  async function loadRecs() {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/channel-recommendations/${profileId}`, { credentials: 'include' });
      const data = await res.json();
      setRecs(Array.isArray(data) ? data : []);
    } catch {
      setRecs([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadRecs(); }, [profileId]);

  async function handleApply(channelId) {
    setActing(channelId);
    await fetch(`/api/admin/channel-recommendations/${profileId}/${channelId}/apply`, { method: 'POST', credentials: 'include' });
    await loadRecs();
    setActing(null);
  }

  async function handleDismiss(channelId) {
    setActing(channelId);
    await fetch(`/api/admin/channel-recommendations/${profileId}/${channelId}/dismiss`, { method: 'POST', credentials: 'include' });
    await loadRecs();
    setActing(null);
  }

  if (loading) return <p className="text-yt-muted text-sm">Loading recommendations...</p>;
  if (recs.length === 0) return (
    <p className="text-yt-muted text-sm">
      No pending channel recommendations for {profileName}. Run <code className="bg-yt-card px-1 rounded text-xs">node backend/scripts/audit-channels.js</code> to generate them.
    </p>
  );

  const toEnable  = recs.filter(r => r.recommendation === 'enable');
  const toDisable = recs.filter(r => r.recommendation === 'disable');

  function RecCard({ rec }) {
    const isActing = acting === rec.channel_id;
    const badgeClass = rec.recommendation === 'enable'
      ? 'bg-green-900/40 text-green-400 border border-green-700'
      : 'bg-red-900/40 text-red-400 border border-red-700';

    return (
      <div className="flex items-start gap-3 p-3 rounded-lg bg-yt-card border border-yt-border">
        {rec.thumbnail_url && (
          <img src={rec.thumbnail_url} alt="" className="w-10 h-10 rounded-full flex-shrink-0 object-cover" />
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-yt-text font-medium text-sm">{rec.channel_name || rec.channel_id}</span>
            <span className="text-yt-muted text-xs">{rec.whitelisted ? 'currently enabled' : 'currently disabled'}</span>
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${badgeClass}`}>
              {rec.recommendation}
            </span>
          </div>
          <p className="text-yt-muted text-xs mt-1">{rec.reason}</p>
        </div>
        <div className="flex gap-2 flex-shrink-0">
          <button
            onClick={() => handleApply(rec.channel_id)}
            disabled={isActing}
            className="text-xs px-3 py-1 rounded bg-yt-red text-white hover:bg-red-600 disabled:opacity-50"
          >
            Apply
          </button>
          <button
            onClick={() => handleDismiss(rec.channel_id)}
            disabled={isActing}
            className="text-xs px-3 py-1 rounded bg-yt-surface text-yt-muted hover:text-yt-text border border-yt-border disabled:opacity-50"
          >
            Dismiss
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {toEnable.length > 0 && (
        <div>
          <h4 className="text-sm font-medium text-green-400 mb-2">Suggested to enable ({toEnable.length})</h4>
          <div className="space-y-2">
            {toEnable.map(r => <RecCard key={r.channel_id} rec={r} />)}
          </div>
        </div>
      )}
      {toDisable.length > 0 && (
        <div>
          <h4 className="text-sm font-medium text-red-400 mb-2">Suggested to disable ({toDisable.length})</h4>
          <div className="space-y-2">
            {toDisable.map(r => <RecCard key={r.channel_id} rec={r} />)}
          </div>
        </div>
      )}
    </div>
  );
}

function AdminDashboard() {
  const [stats, setStats] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [msg, setMsg] = useState('');
  const [profiles, setProfiles] = useState([]);

  useEffect(() => {
    fetch('/api/admin/stats', { credentials: 'include' })
      .then(r => r.json())
      .then(data => setStats(data))
      .catch(() => {});

    fetch('/api/profiles')
      .then(r => r.json())
      .then(d => setProfiles(d.profiles || []))
      .catch(() => {});
  }, []);

  const triggerRefresh = async () => {
    setRefreshing(true);
    setMsg('');
    try {
      const res = await fetch('/api/admin/refresh', { method: 'POST', credentials: 'include' });
      const data = await res.json();
      setMsg(data.message || 'Refresh triggered');
    } catch {
      setMsg('Error triggering refresh');
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-yt-text">Dashboard</h2>
        <button
          onClick={triggerRefresh}
          disabled={refreshing}
          className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50"
        >
          {refreshing ? 'Running...' : 'Manual Refresh'}
        </button>
      </div>

      {msg && <div className="bg-yt-card border border-yt-border rounded-lg p-3 text-sm text-yt-text">{msg}</div>}

      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            { label: 'Last Run', value: stats.last_run ? new Date(stats.last_run).toLocaleString() : 'Never' },
            { label: 'Approved', value: stats.last_approved ?? '—' },
            { label: 'Rejected', value: stats.last_rejected ?? '—' },
            { label: 'Total Videos', value: stats.total_videos ?? '—' }
          ].map(({ label, value }) => (
            <div key={label} className="bg-yt-surface border border-yt-border rounded-xl p-4">
              <div className="text-yt-muted text-xs mb-1">{label}</div>
              <div className="text-yt-text font-semibold">{value}</div>
            </div>
          ))}
        </div>
      )}

      {/* Child Profiles */}
      <section className="mt-8">
        <h2 className="text-yt-text font-semibold text-base mb-4">Child Profiles</h2>
        <div className="space-y-6">
          {profiles.map(profile => (
            <div key={profile.id}>
              <p className="text-yt-muted text-xs uppercase tracking-wider mb-2">{profile.name}</p>
              <ChildProfileSection profile={profile} />
            </div>
          ))}
        </div>
      </section>

      {/* Channel Recommendations */}
      <section>
        <h2 className="text-lg font-semibold text-yt-text mb-4">Channel Recommendations</h2>
        <div className="space-y-6">
          {profiles.map(p => (
            <div key={p.id} className="bg-yt-surface rounded-xl p-4">
              <h3 className="text-yt-text font-medium mb-3">{p.name}</h3>
              <ChannelRecommendations profileId={p.id} profileName={p.name} />
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function FilterLog() {
  const [log, setLog] = useState([]);

  useEffect(() => {
    fetch('/api/admin/filter-log?limit=50', { credentials: 'include' })
      .then(r => r.json())
      .then(data => setLog(data.videos || []))
      .catch(() => {});
  }, []);

  const override = async (videoId, action) => {
    await fetch(`/api/admin/override/${videoId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ action })
    });
    setLog(prev => prev.filter(v => v.video_id !== videoId));
  };

  return (
    <div className="p-6">
      <h2 className="text-xl font-semibold text-yt-text mb-4">Filter Log</h2>
      <div className="space-y-3">
        {log.length === 0 && <p className="text-yt-muted text-sm">No rejected videos.</p>}
        {log.map(video => (
          <div key={video.video_id} className="bg-yt-surface border border-yt-border rounded-xl p-4 flex gap-4">
            {video.thumbnail_url && (
              <img src={video.thumbnail_url} alt={video.title} className="w-24 rounded-lg flex-shrink-0 object-cover" />
            )}
            <div className="flex-1 min-w-0">
              <p className="text-yt-text text-sm font-medium line-clamp-2">{video.title}</p>
              <p className="text-red-400 text-xs mt-1">{video.rejection_reason}</p>
              <div className="flex gap-2 mt-2">
                <button
                  onClick={() => override(video.video_id, 'approve')}
                  className="text-xs bg-green-700 hover:bg-green-600 text-white px-3 py-1 rounded"
                >
                  Approve
                </button>
                <button
                  onClick={() => override(video.video_id, 'reject')}
                  className="text-xs bg-red-800 hover:bg-red-700 text-white px-3 py-1 rounded"
                >
                  Keep Rejected
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function FilterRules() {
  const [rules, setRules] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [newKeyword, setNewKeyword] = useState('');
  const [scope, setScope] = useState('all');
  const [ruleProfileId, setRuleProfileId] = useState('');

  const load = () => {
    fetch('/api/admin/rules', { credentials: 'include' })
      .then(r => r.json())
      .then(data => setRules(data.rules || []))
      .catch(() => {});
  };

  useEffect(() => {
    load();
    fetch('/api/profiles')
      .then(r => r.json())
      .then(data => setProfiles(data.profiles || []))
      .catch(() => {});
  }, []);

  const profileName = (id) => profiles.find(p => p.id === id)?.name || `Profile ${id}`;

  const addRule = async (e) => {
    e.preventDefault();
    if (!newKeyword.trim()) return;
    await fetch('/api/admin/rules', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        rule_type: 'keyword_block',
        value: newKeyword.trim(),
        scope,
        profile_id: ruleProfileId ? parseInt(ruleProfileId) : null
      })
    });
    setNewKeyword('');
    load();
  };

  const deleteRule = async (id) => {
    await fetch(`/api/admin/rules/${id}`, { method: 'DELETE', credentials: 'include' });
    load();
  };

  return (
    <div className="p-6">
      <h2 className="text-xl font-semibold text-yt-text mb-4">Filter Rules</h2>
      <form onSubmit={addRule} className="flex flex-wrap gap-2 mb-6">
        <input
          type="text"
          placeholder="Keyword to block..."
          value={newKeyword}
          onChange={e => setNewKeyword(e.target.value)}
          className="flex-1 min-w-40 bg-yt-card border border-yt-border rounded-lg px-4 py-2 text-yt-text focus:outline-none focus:border-blue-500 text-sm"
        />
        <select
          value={scope}
          onChange={e => setScope(e.target.value)}
          className="bg-yt-card border border-yt-border rounded-lg px-3 py-2 text-yt-text text-sm"
        >
          <option value="all">All fields</option>
          <option value="title">Title only</option>
          <option value="description">Description</option>
          <option value="transcript">Transcript</option>
        </select>
        <select
          value={ruleProfileId}
          onChange={e => setRuleProfileId(e.target.value)}
          className="bg-yt-card border border-yt-border rounded-lg px-3 py-2 text-yt-text text-sm"
        >
          <option value="">All profiles</option>
          {profiles.map(p => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
        <button type="submit" className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm">
          Add
        </button>
      </form>

      <div className="space-y-2">
        {rules.length === 0 && <p className="text-yt-muted text-sm">No rules configured.</p>}
        {rules.map(rule => (
          <div key={rule.id} className="bg-yt-surface border border-yt-border rounded-lg px-4 py-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 flex-wrap min-w-0">
              <span className="text-yt-text text-sm font-medium">{rule.value}</span>
              <span className="text-yt-muted text-xs">({rule.scope})</span>
              {rule.profile_id
                ? <span className="text-xs bg-blue-600/20 text-blue-400 px-2 py-0.5 rounded-full">{profileName(rule.profile_id)}</span>
                : <span className="text-xs bg-yt-card text-yt-muted px-2 py-0.5 rounded-full">All profiles</span>
              }
            </div>
            <button onClick={() => deleteRule(rule.id)} className="text-red-400 hover:text-red-300 text-sm flex-shrink-0">
              Remove
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

const getSnippet = (token) =>
  `(function(){var token='${token}';var els=document.querySelectorAll('ytd-channel-renderer'),ch=[];els.forEach(function(el){var a=el.querySelector('a#main-link')||el.querySelector('a[href*="/@"]')||el.querySelector('a[href*="/channel/"]'),name=(el.querySelector('#channel-title')||el.querySelector('yt-formatted-string#channel-title')||{textContent:''}).textContent.trim(),img=el.querySelector('#avatar img,img#img');if(!a||!name)return;var href=a.href,cid=(href.match(/\\/channel\\/(UC[A-Za-z0-9_-]+)/)||[])[1]||'',handle=(href.match(/\\/@([A-Za-z0-9_.-]+)/)||[])[1]||'';ch.push({channel_name:name,channel_id:cid,handle:handle?'@'+handle:'',thumbnail_url:img?img.src:''});});console.log('KidsTube: found '+ch.length+' channels, posting...');fetch('http://localhost:3000/api/admin/channels/receive-import',{method:'POST',mode:'no-cors',headers:{'Content-Type':'text/plain'},body:JSON.stringify({token:token,channels:ch})}).then(function(){console.log('KidsTube: sent! Check the admin tab — it will update automatically.');}).catch(function(e){console.error('KidsTube error:',e.message);});})();`;

const formatCount = (n) => {
  if (!n) return null;
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 1_000) return Math.round(n / 1_000) + 'K';
  return String(n);
};

const ytUrl = (ch) =>
  ch.custom_url
    ? `https://www.youtube.com/${ch.custom_url}`
    : `https://www.youtube.com/channel/${ch.channel_id}`;

function ChannelManager() {
  const [profiles, setProfiles] = useState([]);
  const [selectedProfileId, setSelectedProfileId] = useState(null);
  const [channels, setChannels] = useState([]);
  const [addUrl, setAddUrl] = useState('');
  const [addStatus, setAddStatus] = useState('');
  const [enriching, setEnriching] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importToken, setImportToken] = useState('');
  const [importState, setImportState] = useState('idle'); // idle | loading | ready | processing | done | error
  const [importResult, setImportResult] = useState(null);
  const pollRef = useRef(null);

  useEffect(() => {
    fetch('/api/profiles')
      .then(r => r.json())
      .then(data => {
        const profs = data.profiles || [];
        setProfiles(profs);
        if (profs.length > 0) setSelectedProfileId(profs[0].id);
      })
      .catch(() => {});
  }, []);

  const loadChannels = (profileId) => {
    if (!profileId) return;
    fetch(`/api/admin/channels/${profileId}`, { credentials: 'include' })
      .then(r => r.json())
      .then(data => setChannels(data.channels || []))
      .catch(() => {});
  };

  useEffect(() => { loadChannels(selectedProfileId); }, [selectedProfileId]);

  const addChannel = async (e) => {
    e.preventDefault();
    if (!addUrl.trim()) return;
    setAddStatus('Looking up channel...');
    try {
      const res = await fetch('/api/admin/channels/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ url: addUrl.trim(), profileId: selectedProfileId })
      });
      const data = await res.json();
      if (res.ok) {
        setAddStatus(`Added "${data.channel.channel_name}"`);
        setAddUrl('');
        loadChannels(selectedProfileId);
      } else {
        setAddStatus(`Error: ${data.error}`);
      }
    } catch {
      setAddStatus('Connection error');
    }
  };

  const fetchDetails = async () => {
    setEnriching(true);
    try {
      await fetch(`/api/admin/channels/enrich/${selectedProfileId}`, {
        method: 'POST',
        credentials: 'include'
      });
      loadChannels(selectedProfileId);
    } catch {}
    setEnriching(false);
  };

  const toggle = async (channelId, current) => {
    await fetch(`/api/admin/channels/${channelId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ whitelisted: !current, profileId: selectedProfileId })
    });
    loadChannels(selectedProfileId);
  };

  // Start an import session when the section opens
  useEffect(() => {
    if (!importOpen) {
      clearInterval(pollRef.current);
      setImportToken('');
      setImportState('idle');
      setImportResult(null);
      return;
    }
    setImportState('loading');
    fetch('/api/admin/channels/start-import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ profileId: selectedProfileId })
    })
      .then(r => r.json())
      .then(data => { setImportToken(data.token); setImportState('ready'); })
      .catch(() => setImportState('error'));
  }, [importOpen, selectedProfileId]);

  // Poll for import status once we have a token
  useEffect(() => {
    if (!importToken || importState === 'idle' || importState === 'done' || importState === 'error') return;
    clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/admin/channels/import-status/${importToken}`, { credentials: 'include' });
        const data = await res.json();
        if (data.status === 'processing') setImportState('processing');
        if (data.status === 'done') {
          clearInterval(pollRef.current);
          setImportResult(data.result);
          setImportState('done');
          loadChannels(selectedProfileId);
        }
      } catch {}
    }, 2000);
    return () => clearInterval(pollRef.current);
  }, [importToken]);

  const selectedProfile = profiles.find(p => p.id === selectedProfileId);

  return (
    <div className="p-6 space-y-5">
      {/* Header + profile tabs */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-xl font-semibold text-yt-text">Channel Manager</h2>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex gap-1">
            {profiles.map(p => (
              <button
                key={p.id}
                onClick={() => setSelectedProfileId(p.id)}
                className={`px-3 py-1 rounded-full text-sm font-medium transition-colors ${
                  selectedProfileId === p.id
                    ? 'bg-blue-600 text-white'
                    : 'bg-yt-card text-yt-muted hover:text-yt-text'
                }`}
              >
                {p.name}
              </button>
            ))}
          </div>
          <button
            onClick={fetchDetails}
            disabled={enriching || !selectedProfileId}
            className="px-3 py-1 rounded-full text-sm font-medium bg-yt-card text-yt-muted hover:text-yt-text disabled:opacity-50 transition-colors"
          >
            {enriching ? 'Fetching...' : 'Fetch Details'}
          </button>
        </div>
      </div>

      {/* Add channel by URL */}
      <form onSubmit={addChannel} className="flex gap-2">
        <input
          type="text"
          placeholder="YouTube URL or @handle — e.g. https://youtube.com/@veritasium"
          value={addUrl}
          onChange={e => { setAddUrl(e.target.value); setAddStatus(''); }}
          className="flex-1 bg-yt-card border border-yt-border rounded-lg px-4 py-2 text-yt-text focus:outline-none focus:border-blue-500 text-sm"
        />
        <button type="submit" className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm whitespace-nowrap">
          Add Channel
        </button>
      </form>
      {addStatus && <p className="text-sm text-yt-muted -mt-2">{addStatus}</p>}

      {/* Browser import */}
      <div className="border border-yt-border rounded-xl overflow-hidden">
        <button
          onClick={() => setImportOpen(!importOpen)}
          className="w-full flex items-center justify-between px-4 py-3 bg-yt-surface text-sm font-medium text-yt-text hover:bg-yt-card transition-colors"
        >
          <span>Import subscriptions from browser</span>
          <span className="text-yt-muted text-xs">{importOpen ? '▲' : '▼'}</span>
        </button>

        {importOpen && (
          <div className="p-4 space-y-3 bg-yt-card border-t border-yt-border">
            {importState === 'loading' && (
              <p className="text-yt-muted text-sm">Generating import token...</p>
            )}

            {(importState === 'ready' || importState === 'processing') && importToken && (
              <>
                <ol className="text-yt-muted text-sm space-y-1 list-decimal list-inside">
                  <li>Log into YouTube as <span className="text-yt-text">{selectedProfile?.name || 'your child'}</span> in your browser</li>
                  <li>Go to <span className="text-blue-400">youtube.com/feed/channels</span> and scroll to the bottom</li>
                  <li>Open DevTools (F12 or Cmd+Option+J) → Console tab</li>
                  <li>Paste the code below and press Enter — it sends the data directly here</li>
                </ol>
                <div className="relative">
                  <pre className="bg-yt-bg text-xs text-green-400 p-3 rounded-lg overflow-x-auto whitespace-pre-wrap break-all font-mono leading-relaxed">{getSnippet(importToken)}</pre>
                  <button
                    onClick={() => navigator.clipboard.writeText(getSnippet(importToken)).catch(() => {})}
                    className="absolute top-2 right-2 bg-yt-surface hover:bg-yt-border text-yt-muted hover:text-yt-text text-xs px-2 py-1 rounded transition-colors"
                  >
                    Copy
                  </button>
                </div>
                {importState === 'processing'
                  ? <p className="text-blue-400 text-sm">Received — importing channels in background...</p>
                  : <p className="text-yt-muted text-sm">Waiting for snippet to run... (this page will update automatically)</p>
                }
              </>
            )}

            {importState === 'done' && importResult && (
              <div className="space-y-2">
                <p className="text-green-400 text-sm font-medium">
                  Import complete — {importResult.imported} channels added{importResult.failed > 0 ? `, ${importResult.failed} skipped` : ''}.
                </p>
                <button
                  onClick={() => { setImportOpen(false); }}
                  className="bg-yt-surface hover:bg-yt-border text-yt-muted text-sm px-3 py-1 rounded-lg"
                >
                  Close
                </button>
              </div>
            )}

            {importState === 'error' && (
              <p className="text-red-400 text-sm">Failed to start import session. Check that you're logged in to admin.</p>
            )}
          </div>
        )}
      </div>

      {/* Channel list */}
      <div className="space-y-2">
        {channels.length === 0 && (
          <p className="text-yt-muted text-sm">No channels yet. Add one above or import from the browser.</p>
        )}
        {channels.map(ch => (
          <div key={ch.channel_id} className="bg-yt-surface border border-yt-border rounded-lg px-4 py-3 flex items-start gap-3">
            {ch.thumbnail_url
              ? <img src={ch.thumbnail_url} alt={ch.channel_name} className="w-9 h-9 rounded-full flex-shrink-0 mt-0.5" />
              : <div className="w-9 h-9 rounded-full bg-yt-card flex-shrink-0 mt-0.5" />
            }
            <div className="flex-1 min-w-0">
              <a
                href={ytUrl(ch)}
                target="_blank"
                rel="noreferrer"
                className="text-yt-text text-sm font-medium hover:text-blue-400 transition-colors"
              >
                {ch.channel_name}
              </a>
              {(ch.custom_url || ch.subscriber_count) && (
                <div className="flex items-center gap-2 mt-0.5">
                  {ch.custom_url && (
                    <span className="text-yt-muted text-xs">{ch.custom_url}</span>
                  )}
                  {ch.subscriber_count && (
                    <span className="text-yt-muted text-xs">{formatCount(ch.subscriber_count)} subscribers</span>
                  )}
                </div>
              )}
              {ch.description && (
                <p className="text-yt-muted text-xs mt-1 line-clamp-2 leading-relaxed">{ch.description}</p>
              )}
            </div>
            <button
              onClick={() => toggle(ch.channel_id, ch.whitelisted)}
              className={`flex-shrink-0 text-xs px-3 py-1 rounded-full font-medium transition-colors mt-0.5 ${
                ch.whitelisted
                  ? 'bg-green-700 text-white hover:bg-red-800'
                  : 'bg-yt-card text-yt-muted hover:bg-green-700 hover:text-white'
              }`}
            >
              {ch.whitelisted ? 'Enabled' : 'Disabled'}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function ProfileSetup() {
  const [profiles, setProfiles] = useState([]);
  const [newName, setNewName] = useState('');

  const load = () => {
    fetch('/api/profiles')
      .then(r => r.json())
      .then(data => setProfiles(data.profiles || []))
      .catch(() => {});
  };

  useEffect(() => { load(); }, []);

  const createProfile = async (e) => {
    e.preventDefault();
    if (!newName.trim()) return;
    await fetch('/api/admin/profiles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ name: newName.trim() })
    });
    setNewName('');
    load();
  };

  const disconnect = async (id) => {
    await fetch(`/api/admin/profiles/${id}/disconnect`, { method: 'POST', credentials: 'include' });
    load();
  };

  return (
    <div className="p-6">
      <h2 className="text-xl font-semibold text-yt-text mb-4">Profiles</h2>
      <form onSubmit={createProfile} className="flex gap-2 mb-6">
        <input
          type="text"
          placeholder="Child's name..."
          value={newName}
          onChange={e => setNewName(e.target.value)}
          className="flex-1 bg-yt-card border border-yt-border rounded-lg px-4 py-2 text-yt-text focus:outline-none focus:border-blue-500 text-sm"
        />
        <button type="submit" className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm">
          Add Profile
        </button>
      </form>

      <div className="space-y-3">
        {profiles.map(profile => (
          <div key={profile.id} className="bg-yt-surface border border-yt-border rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-yt-text font-medium">{profile.name}</span>
              <span className={`text-xs px-2 py-1 rounded-full ${profile.google_connected ? 'bg-green-700 text-white' : 'bg-yt-card text-yt-muted'}`}>
                {profile.google_connected ? 'Connected' : 'Not connected'}
              </span>
            </div>
            <div className="flex gap-2">
              {!profile.google_connected ? (
                <a
                  href={`/auth/google/${profile.id}`}
                  className="text-sm bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg inline-block"
                >
                  Connect YouTube Account
                </a>
              ) : (
                <button
                  onClick={() => disconnect(profile.id)}
                  className="text-sm bg-yt-card hover:bg-red-900 border border-yt-border hover:border-red-700 text-yt-muted hover:text-red-300 px-4 py-2 rounded-lg"
                >
                  Disconnect
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

const INTERVIEW_QUESTIONS = [
  { key: 'ageGrade',  label: 'How old is {name} and what grade are they in?',  placeholder: 'e.g. 8 years old, 3rd grade' },
  { key: 'loves',     label: 'What topics or subjects does {name} love?',       placeholder: 'e.g. Minecraft, outer space, cooking, animals' },
  { key: 'avoid',     label: 'What topics or content should we avoid?',          placeholder: 'e.g. violence, scary content, adult humor' },
  { key: 'tone',      label: 'How would you describe acceptable tone?',          placeholder: 'e.g. silly humor is fine, no yelling or trash talk' },
  { key: 'other',     label: 'Anything else we should know about {name}?',       placeholder: 'Optional — leave blank to skip' },
];

function ChildProfileSetup({ profile, onComplete }) {
  const [step, setStep]       = useState(0);
  const [answers, setAnswers] = useState({});
  const [loading, setLoading] = useState(false);

  const question = INTERVIEW_QUESTIONS[step];
  const label    = question.label.replace(/{name}/g, profile.name);

  const handleNext = async () => {
    if (step < INTERVIEW_QUESTIONS.length - 1) {
      setStep(s => s + 1);
      return;
    }
    // Final step — generate profile
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/child-profile/${profile.id}/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profileName: profile.name, answers }),
      });
      const data = await res.json();
      if (data.ok) onComplete(data.markdown);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-yt-card rounded-xl p-5 space-y-4">
      <p className="text-yt-muted text-xs uppercase tracking-wider">
        Setting up {profile.name}'s profile — {step + 1} of {INTERVIEW_QUESTIONS.length}
      </p>
      <p className="text-yt-text font-medium">{label}</p>
      <textarea
        className="w-full bg-yt-surface border border-yt-border rounded-lg px-3 py-2 text-yt-text text-sm resize-none focus:outline-none focus:border-yt-muted"
        rows={3}
        placeholder={question.placeholder}
        value={answers[question.key] || ''}
        onChange={e => setAnswers(a => ({ ...a, [question.key]: e.target.value }))}
      />
      <button
        onClick={handleNext}
        disabled={loading || (!answers[question.key] && question.key !== 'other')}
        className="px-4 py-2 bg-yt-red text-white rounded-lg text-sm font-medium disabled:opacity-50"
      >
        {loading ? 'Generating…' : step < INTERVIEW_QUESTIONS.length - 1 ? 'Next →' : 'Generate Profile'}
      </button>
    </div>
  );
}

function ChildProfileSection({ profile }) {
  const [profileData, setProfileData] = useState(null);
  const [editing, setEditing]         = useState(false);
  const [draft, setDraft]             = useState('');
  const [saving, setSaving]           = useState(false);
  const [insights, setInsights]       = useState([]);
  const [consolidating, setConsolidating] = useState(false);

  useEffect(() => {
    fetch(`/api/admin/child-profile/${profile.id}`)
      .then(r => r.json())
      .then(d => {
        setProfileData(d.profile);
        if (d.profile) setDraft(d.profile.markdown);
      })
      .catch(() => {});

    fetch(`/api/admin/insights/${profile.id}?days=7`)
      .then(r => r.json())
      .then(d => setInsights(d.insights || []))
      .catch(() => {});
  }, [profile.id]);

  const handleSave = async () => {
    setSaving(true);
    await fetch(`/api/admin/child-profile/${profile.id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ markdown: draft }),
    }).catch(() => {});
    setProfileData(p => ({ ...p, markdown: draft, updated_by: 'parent', updated_at: new Date().toISOString() }));
    setEditing(false);
    setSaving(false);
  };

  const handleConsolidate = async () => {
    setConsolidating(true);
    await fetch('/api/admin/consolidation/run', { method: 'POST' }).catch(() => {});
    // Refresh profile and insights after consolidation
    const [pd, ins] = await Promise.all([
      fetch(`/api/admin/child-profile/${profile.id}`).then(r => r.json()).catch(() => ({})),
      fetch(`/api/admin/insights/${profile.id}?days=7`).then(r => r.json()).catch(() => ({})),
    ]);
    if (pd?.profile) { setProfileData(pd.profile); setDraft(pd.profile.markdown); }
    if (ins?.insights) setInsights(ins.insights);
    setConsolidating(false);
  };

  if (!profileData) {
    return (
      <ChildProfileSetup
        profile={profile}
        onComplete={(markdown) => setProfileData({ markdown, updated_by: 'parent', updated_at: new Date().toISOString() })}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="bg-yt-card rounded-xl p-5">
        <div className="flex items-center justify-between mb-3">
          <p className="text-yt-text font-medium text-sm">{profile.name}'s Profile</p>
          <span className="text-yt-muted text-xs">
            Updated {new Date(profileData.updated_at).toLocaleDateString()} by {profileData.updated_by}
          </span>
        </div>
        {editing ? (
          <>
            <textarea
              className="w-full bg-yt-surface border border-yt-border rounded-lg px-3 py-2 text-yt-text text-sm resize-none focus:outline-none focus:border-yt-muted"
              rows={6}
              value={draft}
              onChange={e => setDraft(e.target.value)}
            />
            <div className="flex gap-2 mt-2">
              <button onClick={handleSave} disabled={saving} className="px-4 py-1.5 bg-yt-red text-white rounded-lg text-sm disabled:opacity-50">
                {saving ? 'Saving…' : 'Save'}
              </button>
              <button onClick={() => { setEditing(false); setDraft(profileData.markdown); }} className="px-4 py-1.5 bg-yt-card border border-yt-border text-yt-text rounded-lg text-sm">
                Cancel
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="text-yt-muted text-sm leading-relaxed">{profileData.markdown}</p>
            <button onClick={() => setEditing(true)} className="mt-3 px-4 py-1.5 bg-yt-card border border-yt-border text-yt-text rounded-lg text-sm">
              Edit
            </button>
          </>
        )}
      </div>

      {insights.length > 0 && (
        <div className="bg-yt-card rounded-xl p-5">
          <p className="text-yt-muted text-xs uppercase tracking-wider mb-3">Recent Observations (7 days)</p>
          <ul className="space-y-1">
            {insights.map(i => (
              <li key={i.id} className="text-yt-text text-sm">
                <span className="text-yt-muted text-xs mr-2">
                  {new Date(i.created_at).toLocaleDateString()}
                </span>
                {i.insight}
              </li>
            ))}
          </ul>
        </div>
      )}

      <button
        onClick={handleConsolidate}
        disabled={consolidating}
        className="px-4 py-1.5 bg-yt-card border border-yt-border text-yt-muted rounded-lg text-sm"
      >
        {consolidating ? 'Running…' : 'Run consolidation now'}
      </button>
    </div>
  );
}

export default function Admin() {
  const { authed, setAuthed, checking } = useAdminAuth();
  const navigate = useNavigate();

  if (checking) {
    return <div className="min-h-screen bg-yt-bg flex items-center justify-center text-yt-muted">Loading...</div>;
  }

  if (!authed) {
    return <AdminLogin onLogin={() => setAuthed(true)} />;
  }

  const navItems = [
    { path: '/admin', label: 'Dashboard', exact: true },
    { path: '/admin/profiles', label: 'Profiles' },
    { path: '/admin/channels', label: 'Channels' },
    { path: '/admin/rules', label: 'Filter Rules' },
    { path: '/admin/log', label: 'Filter Log' }
  ];

  return (
    <div className="min-h-screen bg-yt-bg">
      {/* Admin nav */}
      <div className="bg-yt-surface border-b border-yt-border px-4 py-3 flex gap-4 overflow-x-auto scrollbar-hide">
        <span className="text-yt-text font-semibold text-sm mr-2 flex-shrink-0">YouTube Admin</span>
        {navItems.map(item => (
          <Link
            key={item.path}
            to={item.path}
            className="text-yt-muted hover:text-yt-text text-sm flex-shrink-0 whitespace-nowrap"
          >
            {item.label}
          </Link>
        ))}
      </div>

      {/* Admin sub-routes */}
      <Routes>
        <Route index element={<AdminDashboard />} />
        <Route path="profiles" element={<ProfileSetup />} />
        <Route path="channels" element={<ChannelManager />} />
        <Route path="rules" element={<FilterRules />} />
        <Route path="log" element={<FilterLog />} />
      </Routes>
    </div>
  );
}
