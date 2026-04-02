const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const DOWNLOAD_DIR = process.env.DOWNLOAD_DIR || path.join(process.cwd(), 'downloads');

// Ensure download dir exists
if (!fs.existsSync(DOWNLOAD_DIR)) {
  fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
}

function runYtDlp(args, cwd) {
  return new Promise((resolve, reject) => {
    const proc = spawn('yt-dlp', args, { cwd: cwd || DOWNLOAD_DIR });
    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', d => { stdout += d.toString(); });
    proc.stderr.on('data', d => { stderr += d.toString(); });

    proc.on('close', code => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(new Error(`yt-dlp exited with code ${code}: ${stderr.slice(0, 500)}`));
      }
    });

    proc.on('error', err => {
      reject(new Error(`Failed to spawn yt-dlp: ${err.message}`));
    });

    // Timeout: 60 seconds per video
    setTimeout(() => {
      proc.kill();
      reject(new Error('yt-dlp timed out after 60s'));
    }, 60000);
  });
}

async function fetchVideoData(videoId) {
  const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
  // Use a temp directory per video to avoid collisions
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `ytdlp-${videoId}-`));

  try {
    const outputTemplate = path.join(tmpDir, '%(id)s');

    const args = [
      '--skip-download',
      '--write-info-json',
      '--write-auto-sub',
      '--sub-lang', 'en',
      '--convert-subs', 'srt',
      '--no-warnings',
      '-o', outputTemplate,
      videoUrl
    ];

    await runYtDlp(args, tmpDir);

    // Read info JSON
    const infoFile = path.join(tmpDir, `${videoId}.info.json`);
    let info = {};
    if (fs.existsSync(infoFile)) {
      try {
        info = JSON.parse(fs.readFileSync(infoFile, 'utf8'));
      } catch {
        info = {};
      }
    }

    // Read transcript (SRT format)
    // yt-dlp names the file as <id>.en.srt or <id>.en-US.srt etc.
    let transcript = null;
    const files = fs.readdirSync(tmpDir);
    const srtFile = files.find(f => f.endsWith('.srt') && f.startsWith(videoId));
    if (srtFile) {
      const raw = fs.readFileSync(path.join(tmpDir, srtFile), 'utf8');
      transcript = parseSrt(raw);
    }

    return {
      video_id: videoId,
      title: info.title || null,
      description: info.description || null,
      thumbnail_url: info.thumbnail || null,
      channel_id: info.channel_id || null,
      channel_name: info.channel || info.uploader || null,
      duration_seconds: info.duration || null,
      published_at: info.upload_date ? formatDate(info.upload_date) : null,
      view_count: info.view_count || null,
      tags: info.tags || [],
      categories: info.categories || [],
      transcript,
      is_short: !!(info.webpage_url?.includes('/shorts/') || info.original_url?.includes('/shorts/'))
    };
  } catch (err) {
    console.error(`yt-dlp failed for ${videoId}:`, err.message);
    return null;
  } finally {
    // Cleanup temp directory
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  }
}

// Parse SRT subtitle file to plain text
function parseSrt(srtContent) {
  if (!srtContent) return null;
  // Remove sequence numbers, timestamps, and empty lines; keep only text
  return srtContent
    .split('\n')
    .filter(line => {
      const trimmed = line.trim();
      if (!trimmed) return false;
      if (/^\d+$/.test(trimmed)) return false; // sequence number
      if (/^\d{2}:\d{2}:\d{2},\d{3} --> \d{2}:\d{2}:\d{2},\d{3}/.test(trimmed)) return false; // timestamp
      return true;
    })
    .join(' ')
    .replace(/<[^>]+>/g, '') // remove HTML tags
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 50000); // cap at 50k chars
}

// Convert yt-dlp upload_date (YYYYMMDD) to ISO datetime
function formatDate(uploadDate) {
  if (!uploadDate || uploadDate.length !== 8) return null;
  return `${uploadDate.slice(0, 4)}-${uploadDate.slice(4, 6)}-${uploadDate.slice(6, 8)}T00:00:00Z`;
}

async function getStreamUrl(videoId) {
  const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
  // Format 18 = 360p progressive mp4, always muxed (video+audio in one stream).
  // It's the only YouTube format guaranteed to have both tracks in a single URL.
  // DASH formats (bestvideo+bestaudio) require merging and can't be streamed directly.
  // HLS manifests from YouTube often separate audio/video as distinct renditions,
  // which some Roku firmware versions don't reassemble correctly.
  const formatSelectors = [
    '18',                                              // 360p muxed mp4 — most compatible
    'best[vcodec!=none][acodec!=none][height<=480][ext=mp4]',  // muxed mp4 <=480p
    'best[vcodec!=none][acodec!=none][height<=720][ext=mp4]',  // muxed mp4 <=720p
    'best[vcodec!=none][acodec!=none][ext=mp4]',               // any muxed mp4
  ];
  for (const fmt of formatSelectors) {
    try {
      const args = ['--no-warnings', '--no-playlist', '-f', fmt, '-g', '--no-check-certificate', videoUrl];
      const { stdout } = await runYtDlp(args);
      // -g returns one URL for muxed formats, two lines for DASH (video\naudio).
      // Only accept single-URL results — two lines means unmuxed DASH.
      const lines = stdout.trim().split('\n').filter(l => l.startsWith('http'));
      if (lines.length === 1) {
        console.log(`[stream] ${videoId} format=${fmt} url=${lines[0].slice(0, 80)}`);
        return { url: lines[0], type: 'mp4' };
      }
      console.warn(`[stream] ${videoId} format=${fmt} returned ${lines.length} URLs (DASH) — skipping`);
    } catch (err) {
      console.warn(`[stream] Format ${fmt} failed for ${videoId}:`, err.message.slice(0, 100));
    }
  }
  throw new Error(`No playable stream found for ${videoId}`);
}

module.exports = { fetchVideoData, getStreamUrl };
