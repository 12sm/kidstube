require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');

const db = require('./db');
const auth = require('./auth');
const cron = require('./cron');
const { backfillChannel } = require('./cron');
const youtube = require('./youtube');
const filter = require('./filter');
const recommendations = require('./recommendations');
const { runDailyInsightsPass, runWeeklyConsolidationPass } = require('./insights');
const childProfile = require('./childProfile');
const { fetchVideoData } = require('./ytdlp');
const innertube = require('./innertube');
const dash = require('./dash');
const { spawn } = require('child_process');
const path       = require('path');
const jobDryRun  = require('./jobDryRun');


const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3001;

// Allow Chrome's Private Network Access (needed for snippets on HTTPS pages to reach localhost)
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Private-Network', 'true');
  next();
});

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(express.text({ type: 'text/plain', limit: '10mb' })); // for no-cors snippet posts
app.use(cookieParser());

// Initialize database on startup
db.migrate();

// Start cron scheduler
cron.scheduleJob();

// ── Jobs ─────────────────────────────────────────────────────────────────────

const DRY_RUN_FNS = {
  'nightly':         jobDryRun.dryRunNightly,
  'channel-audit':   jobDryRun.dryRunChannelAudit,
  'backfill-tag':    jobDryRun.dryRunBackfillTag,
  'backfill-reeval': jobDryRun.dryRunBackfillReeval,
};

const SCRIPT_MAP = {
  'nightly':         ['nightly.js'],
  'channel-audit':   ['audit-channels.js'],
  'backfill-tag':    ['backfill-llm.js', 'a'],
  'backfill-reeval': ['backfill-llm.js', 'b'],
};

let activeJobStream = null;

// ── Health ──────────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'KidsTube Backend', version: '1.0.0' });
});

// ── Admin Auth Middleware ────────────────────────────────────────────────────
function requireAdmin(req, res, next) {
  const token = req.cookies?.admin_token;
  if (!token) return res.status(401).json({ error: 'Not authenticated' });

  try {
    jwt.verify(token, process.env.JWT_SECRET || 'fallback_secret');
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired session' });
  }
}

// ── Auth Routes ──────────────────────────────────────────────────────────────
app.get('/auth/google/:profileId', (req, res) => {
  const profileId = parseInt(req.params.profileId);
  const profile = db.getProfile(profileId);
  if (!profile) return res.status(404).json({ error: 'Profile not found' });

  const authUrl = auth.getAuthUrl(profileId);
  res.redirect(authUrl);
});

app.get('/auth/callback', async (req, res) => {
  const { code, state, error } = req.query;

  if (error) {
    return res.redirect(`/admin/profiles?error=${encodeURIComponent(error)}`);
  }

  if (!code || !state) {
    return res.status(400).json({ error: 'Missing code or state' });
  }

  const profileId = parseInt(state);
  try {
    await auth.exchangeCodeForTokens(code, profileId);

    // Immediately sync subscriptions for this profile
    const profile = db.getProfile(profileId);
    if (profile) {
      try {
        await cron.syncSubscriptions(profile);
      } catch (err) {
        console.error('Subscription sync after OAuth failed:', err.message);
      }
    }

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    res.redirect(`${frontendUrl}/admin/profiles?connected=1`);
  } catch (err) {
    console.error('OAuth callback error:', err);
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    res.redirect(`${frontendUrl}/admin/profiles?error=${encodeURIComponent(err.message)}`);
  }
});

// ── Admin Login ──────────────────────────────────────────────────────────────
app.post('/api/admin/login', (req, res) => {
  const { password } = req.body;
  if (!password || password !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Incorrect password' });
  }

  const token = jwt.sign(
    { admin: true },
    process.env.JWT_SECRET || 'fallback_secret',
    { expiresIn: '24h' }
  );

  res.cookie('admin_token', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 24 * 60 * 60 * 1000
  });

  res.json({ ok: true });
});

app.get('/api/admin/me', requireAdmin, (req, res) => {
  res.json({ ok: true });
});

// ── Public API Routes ────────────────────────────────────────────────────────

// Get all profiles (used by profile selector page)
app.get('/api/profiles', (req, res) => {
  const profiles = db.getProfiles().map(p => ({
    id: p.id,
    name: p.name,
    google_connected: !!(p.google_refresh_token)
  }));
  res.json({ profiles });
});

// Get approved video feed for a profile
app.get('/api/feed/:profileId', (req, res) => {
  const profileId = parseInt(req.params.profileId);
  const page = parseInt(req.query.page) || 0;
  const limit = Math.min(parseInt(req.query.limit) || 20, 50);

  // Fetch a larger pool so the channel-diversity filter has enough to work with.
  // ORDER BY is random each call so page offset isn't meaningful — each call
  // returns a fresh random slice, which is fine for infinite-scroll on a 5k+ library.
  const raw = db.getApprovedFeed(profileId, 0, limit * 5);

  // Cap at 2 videos per channel per page so no single channel dominates
  const channelCount = new Map();
  const videos = [];
  for (const v of raw) {
    const n = channelCount.get(v.channel_id) || 0;
    if (n < 2) {
      videos.push(v);
      channelCount.set(v.channel_id, n + 1);
    }
    if (videos.length >= limit) break;
  }

  res.json({ videos, page, limit });
});

// Get approved videos for a specific channel
app.get('/api/channel/:channelId', (req, res) => {
  const { channelId } = req.params;
  const page = parseInt(req.query.page) || 0;
  const limit = Math.min(parseInt(req.query.limit) || 20, 50);

  const videos = db.getApprovedVideosByChannel(channelId, page, limit);

  // Get channel info from DB
  const channels = db.getAllChannels();
  const channel = channels.find(c => c.channel_id === channelId) || null;

  res.json({ videos, channel, page, limit });
});

// Get related/up-next videos for a video
app.get('/api/related/:videoId', (req, res) => {
  const { videoId } = req.params;
  const profileId = parseInt(req.query.profile_id);

  if (profileId) {
    const videos = recommendations.getRecommendedVideos(db, videoId, profileId);
    return res.json({ videos });
  }

  // Fallback: no profile context — use legacy related query
  const videos = db.getRelatedVideos(videoId);
  res.json({ videos });
});

// Get subscriptions/channels list for a profile
app.get('/api/subscriptions/:profileId', (req, res) => {
  const profileId = parseInt(req.params.profileId);
  const channels = db.getWhitelistedChannels(profileId);
  res.json({ channels });
});

// Get single video metadata
app.get('/api/video/:videoId', (req, res) => {
  const { videoId } = req.params;
  const video = db.getVideoById(videoId);
  if (!video) return res.status(404).json({ error: 'Video not found' });
  res.json({ video });
});

// Get a DASH manifest URL for a video (used by Roku channel)
app.get('/api/stream/:videoId', async (req, res) => {
  const { videoId } = req.params;
  console.log(`[stream] Request for ${videoId}`);
  if (!/^[a-zA-Z0-9_-]{6,15}$/.test(videoId)) return res.status(400).json({ error: 'Invalid video ID' });
  const wasCached = innertube.getCached(videoId) !== null;
  try {
    const t0 = Date.now();
    await innertube.getStreamInfo(videoId);
    console.log(`[stream] OK ${videoId} in ${Date.now() - t0}ms cached=${wasCached}`);
    const manifestUrl = `${req.protocol}://${req.headers.host}/api/manifest/${videoId}`;
    res.json({ url: manifestUrl, type: 'dash', cached: wasCached });
  } catch (err) {
    console.error(`[stream] Failed for ${videoId}:`, err.message);
    res.status(502).json({ error: 'Stream unavailable', detail: err.message });
  }
});

// Serve the DASH manifest for a video (Roku media player fetches this directly)
app.get('/api/manifest/:videoId', (req, res) => {
  const { videoId } = req.params;
  const cached = innertube.getCached(videoId);
  if (!cached) {
    return res.status(404).json({ error: 'Stream info not cached — call /api/stream first' });
  }
  try {
    const mpd = dash.buildManifest(cached.formats, cached.durationMs);
    res.set('Content-Type', 'application/dash+xml');
    res.send(mpd);
  } catch (err) {
    console.error(`[manifest] Build failed for ${videoId}:`, err.message);
    res.status(500).json({ error: 'Manifest generation failed', detail: err.message });
  }
});

// ── Watch History Routes ──────────────────────────────────────────────────────

// Record/update watch progress
app.post('/api/watch-history', (req, res) => {
  const { profile_id, video_id, progress_seconds, duration_seconds } = req.body;
  if (!profile_id || !video_id) return res.status(400).json({ error: 'Missing required fields' });

  const profileId    = parseInt(profile_id);
  const progressSecs = Math.floor(progress_seconds || 0);
  const durationSecs = Math.floor(duration_seconds || 0);

  // Ignore saves below 15 seconds — filters out scroll-by events and
  // the initial open before YouTube has sent any progress data.
  if (progressSecs < 15) return res.json({ ok: true });

  db.upsertWatchHistory(profileId, video_id, progressSecs, durationSecs);
  db.applyCompletionToInterests(profileId, video_id, progressSecs, durationSecs);

  res.json({ ok: true });
});

// Get watch history for a profile
app.get('/api/watch-history/:profileId', (req, res) => {
  const profileId = parseInt(req.params.profileId);
  const limit = parseInt(req.query.limit) || 50;
  const history = db.getWatchHistory(profileId, limit);
  res.json({ history });
});

// Remove a single video from watch history
app.delete('/api/watch-history/:profileId/:videoId', (req, res) => {
  const profileId = parseInt(req.params.profileId);
  const { videoId } = req.params;
  db.removeFromHistory(profileId, videoId);
  res.json({ ok: true });
});

// Mark video as not interested: blocks from feed + removes from history
app.post('/api/not-interested', (req, res) => {
  const { profile_id, video_id } = req.body;
  if (!profile_id || !video_id) return res.status(400).json({ error: 'Missing required fields' });
  db.blockVideo(parseInt(profile_id), video_id);
  db.removeFromHistory(parseInt(profile_id), video_id);
  db.applyReactionToInterests(parseInt(profile_id), video_id, 'not-interested');
  res.json({ ok: true });
});

// Kid-facing like/dislike reaction
app.post('/api/video/:videoId/react', (req, res) => {
  const { videoId } = req.params;
  const { profile_id, reaction } = req.body;
  if (!profile_id || !reaction || !['like', 'dislike'].includes(reaction)) {
    return res.status(400).json({ error: 'profile_id and reaction (like|dislike) required' });
  }
  db.applyReactionToInterests(parseInt(profile_id), videoId, reaction);
  res.json({ ok: true });
});

// Parent admin like/dislike reaction (same logic, separate route for clarity)
app.post('/api/admin/video/:videoId/react', requireAdmin, (req, res) => {
  const { videoId } = req.params;
  const { profile_id, reaction } = req.body;
  if (!profile_id || !reaction || !['like', 'dislike'].includes(reaction)) {
    return res.status(400).json({ error: 'profile_id and reaction (like|dislike) required' });
  }
  db.applyReactionToInterests(parseInt(profile_id), videoId, reaction);
  res.json({ ok: true });
});

// ── Search ───────────────────────────────────────────────────────────────────

app.get('/api/search', async (req, res) => {
  const q         = (req.query.q || '').trim();
  const profileId = parseInt(req.query.profile_id);
  if (!q || !profileId) return res.status(400).json({ error: 'Missing q or profile_id' });

  // Save to search history
  db.saveSearchQuery(profileId, q);

  // 1. Search approved library
  const dbResults = db.searchApprovedVideos(profileId, q);

  // 2. If sparse, supplement with YouTube API
  let apiResults = [];
  if (dbResults.length < 5) {
    const channels    = db.getWhitelistedChannels(profileId);
    const channelIds  = channels.map(c => c.channel_id);
    const filterRules = db.getFilterRules(profileId);
    const apiVideos   = await youtube.searchVideos(q, channelIds, 20);

    for (const video of apiVideos) {
      if (db.videoExists(video.video_id)) continue;
      if (filter.isShort(video) || filter.isLive(video)) continue;
      const filterResult = filter.runFilterPass(video, filterRules);
      if (filterResult.rejected) continue;

      db.insertVideo({
        ...video,
        transcript:       null,
        channel_thumbnail: null,
        status:           'approved',
        is_recommended:   0,
        source_video_id:  null,
        view_count:       null,
        needs_llm_review: 1,
      });
      apiResults.push(video);
    }
  }

  // Merge: DB hits first, then newly imported API hits, deduped
  const seen = new Set(dbResults.map(v => v.video_id));
  const merged = [
    ...dbResults,
    ...apiResults.filter(v => !seen.has(v.video_id)),
  ];

  res.json({ results: merged });
});

app.get('/api/search/history', (req, res) => {
  const profileId = parseInt(req.query.profile_id);
  if (!profileId) return res.status(400).json({ error: 'Missing profile_id' });
  const history = db.getSearchHistory(profileId);
  res.json({ history });
});

app.delete('/api/search/history/:profileId/:query', (req, res) => {
  const profileId = parseInt(req.params.profileId);
  const query     = decodeURIComponent(req.params.query);
  db.deleteSearchQuery(profileId, query);
  res.json({ ok: true });
});

app.get('/api/search/suggestions', (req, res) => {
  const q         = (req.query.q || '').trim();
  const profileId = parseInt(req.query.profile_id);
  if (!q || !profileId) return res.json({ suggestions: [] });
  res.json({ suggestions: db.getSearchSuggestions(profileId, q) });
});

// ── Channel Discovery ────────────────────────────────────────────────────────

app.post('/api/admin/discover/channels', requireAdmin, async (req, res) => {
  const profileId = parseInt(req.body.profile_id);
  if (!profileId) return res.status(400).json({ error: 'Missing profile_id' });

  const raw = db.getDb();

  // Top 5 behavior interest tags by weight
  const tags = raw.prepare(`
    SELECT tag FROM profile_interests
    WHERE profile_id = ? AND source = 'behavior' AND weight > 0
    ORDER BY weight DESC LIMIT 5
  `).all(profileId).map(r => r.tag);

  // Top 5 whitelisted channel names as search queries
  const channelNames = raw.prepare(`
    SELECT channel_name FROM channels
    WHERE profile_id = ? AND whitelisted = 1 AND channel_name IS NOT NULL
    ORDER BY RANDOM() LIMIT 5
  `).all(profileId).map(r => r.channel_name);

  const queries = [...tags, ...channelNames].filter(Boolean).slice(0, 10);
  if (queries.length === 0) return res.json({ candidates: [] });

  // Channel IDs already known across all profiles — avoid surfacing channels
  // the parent has already curated anywhere in the system
  const existingIds = new Set(
    raw.prepare('SELECT DISTINCT channel_id FROM channels')
       .all().map(r => r.channel_id)
  );

  // Run searches sequentially to stay within quota
  const allResults = [];
  for (const q of queries) {
    const results = await youtube.discoverChannels(q);
    allResults.push(...results);
    await new Promise(r => setTimeout(r, 200));
  }

  // Deduplicate by channel_id, remove already-known channels
  const seen = new Set();
  const candidates = allResults.filter(c => {
    if (!c.channel_id || seen.has(c.channel_id) || existingIds.has(c.channel_id)) return false;
    seen.add(c.channel_id);
    return true;
  });

  // Enrich with subscriber counts via channels.list
  if (candidates.length > 0) {
    const enriched = await youtube.enrichChannels(candidates.map(c => c.channel_id));
    const enrichMap = {};
    for (const e of enriched) enrichMap[e.channel_id] = e;
    for (const c of candidates) {
      const e = enrichMap[c.channel_id];
      if (e) {
        c.subscriber_count = e.subscriber_count || null;
        c.description      = c.description || e.description || null;
      }
    }
  }

  // Sort by subscriber count descending, return top 20
  candidates.sort((a, b) => (b.subscriber_count || 0) - (a.subscriber_count || 0));
  res.json({ candidates: candidates.slice(0, 20) });
});

app.post('/api/admin/discover/channels/approve', requireAdmin, async (req, res) => {
  const { profile_id, channel_id, channel_name, thumbnail_url } = req.body;
  if (!profile_id || !channel_id) return res.status(400).json({ error: 'Missing profile_id or channel_id' });

  db.upsertChannel({
    channel_id,
    profile_id:    parseInt(profile_id),
    channel_name:  channel_name || '',
    thumbnail_url: thumbnail_url || null,
    whitelisted:   1,
  });

  // Fire-and-forget backfill — runs in background, does not block response
  backfillChannel(
    { channel_id, channel_name: channel_name || '', thumbnail_url: thumbnail_url || null },
    parseInt(profile_id)
  ).catch(err => console.error('[Discover] backfill failed:', err.message));

  res.json({ ok: true });
});

// ── Admin API Routes (protected) ─────────────────────────────────────────────

app.get('/api/admin/stats', requireAdmin, (req, res) => {
  res.json(db.getStats());
});

app.get('/api/admin/library', requireAdmin, (req, res) => {
  const status          = ['approved', 'rejected'].includes(req.query.status) ? req.query.status : 'all';
  const page            = Math.max(0, parseInt(req.query.page)  || 0);
  const limit           = Math.min(50, Math.max(1, parseInt(req.query.limit) || 25));
  const search          = (req.query.search || '').trim();
  const profileId       = req.query.profile_id ? parseInt(req.query.profile_id, 10) : null;
  const rejectionFilter = ['all','shorts','live','keyword','llm','manual'].includes(req.query.rejection_filter)
    ? req.query.rejection_filter : 'all';
  res.json(db.getVideoLibrary({ status, page, limit, search, profileId, rejectionFilter }));
});

app.get('/api/admin/filter-log', requireAdmin, (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  const videos = db.getRejectedVideos(limit);
  res.json({ videos });
});

app.get('/api/admin/rules', requireAdmin, (req, res) => {
  const rules = db.getFilterRules();
  res.json({ rules });
});

app.post('/api/admin/rules', requireAdmin, (req, res) => {
  const { rule_type, value, scope, profile_id } = req.body;
  if (!rule_type || !value) return res.status(400).json({ error: 'rule_type and value required' });

  const rule = db.addFilterRule({ rule_type, value, scope: scope || 'all', profile_id: profile_id || null });
  res.json({ rule });
});

app.delete('/api/admin/rules/:id', requireAdmin, (req, res) => {
  db.deleteFilterRule(parseInt(req.params.id));
  res.json({ ok: true });
});

app.post('/api/admin/override/:videoId', requireAdmin, (req, res) => {
  const { videoId } = req.params;
  const { action } = req.body;
  if (!['approve', 'reject'].includes(action)) {
    return res.status(400).json({ error: 'action must be approve or reject' });
  }
  const status = action === 'approve' ? 'approved' : 'rejected';
  db.updateVideoStatus(videoId, status, action === 'reject' ? 'Manual rejection' : null);
  res.json({ ok: true });
});

app.post('/api/admin/refresh', requireAdmin, async (req, res) => {
  res.json({ message: 'Refresh job started in background' });
  // Run in background after responding
  setImmediate(() => {
    cron.runNightlyJob().catch(err => console.error('Manual refresh error:', err));
  });
});

app.post('/api/admin/jobs/:name/dry-run', requireAdmin, (req, res) => {
  const fn = DRY_RUN_FNS[req.params.name];
  if (!fn) return res.status(404).json({ error: 'Unknown job' });
  try {
    res.json(fn());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/admin/jobs/:name/stream', requireAdmin, (req, res) => {
  const script = SCRIPT_MAP[req.params.name];
  if (!script) return res.status(404).json({ error: 'Unknown job' });

  if (activeJobStream) {
    return res.status(409).json({ error: 'A job is already running' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const scriptPath = path.join(__dirname, '..', 'scripts', script[0]);
  const args       = script.slice(1);
  const child      = spawn(process.execPath, [scriptPath, ...args], {
    env: { ...process.env },
    cwd: path.join(__dirname, '..'),
  });

  activeJobStream = child;

  const sendLine = (line) => res.write(`data: ${line}\n\n`);

  child.stdout.on('data', chunk =>
    chunk.toString().split('\n').filter(Boolean).forEach(sendLine)
  );
  child.stderr.on('data', chunk =>
    chunk.toString().split('\n').filter(Boolean).forEach(sendLine)
  );

  child.on('close', code => {
    res.write(`event: done\ndata: ${JSON.stringify({ exitCode: code })}\n\n`);
    res.end();
    activeJobStream = null;
  });

  req.on('close', () => {
    if (activeJobStream === child) {
      child.kill();
      activeJobStream = null;
    }
  });
});

app.get('/api/admin/channels/all', requireAdmin, (req, res) => {
  const channels = db.getAllChannels();
  res.json({ channels });
});

app.get('/api/admin/channels/:profileId', requireAdmin, (req, res) => {
  const profileId = parseInt(req.params.profileId);
  const channels = db.getChannelsForProfile(profileId);
  // Attach any pending rec to each channel so the UI can show chips
  const recRows = db.getAllChannelRecommendations(profileId);
  const recMap = Object.fromEntries(recRows.map(r => [r.channel_id, r]));
  const channelsWithRecs = channels.map(ch => ({
    ...ch,
    rec: recMap[ch.channel_id] || null
  }));
  res.json({ channels: channelsWithRecs });
});

// Fetch description, subscriber count, @handle for all channels in a profile
app.post('/api/admin/channels/enrich/:profileId', requireAdmin, async (req, res) => {
  const profileId = parseInt(req.params.profileId);
  const channels = db.getChannelsForProfile(profileId);
  if (channels.length === 0) return res.json({ ok: true, enriched: 0 });

  try {
    const channelIds = channels.map(c => c.channel_id);
    const enriched = await youtube.enrichChannels(channelIds);
    for (const data of enriched) {
      db.updateChannelEnrichment(data.channel_id, data);
    }
    res.json({ ok: true, enriched: enriched.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/admin/channels/:channelId', requireAdmin, (req, res) => {
  const { channelId } = req.params;
  const { whitelisted, profileId } = req.body;
  db.updateChannelWhitelist(channelId, parseInt(profileId), whitelisted);
  res.json({ ok: true });
});

// Add a channel by YouTube URL or @handle
app.post('/api/admin/channels/add', requireAdmin, async (req, res) => {
  const { url, profileId } = req.body;
  if (!url) return res.status(400).json({ error: 'url required' });

  try {
    const channel = await youtube.resolveChannelByUrl(url.trim());
    const profiles = profileId ? [{ id: parseInt(profileId) }] : db.getProfiles();
    for (const profile of profiles) {
      db.upsertChannel({ ...channel, profile_id: profile.id, whitelisted: 1 });
    }
    res.json({ ok: true, channel });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// --- Channel import sessions (token-based, no cookie needed for cross-origin snippet) ---
const importJobs = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of importJobs) { if (v.expires < now) importJobs.delete(k); }
}, 5 * 60 * 1000);

// Create an import session — returns a one-time token embedded in the snippet
app.post('/api/admin/channels/start-import', requireAdmin, (req, res) => {
  const token = crypto.randomBytes(20).toString('hex');
  const profileId = req.body.profileId ? parseInt(req.body.profileId) : null;
  importJobs.set(token, { status: 'pending', profileId, expires: Date.now() + 15 * 60 * 1000 });
  res.json({ token });
});

// Admin polls this to see when the snippet has delivered its data
app.get('/api/admin/channels/import-status/:token', requireAdmin, (req, res) => {
  const job = importJobs.get(req.params.token);
  if (!job) return res.json({ status: 'not_found' });
  res.json({ status: job.status, result: job.result || null });
});

// Snippet POSTs here directly from YouTube — no cookie, token auth only
// Supports both application/json and text/plain (for no-cors mode)
app.post('/api/admin/channels/receive-import', async (req, res) => {
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { return res.status(400).json({ error: 'Invalid JSON' }); }
  }
  const { token, channels } = body || {};
  console.log(`[Import] receive-import called: token=${token?.slice(0,8)}... channels=${channels?.length ?? 'none'}`);

  const job = importJobs.get(token);

  if (!job || Date.now() > job.expires) {
    console.log(`[Import] Token not found or expired. Known tokens: ${[...importJobs.keys()].map(k => k.slice(0,8)).join(', ') || 'none'}`);
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
  if (job.status !== 'pending') {
    console.log(`[Import] Job already in status: ${job.status}`);
    return res.status(400).json({ error: 'Already received' });
  }

  job.status = 'processing';
  res.json({ ok: true, received: channels?.length || 0 });

  // Process in background
  setImmediate(async () => {
    const profiles = job.profileId ? [{ id: job.profileId }] : db.getProfiles();
    const result = { imported: 0, failed: 0 };

    for (const ch of (channels || [])) {
      try {
        let resolved;
        if (ch.channel_id?.startsWith('UC')) {
          resolved = { channel_id: ch.channel_id, channel_name: ch.channel_name, thumbnail_url: ch.thumbnail_url || null };
        } else if (ch.handle) {
          resolved = await youtube.resolveChannelByUrl(ch.handle);
          if (!resolved.thumbnail_url && ch.thumbnail_url) resolved.thumbnail_url = ch.thumbnail_url;
          await new Promise(r => setTimeout(r, 150));
        } else { result.failed++; continue; }

        for (const p of profiles) db.upsertChannel({ ...resolved, profile_id: p.id, whitelisted: 0 });
        result.imported++;
      } catch { result.failed++; }
    }

    Object.assign(job, { status: 'done', result, expires: Date.now() + 10 * 60 * 1000 });
    console.log(`[Import] Done: ${result.imported} imported, ${result.failed} failed`);
  });
});

// Admin: Disconnect Google account from a profile
app.post('/api/admin/profiles/:id/disconnect', requireAdmin, (req, res) => {
  db.updateProfileTokens(parseInt(req.params.id), null, null);
  res.json({ ok: true });
});

// Admin: Create a new profile
app.post('/api/admin/profiles', requireAdmin, (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  const profile = db.createProfile(name);
  res.json({ profile });
});

// Manual trigger for weekly consolidation pass
app.post('/api/admin/consolidation/run', requireAdmin, async (req, res) => {
  try {
    await runWeeklyConsolidationPass();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Manual trigger for daily insights pass
app.post('/api/admin/insights/run', requireAdmin, async (req, res) => {
  try {
    await runDailyInsightsPass();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Child Profile Routes ──────────────────────────────────────────────────────

// Get child profile for a profile
app.get('/api/admin/child-profile/:profileId', requireAdmin, (req, res) => {
  const profileId = parseInt(req.params.profileId);
  const profile = db.getChildProfile(profileId);
  res.json({ profile: profile || null });
});

// Save child profile (manual edit by parent)
app.post('/api/admin/child-profile/:profileId', requireAdmin, async (req, res) => {
  const profileId = parseInt(req.params.profileId);
  const { markdown } = req.body;
  if (!markdown) return res.status(400).json({ error: 'markdown required' });

  db.saveChildProfile(profileId, markdown, 'parent');
  await childProfile.refreshParentInterests(profileId, markdown).catch(() => {});
  res.json({ ok: true });
});

// Generate initial child profile from interview answers
app.post('/api/admin/child-profile/:profileId/generate', requireAdmin, async (req, res) => {
  const profileId = parseInt(req.params.profileId);
  const { profileName, answers } = req.body;

  if (!profileName || !answers) {
    return res.status(400).json({ error: 'profileName and answers required' });
  }

  try {
    const markdown = await childProfile.generateChildProfile(profileName, answers);
    db.saveChildProfile(profileId, markdown, 'parent');
    await childProfile.refreshParentInterests(profileId, markdown).catch(() => {});
    res.json({ ok: true, markdown });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get recent insights for a profile
app.get('/api/admin/insights/:profileId', requireAdmin, (req, res) => {
  const profileId = parseInt(req.params.profileId);
  const days = parseInt(req.query.days) || 7;
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const insights = db.getDb().prepare(`
    SELECT * FROM profile_insights
    WHERE profile_id = ? AND created_at > ?
    ORDER BY created_at DESC
    LIMIT 50
  `).all(profileId, cutoff);
  res.json({ insights });
});

// Channel recommendations
app.get('/api/admin/channel-recommendations/:profileId', requireAdmin, (req, res) => {
  const profileId = parseInt(req.params.profileId, 10);
  const recs = db.getChannelRecommendations(profileId);
  res.json(recs);
});

app.post('/api/admin/channel-recommendations/:profileId/:channelId/apply', requireAdmin, (req, res) => {
  const profileId = parseInt(req.params.profileId, 10);
  const { channelId } = req.params;
  db.applyChannelRecommendation(channelId, profileId);
  res.json({ ok: true });
});

app.post('/api/admin/channel-recommendations/:profileId/bulk-apply', requireAdmin, (req, res) => {
  const profileId = parseInt(req.params.profileId, 10);
  const channelIds = Array.isArray(req.body.channelIds) ? req.body.channelIds : null;
  const count = db.bulkApplyChannelRecommendations(profileId, channelIds);
  res.json({ ok: true, count });
});

app.post('/api/admin/channel-recommendations/:profileId/:channelId/dismiss', requireAdmin, (req, res) => {
  const profileId = parseInt(req.params.profileId, 10);
  const { channelId } = req.params;
  db.dismissChannelRecommendation(channelId, profileId);
  res.json({ ok: true });
});

// ── Start server ──────────────────────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
  console.log(`KidsTube backend running on port ${PORT}`);
});

module.exports = app;
