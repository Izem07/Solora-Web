import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const archiver = require('archiver');
const NodeID3 = require('node-id3');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Navidrome Configuration (Optional server fallback default)
const NAVIDROME_DIR = process.env.NAVIDROME_DIR
  ? path.resolve(process.env.NAVIDROME_DIR)
  : '';

const NAVIDROME_URL = (process.env.NAVIDROME_URL || '').replace(/\/+$/, '');
const NAVIDROME_USER = process.env.NAVIDROME_USER || '';
const NAVIDROME_PASSWORD = process.env.NAVIDROME_PASSWORD || '';
const NAVIDROME_TOKEN = process.env.NAVIDROME_TOKEN || '';
const NAVIDROME_SALT = process.env.NAVIDROME_SALT || '';

if (NAVIDROME_DIR && !fs.existsSync(NAVIDROME_DIR)) {
  try { fs.mkdirSync(NAVIDROME_DIR, { recursive: true }); } catch (e) {}
}

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use(cors());

// Test Navidrome credentials & server connectivity
app.post('/api/navidrome-test', async (req, res) => {
  const { navidromeUrl, user, pass } = req.body;
  const baseUrl = (navidromeUrl || NAVIDROME_URL || '').replace(/\/+$/, '');
  const username = (user || NAVIDROME_USER || '').trim();
  const password = pass !== undefined && pass !== null ? pass : NAVIDROME_PASSWORD;

  if (!baseUrl) {
    return res.status(400).json({ success: false, message: 'Navidrome URL is not configured on the server.' });
  }
  if (!username) {
    return res.status(400).json({ success: false, message: 'Please enter a Navidrome username.' });
  }

  try {
    let pingUrl = `${baseUrl}/rest/ping?v=1.16.1&c=Solora&f=json&u=${encodeURIComponent(username)}`;
    if (password) {
      pingUrl += `&p=${encodeURIComponent(password)}`;
    }

    const response = await fetch(pingUrl, { signal: AbortSignal.timeout(5000) });
    const data = await response.json().catch(() => null);

    if (data?.['subsonic-response']?.status === 'ok') {
      const serverVersion = data['subsonic-response']?.serverVersion || '';
      return res.json({ 
        success: true, 
        message: `Connected successfully! (Navidrome ${serverVersion})` 
      });
    } else {
      const err = data?.['subsonic-response']?.error?.message || 'Invalid username or password';
      return res.status(401).json({ success: false, message: err });
    }
  } catch (err) {
    return res.status(500).json({ success: false, message: `Could not reach Navidrome: ${err.message}` });
  }
});

// ─────────────────────────────────────────────
// Helper: Fetch per-track metadata (cover art, year, album) via oEmbed + embed page
// Operates in parallel batches; fills trackImageMap and trackYearMap in-place.
// ─────────────────────────────────────────────
async function fetchTrackMetaBatch(trackIds, trackImageMap, trackYearMap, collectionCoverArt) {
  const BATCH_SIZE = 10;
  for (let i = 0; i < trackIds.length; i += BATCH_SIZE) {
    const batch = trackIds.slice(i, i + BATCH_SIZE);
    await Promise.all(batch.map(async (trackId) => {
      try {
        // oEmbed → thumbnail (fast, no auth needed)
        const oembedRes = await fetch(
          `https://open.spotify.com/oembed?url=https://open.spotify.com/track/${trackId}`,
          { signal: AbortSignal.timeout(8000) }
        );
        if (oembedRes.ok) {
          const oembedData = await oembedRes.json();
          if (oembedData.thumbnail_url) {
            const hdCover = oembedData.thumbnail_url.replace(/ab67616d0000(1e02|4851)/, 'ab67616d0000b273');
            trackImageMap.set(trackId, hdCover);
          }
        }

        // Embed page → release year + album name
        const trackEmbedRes = await fetch(`https://open.spotify.com/embed/track/${trackId}`, {
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36' },
          signal: AbortSignal.timeout(8000)
        });
        if (trackEmbedRes.ok) {
          const trackHtml = await trackEmbedRes.text();
          const trackScript = trackHtml.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
          if (trackScript) {
            const trackData = JSON.parse(trackScript[1]);
            const trackEntity = trackData.props?.pageProps?.state?.data?.entity;
            const releaseDate = trackEntity?.releaseDate?.isoString || '';
            if (releaseDate) trackYearMap.set(trackId, releaseDate.substring(0, 4));
            if (trackEntity?.album?.name) {
              trackImageMap.set(`album:${trackId}`, trackEntity.album.name);
            }
          }
        }
      } catch (_) { /* silent fallback per track */ }
    }));
  }
}

// ─────────────────────────────────────────────
// Helper: Use Spotify's spclient API to get ALL track URIs for a playlist.
// Requires the anonymous access token embedded in the Spotify embed page HTML.
// Returns an array of track objects: { uri, title, artist, durationMs }
// ─────────────────────────────────────────────
async function fetchAllPlaylistTracksViaSpclient(playlistId, accessToken) {
  const MAX_TRACKS = 900;
  const url = `https://spclient.wg.spotify.com/playlist/v2/playlist/${playlistId}`;
  const response = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'application/json',
      'app-platform': 'WebPlayer',
      'spotify-app-version': '1.0.0'
    },
    signal: AbortSignal.timeout(15000)
  });

  if (!response.ok) {
    throw new Error(`spclient returned ${response.status}`);
  }

  const data = await response.json();

  // spclient returns { contents: { items: [{ uri, attributes: { ... } }, ...] } }
  const items = data?.contents?.items || [];
  const tracks = [];

  for (const item of items) {
    if (tracks.length >= MAX_TRACKS) break;
    const uri = item?.uri || '';
    if (!uri.startsWith('spotify:track:')) continue; // skip local files, episodes, etc.

    const attrs = item?.attributes || {};
    tracks.push({
      uri,
      title: attrs.name || '',
      artist: attrs.artistNames?.join(', ') || '',
      durationMs: attrs.duration || 0,
    });
  }

  return tracks;
}

// ─────────────────────────────────────────────
// 1. Spotify Metadata Endpoint
// ─────────────────────────────────────────────
app.get('/api/metadata', async (req, res) => {
  const { url } = req.query;
  if (!url || !url.includes('spotify.com')) {
    return res.status(400).json({ error: 'Please provide a valid Spotify URL.' });
  }

  try {
    const match = url.match(/spotify\.com\/(track|album|playlist)\/([a-zA-Z0-9]+)/);
    if (!match) return res.status(400).json({ error: 'Could not parse Spotify entity ID from URL.' });

    const [, type, id] = match;
    const embedUrl = `https://open.spotify.com/embed/${type}/${id}`;

    const response = await fetch(embedUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36' }
    });
    if (!response.ok) return res.status(response.status).json({ error: 'Failed to fetch Spotify embed.' });

    const html = await response.text();
    const scriptMatch = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
    if (!scriptMatch) return res.status(500).json({ error: 'Failed to extract Spotify data.' });

    const parsed = JSON.parse(scriptMatch[1]);
    const entity = parsed.props?.pageProps?.state?.data?.entity;
    if (!entity) return res.status(404).json({ error: 'No entity found in Spotify response.' });

    // Anonymous access token — try multiple locations Spotify has used across versions
    const accessToken = parsed.props?.pageProps?.accessToken
      || parsed.props?.pageProps?.state?.accessToken
      || parsed.props?.pageProps?.nonce
      || (() => {
           // Regex fallback: "accessToken":"BQC5na..."
           const m = html.match(/"accessToken"\s*:\s*"([^"]{50,})"/);
           return m ? m[1] : '';
         })()
      || '';

    // Collection-level cover art
    let coverArt = '';
    if (entity.visualIdentity?.image?.length) {
      coverArt = entity.visualIdentity.image[entity.visualIdentity.image.length - 1]?.url || '';
    } else if (entity.coverArt?.sources?.length) {
      coverArt = entity.coverArt.sources[0]?.url || '';
    }

    const collectionTitle = entity.title || entity.name || 'Untitled';
    const embedTrackList  = Array.isArray(entity.trackList) ? entity.trackList : [];

    // ── For playlists: try spclient to get full track list (up to 900) ──
    let rawTrackList = embedTrackList; // fallback to embed's 100
    if (type === 'playlist' && accessToken) {
      try {
        console.log(`[Solora] Fetching full playlist via spclient (token: ${accessToken.substring(0, 20)}...)`);
        const spTracks = await fetchAllPlaylistTracksViaSpclient(id, accessToken);
        if (spTracks.length > embedTrackList.length) {
          console.log(`[Solora] spclient returned ${spTracks.length} tracks (embed had ${embedTrackList.length})`);
          // Convert spclient format → embed-style objects so the rest of the code is unchanged
          rawTrackList = spTracks.map(sp => ({
            uri: sp.uri,
            title: sp.title,
            subtitle: sp.artist,
            duration: sp.durationMs,
            audioPreview: null,
          }));
        } else {
          console.log(`[Solora] spclient returned ${spTracks.length} tracks — using embed list`);
        }
      } catch (spErr) {
        console.warn('[Solora] spclient fallback failed, using embed list:', spErr.message);
      }
    }

    // ── Fetch per-track metadata (cover art, year, album name) via oEmbed ──
    const trackImageMap = new Map();
    const trackYearMap  = new Map();

    if (rawTrackList.length > 0) {
      const validTrackIds = rawTrackList
        .map(t => (t.uri || '').replace('spotify:track:', ''))
        .filter(Boolean);
      await fetchTrackMetaBatch(validTrackIds, trackImageMap, trackYearMap, coverArt);
    }

    // ── Build final track array ──
    let tracks = [];
    if (rawTrackList.length > 0) {
      tracks = rawTrackList.map((t, idx) => {
        const trackUri = t.uri || '';
        const trackId  = trackUri.replace('spotify:track:', '');
        const trackCover = trackImageMap.get(trackId) || coverArt;
        const trackYear  = trackYearMap.get(trackId)  || '';
        const trackAlbum = trackImageMap.get(`album:${trackId}`) || (type === 'album' ? collectionTitle : '');
        return {
          id: trackId || `track-${idx}`,
          title:  t.title    || 'Unknown Title',
          artist: t.subtitle || entity.subtitle || 'Unknown Artist',
          subtitle: t.subtitle || '',
          album: trackAlbum,
          year: trackYear,
          durationMs: t.duration || 0,
          previewUrl: t.audioPreview?.url || null,
          spotifyUrl: trackId ? `https://open.spotify.com/track/${trackId}` : '',
          coverArt: trackCover
        };
      });
    } else {
      // Single track
      const releaseYear = entity.releaseDate?.isoString ? entity.releaseDate.isoString.substring(0, 4) : '';
      tracks = [{
        id,
        title:  entity.title || entity.name || 'Unknown Title',
        artist: entity.subtitle || entity.artists?.map(a => a.name).join(', ') || 'Unknown Artist',
        subtitle: entity.subtitle || '',
        album: entity.album?.name || '',
        year: releaseYear,
        durationMs: entity.duration || 0,
        previewUrl: entity.audioPreview?.url || null,
        spotifyUrl: `https://open.spotify.com/track/${id}`,
        coverArt
      }];
    }

    return res.json({ type, id, title: collectionTitle, subtitle: entity.subtitle || '', coverArt, totalTracks: tracks.length, tracks });
  } catch (err) {
    console.error('[Solora] Metadata error:', err);
    return res.status(500).json({ error: err.message || 'Internal server error.' });
  }
});

// ─────────────────────────────────────────────
// Helper: Download one track via yt-dlp + tag with node-id3
// Returns: { mp3Path }
// ─────────────────────────────────────────────
function downloadTrackWithYtDlp(trackInfo, targetDir, activeProcesses, onProgress) {
  return new Promise(async (resolve, reject) => {
    const title   = (trackInfo.title  || 'Unknown Title').trim();
    const artist  = (trackInfo.artist || 'Unknown Artist').trim();
    const subtitle = trackInfo.subtitle || '';
    const album   = trackInfo.album   || '';
    const year    = trackInfo.year    || '';
    const coverArt = trackInfo.coverArt || '';

    // Sanitize for Windows filenames
    const sanitize = s => s.replace(/[\/\\?%*:|"<>]/g, '').trim();
    const cleanTitle  = sanitize(title);
    const cleanArtist = sanitize(artist);
    const baseName    = `${cleanTitle} - ${cleanArtist}`;
    const searchQuery = `ytsearch1:${cleanTitle} ${cleanArtist} audio`;

    // Use native path separators — yt-dlp handles them fine on Windows
    const outputTemplate = path.join(targetDir, `${baseName}.%(ext)s`);
    const finalMp3Path   = path.join(targetDir, `${baseName}.mp3`);

    const args = [
      '--extract-audio',
      '--audio-format', 'mp3',
      '--audio-quality', '0',
      '--no-playlist',
      '--no-warnings',
      '--newline',        // one progress line per \n — easier to parse
      '-o', outputTemplate,
      searchQuery
    ];

    console.log(`[yt-dlp] Searching: ${searchQuery}`);
    const proc = spawn('yt-dlp', args);
    if (activeProcesses) activeProcesses.push(proc);

    let stderr = '';
    let stdout = '';

    proc.stdout.on('data', d => {
      const chunk = d.toString();
      stdout += chunk;
      // Parse download progress lines like: [download]  46.0% of 4.32MiB ...
      const lines = chunk.split('\n');
      for (const line of lines) {
        const pctMatch = line.match(/\[download\]\s+([\d.]+)%/);
        if (pctMatch && onProgress) {
          onProgress(parseFloat(pctMatch[1]));
        }
      }
    });

    proc.stderr.on('data', d => { stderr += d.toString(); });

    proc.on('close', async (code, signal) => {
      if (activeProcesses) {
        const idx = activeProcesses.indexOf(proc);
        if (idx !== -1) activeProcesses.splice(idx, 1);
      }

      if (signal) {
        return reject(new Error(`yt-dlp killed by signal ${signal}`));
      }

      if (code !== 0) {
        const errMsg = stderr.slice(-300).trim() || stdout.slice(-300).trim() || 'Unknown error';
        return reject(new Error(`yt-dlp exited ${code}: ${errMsg}`));
      }

      // Tag the MP3 with Spotify metadata
      try {
        if (fs.existsSync(finalMp3Path)) {
          const tags = {
            title,
            artist,
            album: album || title,
          };
          if (year)     tags.year    = year;
          if (subtitle) tags.comment = { language: 'eng', text: subtitle };

          if (coverArt) {
            try {
              const imgRes = await fetch(coverArt);
              if (imgRes.ok) {
                const imgBuf = Buffer.from(await imgRes.arrayBuffer());
                tags.image = {
                  mime: 'image/jpeg',
                  type: { id: 3, name: 'front cover' },
                  description: 'Cover',
                  imageBuffer: imgBuf
                };
              }
            } catch (imgErr) {
              console.warn(`[Solora] Cover fetch failed for "${title}":`, imgErr.message);
            }
          }

          NodeID3.write(tags, finalMp3Path);
          console.log(`[yt-dlp] ✓ Tagged: ${baseName}.mp3`);
        } else {
          console.warn(`[yt-dlp] MP3 not found after download: ${finalMp3Path}`);
        }
      } catch (tagErr) {
        console.warn(`[Solora] Tagging error for "${title}":`, tagErr.message);
      }

      resolve({ mp3Path: finalMp3Path });
    });

    proc.on('error', err => {
      if (activeProcesses) {
        const idx = activeProcesses.indexOf(proc);
        if (idx !== -1) activeProcesses.splice(idx, 1);
      }
      reject(err);
    });
  });
}

// ─────────────────────────────────────────────
// Helper: Set SSE headers and return send/keepalive helpers
// ─────────────────────────────────────────────
function setupSSE(res) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const send = (type, data) => {
    try { res.write(`data: ${JSON.stringify({ type, data })}\n\n`); } catch (_) {}
  };

  let closed = false;
  const keepAlive = setInterval(() => {
    if (closed) return;
    try { res.write(': keepalive\n\n'); } catch (_) {}
  }, 5000);

  res.on('close', () => {
    closed = true;
    clearInterval(keepAlive);
  });

  return { send, isClosed: () => closed };
}

// ─────────────────────────────────────────────
// 2. Individual Track Download (SSE progress stream)
// GET /api/download-track-sse?title=...&artist=...
// ─────────────────────────────────────────────
app.get('/api/download-track-sse', (req, res) => {
  const { title, artist, subtitle, album, year, coverArt } = req.query;
  if (!title) return res.status(400).send('Title required');

  const { send, isClosed } = setupSSE(res);
  const jobTempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'solora-single-'));

  send('status', `Searching for "${title}" by ${artist || 'unknown'}...`);
  console.log(`[Solora] Individual download: ${title} - ${artist}`);

  const trackInfo = { title, artist: artist || '', subtitle, album, year, coverArt };

  downloadTrackWithYtDlp(trackInfo, jobTempDir, null, (pct) => {
    if (!isClosed()) send('progress', { pct: Math.round(pct * 0.85) }); // scale to 85% for tagging step
  })
    .then(({ mp3Path }) => {
      if (isClosed()) return;
      send('progress', { pct: 95 });
      send('status', 'Tagging complete. Preparing download...');

      if (!fs.existsSync(mp3Path)) {
        send('error', 'MP3 file not found after download.');
        return res.end();
      }

      const fileName = path.basename(mp3Path);
      const fileSize = fs.statSync(mp3Path).size;

      send('done', { fileName, size: fileSize });
      res.end();
    })
    .catch(err => {
      console.error('[Solora] Single download error:', err.message);
      if (!isClosed()) {
        send('error', err.message);
        res.end();
      }
      try { fs.rmSync(jobTempDir, { recursive: true, force: true }); } catch (_) {}
    });
});

// ─────────────────────────────────────────────
// 3. Serve the downloaded single track file
// GET /api/download-track?title=...&artist=...
// (Blocking endpoint — browser triggers this after SSE confirms done)
// ─────────────────────────────────────────────
app.get('/api/download-track', (req, res) => {
  const { title, artist, subtitle, album, year, coverArt } = req.query;
  if (!title) return res.status(400).send('Track title is required.');

  const jobTempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'solora-job-'));
  console.log(`[Solora] On-demand download: ${title} - ${artist || ''}`);

  downloadTrackWithYtDlp({ title, artist: artist || '', subtitle, album, year, coverArt }, jobTempDir)
    .then(({ mp3Path }) => {
      if (!fs.existsSync(mp3Path)) throw new Error('No audio file produced.');

      const fileName = path.basename(mp3Path);
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(fileName)}"`);
      res.setHeader('Content-Type', 'audio/mpeg');

      const readStream = fs.createReadStream(mp3Path);
      readStream.pipe(res);
      readStream.on('close', () => {
        try { fs.rmSync(jobTempDir, { recursive: true, force: true }); } catch (_) {}
      });
    })
    .catch(err => {
      console.error('[Solora] Download error:', err);
      try { fs.rmSync(jobTempDir, { recursive: true, force: true }); } catch (_) {}
      if (!res.headersSent) res.status(500).send(`Download failed: ${err.message}`);
    });
});

// ─────────────────────────────────────────────
// In-memory ZIP job store
// ─────────────────────────────────────────────
const zipJobs = new Map();

// ─────────────────────────────────────────────
// 4a. ZIP SSE progress stream
// POST /api/zip-start  body: { tracks: [...] }
// ─────────────────────────────────────────────
app.post('/api/zip-start', async (req, res) => {
  const { tracks } = req.body;
  if (!tracks || !Array.isArray(tracks) || tracks.length === 0) {
    return res.status(400).send('No tracks provided.');
  }

  const { send, isClosed } = setupSSE(res);
  const jobToken   = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const jobTempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'solora-zip-'));
  const activeProcesses = [];

  send('status', `Starting download for ${tracks.length} track(s)...`);
  console.log(`[Zip] Job ${jobToken}: ${tracks.length} tracks`);

  try {
    const queue = [...tracks];
    const CONCURRENCY = 6;
    let completedCount = 0;

    const worker = async () => {
      while (queue.length > 0) {
        if (isClosed()) break;
        const track = queue.shift();
        if (!track?.title) continue;

        send('track_start', { id: track.id, title: track.title, artist: track.artist, total: tracks.length, completed: completedCount });
        send('log', `Downloading: ${track.title} - ${track.artist || ''}`);

        try {
          await downloadTrackWithYtDlp(track, jobTempDir, activeProcesses, (pct) => {
            if (!isClosed()) {
              send('track_progress', { id: track.id, pct: Math.round(pct) });
            }
          });
          completedCount++;
          send('track_done', { id: track.id, title: track.title, completed: completedCount, total: tracks.length });
          send('log', `✓ Done: ${track.title} (${completedCount}/${tracks.length})`);
        } catch (err) {
          completedCount++;
          send('track_fail', { id: track.id, title: track.title, completed: completedCount, total: tracks.length, error: err.message });
          send('log', `⚠ Failed: ${track.title}: ${err.message}`);
        }
      }
    };

    const workers = Array.from({ length: Math.min(CONCURRENCY, tracks.length) }, () => worker());
    await Promise.all(workers);

    const files = fs.readdirSync(jobTempDir).filter(f => /\.(mp3|m4a|flac|ogg|opus|wav)$/i.test(f));
    if (files.length === 0) {
      send('error', 'No tracks could be downloaded.');
      try { fs.rmSync(jobTempDir, { recursive: true, force: true }); } catch (_) {}
      return res.end();
    }

    zipJobs.set(jobToken, { dir: jobTempDir, files, createdAt: Date.now() });

    // Auto-expire after 10 minutes
    setTimeout(() => {
      if (zipJobs.has(jobToken)) {
        const job = zipJobs.get(jobToken);
        zipJobs.delete(jobToken);
        try { fs.rmSync(job.dir, { recursive: true, force: true }); } catch (_) {}
      }
    }, 10 * 60 * 1000);

    send('done', { token: jobToken, count: files.length });
    res.end();
  } catch (err) {
    console.error('[Zip] Error:', err);
    send('error', err.message);
    try { fs.rmSync(jobTempDir, { recursive: true, force: true }); } catch (_) {}
    res.end();
  }
});

// ─────────────────────────────────────────────
// 4b. ZIP download endpoint
// GET /api/zip-download/:token
// ─────────────────────────────────────────────
app.get('/api/zip-download/:token', async (req, res) => {
  const job = zipJobs.get(req.params.token);
  if (!job) return res.status(404).send('ZIP job not found or expired.');

  zipJobs.delete(req.params.token);

  res.attachment('Solora_Music_Bundle.zip');
  const archive = archiver('zip', { zlib: { level: 1 } });
  archive.on('error', err => {
    console.error('[Zip] Archive error:', err);
    if (!res.headersSent) res.status(500).send(err.message);
  });
  archive.pipe(res);

  job.files.forEach(file => {
    archive.file(path.join(job.dir, file), { name: file });
  });

  await archive.finalize();

  res.on('finish', () => {
    try { fs.rmSync(job.dir, { recursive: true, force: true }); } catch (_) {}
    console.log(`[Zip] Job ${req.params.token} served.`);
  });
});

// ─────────────────────────────────────────────
// 5. Send to Navidrome — SSE progress stream
// POST /api/send-to-navidrome  body: { tracks, destinationDir, navidromeUser, navidromePass, navidromeUrl }
// ─────────────────────────────────────────────
app.post('/api/send-to-navidrome', async (req, res) => {
  const { tracks, destinationDir, navidromeUser, navidromePass, navidromeUrl } = req.body;
  if (!tracks || !Array.isArray(tracks) || tracks.length === 0) {
    return res.status(400).send('No tracks provided.');
  }

  const targetDir = destinationDir ? path.resolve(destinationDir) : NAVIDROME_DIR;
  if (!targetDir) {
    return res.status(400).send('Please set your Navidrome Music Directory in the settings.');
  }

  if (!fs.existsSync(targetDir)) {
    try { fs.mkdirSync(targetDir, { recursive: true }); }
    catch (err) { return res.status(400).send(`Cannot create directory: ${targetDir} (${err.message})`); }
  }

  const { send, isClosed } = setupSSE(res);
  const activeProcesses = [];

  send('status', `Sending ${tracks.length} track(s) to ${targetDir}...`);
  console.log(`[Navidrome] ${tracks.length} tracks → ${targetDir}`);

  const queue = [...tracks];
  const CONCURRENCY = 6;
  let succeeded = 0;
  let failed = 0;
  let completedCount = 0;

  const worker = async () => {
    while (queue.length > 0) {
      if (isClosed()) break;
      const track = queue.shift();
      if (!track?.title) continue;

      send('track_start', { id: track.id, title: track.title, artist: track.artist, total: tracks.length, completed: completedCount });
      send('log', `Downloading: ${track.title} - ${track.artist || ''}`);

      try {
        await downloadTrackWithYtDlp(track, targetDir, activeProcesses, (pct) => {
          if (!isClosed()) send('track_progress', { id: track.id, pct: Math.round(pct) });
        });
        succeeded++;
        completedCount++;
        send('track_done', { id: track.id, title: track.title, completed: completedCount, total: tracks.length });
        send('log', `✓ Done: ${track.title} (${completedCount}/${tracks.length})`);
      } catch (err) {
        failed++;
        completedCount++;
        send('track_fail', { id: track.id, title: track.title, completed: completedCount, total: tracks.length, error: err.message });
        send('log', `⚠ Failed: ${track.title}: ${err.message}`);
      }
    }
  };

  const workers = Array.from({ length: Math.min(CONCURRENCY, tracks.length) }, () => worker());
  await Promise.all(workers);

  // Trigger Navidrome library scan if credentials provided via UI or .env
  let scanTriggered = false;
  const user    = (navidromeUser || NAVIDROME_USER || '').trim();
  const pass    = (navidromePass !== undefined && navidromePass !== null && navidromePass !== '') ? navidromePass : NAVIDROME_PASSWORD;
  const baseUrl = (navidromeUrl  || NAVIDROME_URL  || '').replace(/\/+$/, '');

  if (baseUrl && user) {
    try {
      let scanUrl = `${baseUrl}/rest/startScan?v=1.16.1&c=Solora&f=json`;
      if (NAVIDROME_TOKEN && NAVIDROME_SALT) {
        scanUrl += `&u=${encodeURIComponent(user)}&t=${encodeURIComponent(NAVIDROME_TOKEN)}&s=${encodeURIComponent(NAVIDROME_SALT)}`;
      } else if (pass) {
        scanUrl += `&u=${encodeURIComponent(user)}&p=${encodeURIComponent(pass)}`;
      } else {
        scanUrl += `&u=${encodeURIComponent(user)}`;
      }

      console.log(`[Navidrome] Requesting library scan at ${scanUrl.replace(/p=[^&]+/, 'p=***')}`);
      const scanRes = await fetch(scanUrl, { signal: AbortSignal.timeout(6000) });
      const scanData = await scanRes.json().catch(() => null);
      if (scanRes.ok && scanData?.['subsonic-response']?.status === 'ok') {
        scanTriggered = true;
        send('log', '✓ Navidrome library scan started successfully');
      } else {
        const errorMsg = scanData?.['subsonic-response']?.error?.message || `HTTP ${scanRes.status}`;
        send('log', `⚠ Navidrome scan notice: ${errorMsg}`);
      }
    } catch (e) {
      console.warn('[Navidrome] Scan trigger failed:', e.message);
      send('log', `⚠ Navidrome scan trigger error: ${e.message}`);
    }
  }

  send('done', { succeeded, failed, total: tracks.length, scanTriggered, targetDir });
  res.end();
});

// ─────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`☀️  Solora running at http://localhost:${PORT}`);
  if (NAVIDROME_DIR) console.log(`📁 Navidrome default dir: ${NAVIDROME_DIR}`);
});
