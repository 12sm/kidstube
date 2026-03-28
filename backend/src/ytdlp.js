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

module.exports = { fetchVideoData };
