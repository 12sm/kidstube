# Admin Jobs Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an admin Jobs panel to the Dashboard tab that exposes all backend scripts as UI-triggered actions with live SSE streaming output, dry-run cost estimation, and split-button controls.

**Architecture:** Four jobs (nightly, channel-audit, backfill-tag, backfill-reeval) are exposed via two endpoint types each — a fast `POST /dry-run` that queries the DB and returns cost estimates, and a `GET /stream` that spawns the corresponding script as a child process and pipes stdout/stderr as Server-Sent Events. The frontend uses `EventSource` for streaming and plain `fetch` for dry-runs, rendering output into an inline log panel.

**Tech Stack:** Node.js `child_process.spawn`, Server-Sent Events (SSE), React `EventSource`, Tailwind CSS, better-sqlite3

---

## File Map

| File | Action | Purpose |
|---|---|---|
| `backend/scripts/nightly.js` | Create | Thin wrapper that calls `runNightlyJob()` and exits |
| `backend/src/jobDryRun.js` | Create | DB-only dry-run queries + cost estimates for all 4 jobs |
| `backend/src/server.js` | Modify | Add dry-run routes + SSE stream routes; remove old refresh endpoint |
| `frontend/src/pages/Admin.jsx` | Modify | Add `JobsPanel` component; replace old Manual Refresh button |

---

## Task 1: Create `backend/scripts/nightly.js`

**Files:**
- Create: `backend/scripts/nightly.js`

- [ ] **Step 1: Create the wrapper script**

```js
#!/usr/bin/env node
'use strict';

const { runNightlyJob } = require('../src/cron');

runNightlyJob()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('[nightly] Fatal:', err.message);
    process.exit(1);
  });
```

- [ ] **Step 2: Verify the script runs inside the Docker container**

```bash
docker compose exec backend node scripts/nightly.js
```

Expected: cron log lines appear (e.g., `[Cron] Starting nightly job`) and process exits. It will run the real job — that's fine, it's the same as the existing Manual Refresh behavior.

- [ ] **Step 3: Commit**

```bash
git add backend/scripts/nightly.js
git commit -m "feat: add nightly.js wrapper script for child process spawning"
```

---

## Task 2: Create `backend/src/jobDryRun.js`

**Files:**
- Create: `backend/src/jobDryRun.js`

- [ ] **Step 1: Create the module**

```js
'use strict';

const db = require('./db');

const HAIKU_INPUT_COST  = 0.80 / 1_000_000;
const HAIKU_OUTPUT_COST = 4.00 / 1_000_000;

function calcCost(inputTokens, outputTokens) {
  return (inputTokens * HAIKU_INPUT_COST) + (outputTokens * HAIKU_OUTPUT_COST);
}

function dryRunNightly() {
  const raw = db.getDb();

  const channelsByProfile = raw.prepare(`
    SELECT p.name as profileName, COUNT(c.id) as cnt
    FROM channels c
    JOIN profiles p ON p.id = c.profile_id
    WHERE c.whitelisted = 1
    GROUP BY c.profile_id
  `).all();

  const totalChannels  = channelsByProfile.reduce((sum, r) => sum + r.cnt, 0);
  const needsLlmReview = raw.prepare(
    `SELECT COUNT(*) as cnt FROM videos WHERE needs_llm_review = 1`
  ).get().cnt;

  const estimatedNewVideos  = totalChannels * 2;
  const estimatedLlmCalls   = Math.min(estimatedNewVideos, 300) + needsLlmReview;
  const estimatedInputTokens  = estimatedLlmCalls * 2000;
  const estimatedOutputTokens = estimatedLlmCalls * 150;

  return {
    job: 'nightly',
    counts: { channelsByProfile, totalChannels, needsLlmReview, estimatedNewVideos },
    estimatedCalls: estimatedLlmCalls,
    estimatedInputTokens,
    estimatedOutputTokens,
    estimatedCostUsd: calcCost(estimatedInputTokens, estimatedOutputTokens),
  };
}

function dryRunChannelAudit() {
  const raw = db.getDb();

  const channelsByProfile = raw.prepare(`
    SELECT p.name as profileName, COUNT(c.id) as cnt
    FROM channels c
    JOIN profiles p ON p.id = c.profile_id
    GROUP BY c.profile_id
  `).all();

  const totalChannels = channelsByProfile.reduce((sum, r) => sum + r.cnt, 0);
  const totalBatches  = Math.ceil(totalChannels / 10);
  const estimatedInputTokens  = totalBatches * 2500;
  const estimatedOutputTokens = totalBatches * 300;

  return {
    job: 'channel-audit',
    counts: { channelsByProfile, totalChannels, totalBatches },
    estimatedCalls: totalBatches,
    estimatedInputTokens,
    estimatedOutputTokens,
    estimatedCostUsd: calcCost(estimatedInputTokens, estimatedOutputTokens),
  };
}

function dryRunBackfillTag() {
  const raw = db.getDb();

  const videoCount = raw.prepare(`
    SELECT COUNT(*) as cnt FROM videos v
    WHERE v.status = 'approved'
      AND NOT EXISTS (SELECT 1 FROM video_tags vt WHERE vt.video_id = v.video_id)
  `).get().cnt;

  const estimatedInputTokens  = videoCount * 2000;
  const estimatedOutputTokens = videoCount * 150;

  return {
    job: 'backfill-tag',
    counts: { videoCount },
    estimatedCalls: videoCount,
    estimatedInputTokens,
    estimatedOutputTokens,
    estimatedCostUsd: calcCost(estimatedInputTokens, estimatedOutputTokens),
  };
}

function dryRunBackfillReeval() {
  const raw = db.getDb();

  const SOFT_KEYWORDS = ['die', 'death', 'scary', 'violence'];
  const placeholders  = SOFT_KEYWORDS.map(() => '?').join(', ');

  const videoCount = raw.prepare(`
    SELECT COUNT(*) as cnt FROM videos
    WHERE status = 'rejected'
      AND rejection_reason IN (${placeholders})
  `).get(...SOFT_KEYWORDS.map(k => `Keyword: "${k}"`)).cnt;

  const estimatedInputTokens  = videoCount * 2000;
  const estimatedOutputTokens = videoCount * 100;

  return {
    job: 'backfill-reeval',
    counts: { videoCount },
    estimatedCalls: videoCount,
    estimatedInputTokens,
    estimatedOutputTokens,
    estimatedCostUsd: calcCost(estimatedInputTokens, estimatedOutputTokens),
  };
}

module.exports = {
  dryRunNightly,
  dryRunChannelAudit,
  dryRunBackfillTag,
  dryRunBackfillReeval,
};
```

- [ ] **Step 2: Smoke-test the module inside Docker**

```bash
docker compose exec backend node -e "
const dr = require('./src/jobDryRun');
console.log(JSON.stringify(dr.dryRunChannelAudit(), null, 2));
console.log(JSON.stringify(dr.dryRunBackfillTag(), null, 2));
"
```

Expected: JSON objects with numeric `estimatedCalls` and `estimatedCostUsd` fields, no errors.

- [ ] **Step 3: Commit**

```bash
git add backend/src/jobDryRun.js
git commit -m "feat: add jobDryRun module with cost estimates for all 4 jobs"
```

---

## Task 3: Add dry-run and SSE routes to `server.js`

**Files:**
- Modify: `backend/src/server.js`

- [ ] **Step 1: Add requires near the top of `server.js`** (after the existing `require` block, around line 10)

Add these two lines alongside the existing requires:

```js
const { spawn } = require('child_process');
const path       = require('path');
const jobDryRun  = require('./jobDryRun');
```

- [ ] **Step 2: Add job maps and active stream tracker** (after the requires, before any route definitions)

```js
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
```

- [ ] **Step 3: Add the dry-run route** (after the existing `/api/admin/refresh` route, around line 500)

```js
app.post('/api/admin/jobs/:name/dry-run', requireAdmin, (req, res) => {
  const fn = DRY_RUN_FNS[req.params.name];
  if (!fn) return res.status(404).json({ error: 'Unknown job' });
  try {
    res.json(fn());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
```

- [ ] **Step 4: Add the SSE streaming route** (immediately after the dry-run route)

```js
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
```

- [ ] **Step 5: Rebuild and restart backend**

```bash
cd /home/michael/projects/kidstube
docker compose build backend && docker compose up -d backend
```

Expected: build completes, container restarts healthy.

- [ ] **Step 6: Test dry-run endpoint**

First get an admin token cookie by logging into the admin panel in the browser, then:

```bash
# From browser devtools console while logged into admin:
fetch('/api/admin/jobs/backfill-tag/dry-run', { method: 'POST', credentials: 'include' })
  .then(r => r.json()).then(console.log)
```

Expected output shape:
```json
{
  "job": "backfill-tag",
  "counts": { "videoCount": 0 },
  "estimatedCalls": 0,
  "estimatedInputTokens": 0,
  "estimatedOutputTokens": 0,
  "estimatedCostUsd": 0
}
```

- [ ] **Step 7: Test SSE stream endpoint with curl**

```bash
curl -N -b "admin_token=$(docker compose exec backend node -e "const jwt=require('jsonwebtoken');console.log(jwt.sign({},process.env.JWT_SECRET||'fallback_secret'))")" \
  http://localhost:3001/api/admin/jobs/channel-audit/stream
```

Expected: SSE lines stream to terminal, ending with `event: done`.

- [ ] **Step 8: Commit**

```bash
git add backend/src/server.js
git commit -m "feat: add dry-run and SSE stream endpoints for all 4 admin jobs"
```

---

## Task 4: Add `JobsPanel` to `Admin.jsx`

**Files:**
- Modify: `frontend/src/pages/Admin.jsx`

- [ ] **Step 1: Add the `JOBS` config and `formatDryRunReport` helper** before the `JobsPanel` component definition (add this block before `function AdminDashboard()`, around line 709):

```jsx
const JOBS = [
  { name: 'nightly',         label: 'Full Nightly Refresh' },
  { name: 'channel-audit',   label: 'Channel Audit' },
  { name: 'backfill-tag',    label: 'LLM Backfill: Tag Untagged' },
  { name: 'backfill-reeval', label: 'LLM Backfill: Re-evaluate Rejections' },
];

function formatDryRunReport(data) {
  const lines = [`[${data.job} — Dry Run]`, ''];

  if (data.job === 'nightly') {
    (data.counts.channelsByProfile || []).forEach(r => {
      lines.push(`  ${r.profileName}: ${r.cnt} channels`);
    });
    lines.push(`  Est. new videos/night: ~${data.counts.estimatedNewVideos}`);
    lines.push(`  Pending LLM review:    ${data.counts.needsLlmReview}`);
  } else if (data.job === 'channel-audit') {
    (data.counts.channelsByProfile || []).forEach(r => {
      lines.push(`  ${r.profileName}: ${r.cnt} channels → ${Math.ceil(r.cnt / 10)} batches`);
    });
    lines.push(`  Total batches: ${data.counts.totalBatches}`);
  } else if (data.job === 'backfill-tag') {
    lines.push(`  Approved videos without tags: ${data.counts.videoCount}`);
  } else if (data.job === 'backfill-reeval') {
    lines.push(`  Soft-keyword rejections pending re-eval: ${data.counts.videoCount}`);
  }

  lines.push('');
  lines.push(`  Estimated Haiku calls: ${data.estimatedCalls}`);
  lines.push(`  Est. input:  ${data.estimatedInputTokens.toLocaleString()} tok  →  $${(data.estimatedInputTokens * 0.80 / 1_000_000).toFixed(3)}`);
  lines.push(`  Est. output: ${data.estimatedOutputTokens.toLocaleString()} tok  →  $${(data.estimatedOutputTokens * 4.00 / 1_000_000).toFixed(3)}`);
  lines.push('  ─────────────────────────────────────');
  lines.push(`  Estimated total cost:  ~$${data.estimatedCostUsd.toFixed(3)}`);

  return lines;
}
```

- [ ] **Step 2: Add the `JobsPanel` component** (immediately after the `formatDryRunReport` function, before `function AdminDashboard()`):

```jsx
function JobsPanel() {
  const [activeJob, setActiveJob]     = useState(null); // { name, mode } | null
  const [openDropdown, setOpenDropdown] = useState(null);
  const [logLines, setLogLines]       = useState([]);
  const [jobHeader, setJobHeader]     = useState('');
  const [jobDone, setJobDone]         = useState(null); // { exitCode } | null
  const logEndRef = useRef(null);
  const esRef     = useRef(null);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logLines]);

  useEffect(() => {
    if (!openDropdown) return;
    const handler = () => setOpenDropdown(null);
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [openDropdown]);

  const startDryRun = async (jobName) => {
    setOpenDropdown(null);
    const job = JOBS.find(j => j.name === jobName);
    setActiveJob({ name: jobName, mode: 'dry-run' });
    setJobHeader(`${job.label} — Dry Run`);
    setLogLines(['Running dry run...']);
    setJobDone(null);

    try {
      const res = await fetch(`/api/admin/jobs/${jobName}/dry-run`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) throw new Error(`Server error ${res.status}`);
      const data = await res.json();
      setLogLines(formatDryRunReport(data));
      setJobDone({ exitCode: 0 });
    } catch (err) {
      setLogLines([`Error: ${err.message}`]);
      setJobDone({ exitCode: 1 });
    } finally {
      setActiveJob(null);
    }
  };

  const startJob = (jobName) => {
    if (esRef.current) esRef.current.close();
    const job = JOBS.find(j => j.name === jobName);
    setActiveJob({ name: jobName, mode: 'run' });
    setJobHeader(job.label);
    setLogLines([]);
    setJobDone(null);

    const es = new EventSource(`/api/admin/jobs/${jobName}/stream`, { withCredentials: true });
    esRef.current = es;

    es.onmessage = (e) => setLogLines(prev => [...prev, e.data]);

    es.addEventListener('done', (e) => {
      const { exitCode } = JSON.parse(e.data);
      setJobDone({ exitCode });
      setActiveJob(null);
      es.close();
      esRef.current = null;
    });

    es.onerror = () => {
      setLogLines(prev => [...prev, '⚠ Connection lost']);
      setJobDone({ exitCode: 1 });
      setActiveJob(null);
      es.close();
      esRef.current = null;
    };
  };

  const clearLog = () => {
    setLogLines([]);
    setJobHeader('');
    setJobDone(null);
  };

  const hasLog = jobHeader || logLines.length > 0;

  return (
    <section>
      <h2 className="text-yt-text font-semibold text-base mb-3">Jobs</h2>
      <div className="flex flex-wrap gap-2">
        {JOBS.map(job => (
          <div key={job.name} className="flex rounded-lg overflow-visible border border-yt-border">
            <button
              onClick={() => startJob(job.name)}
              disabled={!!activeJob}
              className="px-3 py-2 text-sm font-medium bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50 rounded-l-lg"
            >
              {activeJob?.name === job.name && activeJob.mode === 'run' ? 'Running...' : job.label}
            </button>
            <div className="w-px bg-blue-800" />
            <div className="relative">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setOpenDropdown(openDropdown === job.name ? null : job.name);
                }}
                disabled={!!activeJob}
                className="px-2 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50 rounded-r-lg"
              >
                ▾
              </button>
              {openDropdown === job.name && (
                <div className="absolute left-0 top-full mt-1 bg-yt-card border border-yt-border rounded-lg shadow-lg z-20 min-w-max">
                  <button
                    onClick={() => startDryRun(job.name)}
                    className="block w-full text-left px-4 py-2 text-sm text-yt-text hover:bg-yt-hover whitespace-nowrap"
                  >
                    Dry Run
                  </button>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {hasLog && (
        <div className="mt-4 rounded-xl border border-yt-border overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2 bg-yt-surface border-b border-yt-border">
            <span className="text-sm font-medium text-yt-text">
              {activeJob ? '● ' : ''}{jobHeader}
            </span>
            <button onClick={clearLog} className="text-yt-muted hover:text-yt-text text-xs">
              Clear ✕
            </button>
          </div>
          <div className="bg-yt-card p-4 h-64 overflow-y-auto font-mono text-xs text-yt-text">
            {logLines.map((line, i) => (
              <div key={i} className="leading-5">{line || '\u00A0'}</div>
            ))}
            {jobDone && (
              <div className={`mt-2 ${jobDone.exitCode === 0 ? 'text-green-400' : 'text-red-400'}`}>
                {jobDone.exitCode === 0 ? '✓ Done' : `✗ Failed (exit ${jobDone.exitCode})`}
              </div>
            )}
            <div ref={logEndRef} />
          </div>
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 3: Update `AdminDashboard` — remove old refresh button, add `JobsPanel`**

Remove the `refreshing`, `msg` state vars and the `triggerRefresh` function from `AdminDashboard`. Replace the old header+button row and the `msg` display with just the title, and add `<JobsPanel />` as a new section.

Replace this block in `AdminDashboard` (lines ~711–754):

```jsx
// REMOVE these state declarations:
const [refreshing, setRefreshing] = useState(false);
const [msg, setMsg] = useState('');

// REMOVE the triggerRefresh function entirely

// REMOVE this JSX block:
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
```

Replace with:

```jsx
<h2 className="text-xl font-semibold text-yt-text">Dashboard</h2>
```

Then add `<JobsPanel />` as the first section inside the `space-y-6` div, before the stats grid:

```jsx
<div className="p-6 space-y-6">
  <h2 className="text-xl font-semibold text-yt-text">Dashboard</h2>

  <JobsPanel />

  {stats && (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
      ...
    </div>
  )}
  ...
</div>
```

- [ ] **Step 4: Rebuild frontend**

```bash
cd /home/michael/projects/kidstube
docker compose build frontend && docker compose up -d frontend
```

Expected: build completes, frontend container restarts.

- [ ] **Step 5: Verify in browser**

1. Open `http://localhost:3000`, navigate to Admin > Dashboard
2. Confirm the old "Manual Refresh" button is gone
3. Confirm 4 split-button groups appear under a "Jobs" heading
4. Click the `▾` caret on "Channel Audit" → "Dry Run" option appears
5. Click "Dry Run" → log panel appears with cost estimate, ends with `✓ Done`
6. Click "Clear ✕" → panel disappears
7. Click "Full Nightly Refresh" → log panel appears, lines stream in live, ends with `✓ Done` or `✗ Failed`
8. While a job is running, confirm all other buttons are disabled (grayed out)

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/Admin.jsx
git commit -m "feat: add Jobs panel with live SSE streaming and dry-run cost estimates"
```

---

## Self-Review Checklist

- [x] `nightly.js` wrapper created — Task 1 covers it
- [x] All 4 dry-run DB queries implemented — Task 2
- [x] Cost formula uses correct Haiku pricing ($0.80/$4.00) — Task 2
- [x] SSE stream spawns correct script for each job name — Task 3
- [x] 409 conflict guard prevents concurrent jobs — Task 3
- [x] Client disconnect kills child process — Task 3
- [x] `formatDryRunReport` handles all 4 job shapes — Task 4
- [x] Old Manual Refresh button removed — Task 4
- [x] Auto-scroll on new log lines — Task 4 (logEndRef + useEffect)
- [x] Outside click closes dropdown — Task 4 (document click handler)
- [x] `useRef` already imported in Admin.jsx — confirmed in codebase
