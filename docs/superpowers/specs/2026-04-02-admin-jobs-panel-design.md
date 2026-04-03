# Admin Jobs Panel — Design Spec

**Date:** 2026-04-02  
**Status:** Approved for implementation

## Problem

Backend maintenance scripts (`audit-channels.js`, `backfill-llm.js`, the nightly job) can only be run from the terminal. There is no cost visibility before running them — yesterday's `audit-channels.js` + `backfill-llm.js` run cost ~$5 unexpectedly. We need an admin UI that exposes all jobs, streams their output live, and lets you run a dry-run to estimate cost before committing.

---

## Jobs Exposed

| Button Label | Script/Function | Notes |
|---|---|---|
| Full Nightly Refresh | `scripts/nightly.js` → `runNightlyJob()` | New thin wrapper script |
| Channel Audit | `scripts/audit-channels.js` | Existing script |
| LLM Backfill: Tag Untagged | `scripts/backfill-llm.js a` | Batch A only |
| LLM Backfill: Re-evaluate Rejections | `scripts/backfill-llm.js b` | Batch B only |

---

## Backend

### Dry-Run Endpoints

Four `POST /api/admin/jobs/:name/dry-run` endpoints. Each performs DB queries only — no script execution, no LLM calls.

**Response shape (all four):**
```json
{
  "job": "channel-audit",
  "counts": { "child1Channels": 457, "child2Channels": 46, "totalBatches": 51 },
  "estimatedCalls": 51,
  "estimatedInputTokens": 127500,
  "estimatedOutputTokens": 15300,
  "estimatedCostUsd": 0.163
}
```

**Per-job dry-run logic:**

- `nightly` — Count whitelisted channels per profile; count `needs_llm_review=1` videos. Since RSS can't be polled without network calls, estimate new videos as `channels × 2` (conservative daily average based on recent cron history). LLM call estimate is `min(estimatedNewVideos, 300)` using the existing cap. Token estimate: 2000 input + 150 output per call.
- `channel-audit` — Count all channels per profile from `channels` table. Batch count = `ceil(total / 10)`. Token estimate: 2500 input + 300 output per batch.
- `backfill-tag` — Count approved videos with no rows in `video_tags`. Token estimate: 2000 input + 150 output per video.
- `backfill-reeval` — Count `status='rejected'` rows where `rejection_reason` matches soft-keyword patterns (`Keyword: "die"`, etc.) and doesn't start with `LLM:`. Token estimate: 2000 input + 100 output per video.

**Haiku pricing constants (hardcoded):**
- Input: $0.80 / 1M tokens
- Output: $4.00 / 1M tokens

### Streaming Endpoints

`GET /api/admin/jobs/:name/stream`

1. Sets SSE headers: `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive`
2. Spawns child process for the appropriate script (with env vars passed through)
3. Pipes `stdout` and `stderr` line-by-line as SSE `data:` events
4. On process exit: sends `event: done\ndata: {"exitCode": 0}\n\n`
5. On client disconnect: kills child process

**SSE event format:**
```
data: [log line text]\n\n
event: done\ndata: {"exitCode":0}\n\n
```

Only one job runs at a time. If a stream is already active when a new request arrives, return `409 Conflict`.

**New wrapper script** `backend/scripts/nightly.js`:
```js
const { runNightlyJob } = require('../src/cron');
runNightlyJob().then(() => process.exit(0)).catch(err => {
  console.error(err.message);
  process.exit(1);
});
```

---

## Frontend

### Placement

New "Jobs" section in the Dashboard tab, replacing the existing standalone "Manual Refresh" button. Located in the same card/area as the current refresh controls.

### Split Button Component

Each job renders as a split button group:
- **Left segment**: job label — clicking runs the job immediately
- **Right segment**: `▾` caret — opens a small dropdown with a single "Dry Run" option

All four buttons disable while any job is running (one-at-a-time enforcement on the frontend).

### Log Panel

Appears below the job buttons when a job starts; hidden when no job has run or after clearing.

**Header:** `● [Job Name] — [Run | Dry Run]` + `[Clear ✕]` button (right-aligned)

**Body:** Monospace, dark background (`yt-card`/`yt-surface`), fixed height with overflow-y scroll, auto-scrolls to bottom as lines arrive.

**Footer (appended when done):**
- Exit 0: `✓ Done`
- Exit non-0: `✗ Failed (exit [code])`

For **dry-run**, the backend endpoint returns JSON (not SSE). The frontend formats it into a human-readable summary rendered in the log panel:

```
[Job: Channel Audit — Dry Run]

Child1:  457 channels → 46 batches
Child2:    46 channels →  5 batches
─────────────────────────────────
Total:   51 Haiku calls estimated

Est. input:   127,500 tokens  →  $0.10
Est. output:   15,300 tokens  →  $0.06
──────────────────────────────────────
Estimated total cost:  ~$0.16

✓ Done
```

### State

```js
const [activeJob, setActiveJob] = useState(null); // null | { name, mode: 'run'|'dry-run' }
const [logLines, setLogLines]   = useState([]);
const [jobDone, setJobDone]     = useState(null);  // null | { exitCode }
```

`EventSource` connection opened on job start, closed on `done` event or component unmount.

---

## Error Handling

- If `POST /dry-run` fails: show error message in log panel
- If SSE stream drops unexpectedly: append `⚠ Connection lost` to log panel
- 409 from stream endpoint (job already running): surface as a toast/inline message, don't open a second panel

---

## Out of Scope

- Job scheduling / cron management from the UI
- Job history / run log persistence
- `remove-soft-keywords.js` (one-off migration, already run)
- Concurrent job execution
