require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');

const db = require('./db');
const auth = require('./auth');
const cron = require('./cron');
const youtube = require('./youtube');
const recommendations = require('./recommendations');
const { runDailyInsightsPass, runWeeklyConsolidationPass } = require('./insights');
const childProfile = require('./childProfile');

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

  const videos = db.getApprovedFeed(profileId, page, limit);
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

// ── Watch History Routes ──────────────────────────────────────────────────────

// Record/update watch progress
app.post('/api/watch-history', (req, res) => {
  const { profile_id, video_id, progress_seconds, duration_seconds } = req.body;
  if (!profile_id || !video_id) return res.status(400).json({ error: 'Missing required fields' });

  const profileId    = parseInt(profile_id);
  const progressSecs = Math.floor(progress_seconds || 0);
  const durationSecs = Math.floor(duration_seconds || 0);

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
app.post('/api/admin/video/:videoId/react', (req, res) => {
  const { videoId } = req.params;
  const { profile_id, reaction } = req.body;
  if (!profile_id || !reaction || !['like', 'dislike'].includes(reaction)) {
    return res.status(400).json({ error: 'profile_id and reaction (like|dislike) required' });
  }
  db.applyReactionToInterests(parseInt(profile_id), videoId, reaction);
  res.json({ ok: true });
});

// ── Admin API Routes (protected) ─────────────────────────────────────────────

app.get('/api/admin/stats', requireAdmin, (req, res) => {
  res.json(db.getStats());
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

app.get('/api/admin/channels/all', requireAdmin, (req, res) => {
  const channels = db.getAllChannels();
  res.json({ channels });
});

app.get('/api/admin/channels/:profileId', requireAdmin, (req, res) => {
  const profileId = parseInt(req.params.profileId);
  const channels = db.getChannelsForProfile(profileId);
  res.json({ channels });
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
      db.upsertChannel({ ...channel, profile_id: profile.id, whitelisted: 0 });
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
app.post('/api/admin/consolidation/run', async (req, res) => {
  try {
    await runWeeklyConsolidationPass();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Manual trigger for daily insights pass
app.post('/api/admin/insights/run', async (req, res) => {
  try {
    await runDailyInsightsPass();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Child Profile Routes ──────────────────────────────────────────────────────

// Get child profile for a profile
app.get('/api/admin/child-profile/:profileId', (req, res) => {
  const profileId = parseInt(req.params.profileId);
  const profile = db.getChildProfile(profileId);
  res.json({ profile: profile || null });
});

// Save child profile (manual edit by parent)
app.post('/api/admin/child-profile/:profileId', async (req, res) => {
  const profileId = parseInt(req.params.profileId);
  const { markdown } = req.body;
  if (!markdown) return res.status(400).json({ error: 'markdown required' });

  db.saveChildProfile(profileId, markdown, 'parent');
  await childProfile.refreshParentInterests(profileId, markdown).catch(() => {});
  res.json({ ok: true });
});

// Generate initial child profile from interview answers
app.post('/api/admin/child-profile/:profileId/generate', async (req, res) => {
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
app.get('/api/admin/insights/:profileId', (req, res) => {
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

// ── Start server ──────────────────────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
  console.log(`KidsTube backend running on port ${PORT}`);
});

module.exports = app;
