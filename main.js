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

app.use(express.static(path.join(__dirname, 'public'), {
  etag: false,
  maxAge: 0,
  lastModified: true,
  setHeaders: (res) => {
    // Never cache — ensures the browser always loads fresh code after edits
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  }
}));
app.use(express.json());
app.use(cors());

// Test Navidrome credentials & server connectivity
app.post('/api/navidrome-test', async (req, res) => {
  const { navidromeUrl, user, pass } = req.body;
  const baseUrl = (navidromeUrl || NAVIDROME_URL || '').replace(/\/+$/, '');
  const username = (user || NAVIDROME_USER || '').trim();
  const password = pass !== undefined && pass !== null ? pass : NAVIDROME_PASSWORD;

  if (!baseUrl) {
    return res.status(400).json({ success: false, message: 'Navidrome URL is not configured. Enter it in Settings (e.g. http://192.168.1.10:4533).' });
  }

  // Catch UNC paths (\\server\share) or plain directory paths being put in the URL field
  if (!baseUrl.startsWith('http://') && !baseUrl.startsWith('https://')) {
    return res.status(400).json({ success: false, message: `"${baseUrl}" looks like a file path, not a URL. Navidrome URL should start with http:// (e.g. http://100.68.222.8:4533).` });
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
    const match = url.match(/spotify\.com\/(track|album|playlist|episode|show)\/([a-zA-Z0-9]+)/);
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

    // ── Episode: single podcast episode ──
    if (type === 'episode') {
      const releaseYear = entity.releaseDate?.isoString?.substring(0, 4) || '';
      const rawShowName = entity.podcastV2?.data?.name || entity.show?.name || entity.subtitle || '';
      const isPunctuation = s => /^[\s._\-–—•·*#~]+$/.test(s.trim());
      const cleanShow = (rawShowName && !isPunctuation(rawShowName)) ? rawShowName.trim() : '';
      const rawTitle = entity.title || entity.name || 'Unknown Episode';

      // Parse "Title - Artist" (or "Song - Sub - Artist")
      const dashMatch = rawTitle.match(/^(.*)\s*[-–—]\s*([^–—\-]+)$/);
      let title = rawTitle;
      let artist = cleanShow || 'Unknown Artist';

      if (dashMatch) {
        title = dashMatch[1].trim();
        artist = dashMatch[2].trim();
      }

      // Avoid showing junk like "." or duplicate artist as album
      const album = (cleanShow && cleanShow !== artist) ? cleanShow : '';

      const episodeTrack = {
        id,
        title,
        artist,
        subtitle:   artist,
        album,
        year:       releaseYear,
        durationMs: entity.duration || 0,
        previewUrl: entity.audioPreview?.url || null,
        spotifyUrl: `https://open.spotify.com/episode/${id}`,
        coverArt,
        isEpisode:  true
      };
      return res.json({ 
        type, 
        id, 
        title: episodeTrack.title, 
        subtitle: artist, 
        coverArt, 
        totalTracks: 1, 
        tracks: [episodeTrack] 
      });
    }

    // ── Show: podcast show (list of recent episodes) ──
    if (type === 'show') {
      const isPunctuation = s => /^[\s._\-–—•·*#~]+$/.test(s.trim());
      const cleanShow = (collectionTitle && !isPunctuation(collectionTitle)) ? collectionTitle.trim() : '';
      const episodes = embedTrackList.map((ep, idx) => {
        const epUri = ep.uri || '';
        const epId  = epUri.replace('spotify:episode:', '');
        const epTitle = ep.title || 'Unknown Episode';
        const dashMatch = epTitle.match(/^(.*)\s*[-–—]\s*([^–—\-]+)$/);
        const title = dashMatch ? dashMatch[1].trim() : epTitle;
        const artist = dashMatch ? dashMatch[2].trim() : (cleanShow || 'Unknown Show');
        const album = (cleanShow && cleanShow !== artist) ? cleanShow : '';

        return {
          id:         epId || `ep-${idx}`,
          title,
          artist,
          subtitle:   artist,
          album,
          year:       '',
          durationMs: ep.duration || 0,
          previewUrl: ep.audioPreview?.url || null,
          spotifyUrl: epId ? `https://open.spotify.com/episode/${epId}` : '',
          coverArt,
          isEpisode:  true
        };
      });
      return res.json({ type, id, title: collectionTitle, subtitle: cleanShow || '', coverArt, totalTracks: episodes.length, tracks: episodes });
    }

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
      const isPunctuation = s => /^[\s._\-–—•·*#~]+$/.test(s.trim());
      const rawTitle = entity.title || entity.name || 'Unknown Title';
      let title = rawTitle;
      let rawArtist = entity.subtitle || entity.artists?.map(a => a.name).join(', ') || '';
      let artist = (rawArtist && !isPunctuation(rawArtist)) ? rawArtist.trim() : '';

      // If artist was punctuation/empty and title has " - ", extract artist from title
      if (!artist || artist === 'Unknown Artist') {
        const dashMatch = rawTitle.match(/^(.*)\s*[-–—]\s*([^–—\-]+)$/);
        if (dashMatch) {
          title = dashMatch[1].trim();
          artist = dashMatch[2].trim();
        } else {
          artist = 'Unknown Artist';
        }
      }

      const rawAlbum = entity.album?.name || '';
      const album = (rawAlbum && !isPunctuation(rawAlbum)) ? rawAlbum.trim() : '';

      tracks = [{
        id,
        title,
        artist,
        subtitle: artist,
        album,
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
// Helper: Fallback download via spotdl
// Used when yt-dlp produces no file (bot-detection / 429)
// ─────────────────────────────────────────────
function downloadWithSpotdl(trackInfo, targetDir, activeProcesses) {
  return new Promise((resolve, reject) => {
    const spotifyUrl = trackInfo.spotifyUrl || '';
    if (!spotifyUrl) return reject(new Error('No Spotify URL for spotdl fallback'));

    console.log(`[spotdl] Falling back for: ${trackInfo.title} — ${trackInfo.artist}`);

    const args = [
      'download',
      spotifyUrl,
      '--output', path.join(targetDir, '{title}.{output-ext}'),
      '--format', 'mp3',
      '--bitrate', '320k',
      '--overwrite', 'skip',
      '--log-level', 'ERROR',
    ];

    const proc = spawn('spotdl', args);
    if (activeProcesses) activeProcesses.push(proc);

    let stderr = '';
    let stdout = '';
    let timedOut = false;
    proc.stdout.on('data', d => { stdout += d.toString(); });
    proc.stderr.on('data', d => { stderr += d.toString(); });

    // Hard timeout so spotdl can't hang forever on bot-blocked tracks
    const timer = setTimeout(() => {
      timedOut = true;
      try { proc.kill('SIGKILL'); } catch (_) {}
    }, 90_000);

    proc.on('close', (code, signal) => {
      clearTimeout(timer);
      if (activeProcesses) {
        const idx = activeProcesses.indexOf(proc);
        if (idx !== -1) activeProcesses.splice(idx, 1);
      }
      if (timedOut) return reject(new Error('spotdl timed out after 90s (likely YouTube bot-block)'));
      if (signal) return reject(new Error(`spotdl killed by signal ${signal}`));
      if (code !== 0) {
        const errMsg = stderr.slice(-300).trim() || stdout.slice(-300).trim() || 'Unknown spotdl error';
        return reject(new Error(`spotdl exited ${code}: ${errMsg}`));
      }

      // Find the MP3 spotdl wrote
      try {
        const mp3s = fs.readdirSync(targetDir).filter(f => f.toLowerCase().endsWith('.mp3'));
        if (mp3s.length > 0) {
          const title = (trackInfo.title || '').toLowerCase();
          const best = mp3s.find(f => f.toLowerCase().includes(title)) || mp3s[0];
          return resolve({ mp3Path: path.join(targetDir, best) });
        }
      } catch (_) {}

      reject(new Error('spotdl produced no MP3 file'));
    });

    proc.on('error', err => {
      clearTimeout(timer);
      if (activeProcesses) {
        const idx = activeProcesses.indexOf(proc);
        if (idx !== -1) activeProcesses.splice(idx, 1);
      }
      reject(err);
    });
  });
}

// ─────────────────────────────────────────────
// Helper: Download one track via yt-dlp + tag with node-id3
// Falls back to spotdl if yt-dlp produces no file.
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
    let cleanTitle  = sanitize(title) || 'Unknown Title';
    const cleanArtist = sanitize(artist);

    // Remove trailing artist if present in the title (e.g. "Song - Artist" or "Song -Artist")
    if (cleanArtist) {
      const artistPattern = new RegExp(`\\s*-\\s*${cleanArtist.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
      cleanTitle = cleanTitle.replace(artistPattern, '').trim() || cleanTitle;
    }

    const baseName    = cleanTitle;

    // Detect podcast episodes by spotifyUrl or explicit flag
    const isEpisode = !!(trackInfo.isEpisode || (trackInfo.spotifyUrl || '').includes('/episode/'));
    const searchQuery = isEpisode
      ? `ytsearch1:${cleanTitle} ${cleanArtist}`
      : `ytsearch1:${cleanTitle} ${cleanArtist} audio`;

    // Use native path separators — yt-dlp handles them fine on Windows
    const outputTemplate = path.join(targetDir, `${baseName}.%(ext)s`);
    const finalMp3Path   = path.join(targetDir, `${baseName}.mp3`);

    // Build yt-dlp args — use cookies.txt if present (fixes YouTube bot-detection)
    const cookiesPath = path.join(__dirname, 'cookies.txt');
    const hasCookies  = fs.existsSync(cookiesPath);

    const args = [
      '--extract-audio',
      '--audio-format', 'mp3',
      '--audio-quality', '0',
      '--no-playlist',
      '--no-warnings',
      '--newline',
      '--socket-timeout', '30',
      ...(hasCookies ? ['--cookies', cookiesPath] : []),
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
        if (isEpisode) {
          return reject(new Error(`yt-dlp failed: ${errMsg.split('\n')[0]}`));
        }
        console.warn(`[yt-dlp] Exited ${code}: ${errMsg} — trying spotdl fallback`);
        try {
          const result = await downloadWithSpotdl(trackInfo, targetDir, activeProcesses);
          return resolve({ mp3Path: result.mp3Path, usedSpotdl: true });
        } catch (spotErr) {
          console.warn(`[spotdl] Fallback also failed: ${spotErr.message}`);
          return reject(new Error(`yt-dlp (${errMsg.split('\n')[0]}) and spotdl (${spotErr.message.split('\n')[0]}) both failed`));
        }
      }

      // Scan the target dir for the actual output file — yt-dlp may sanitize
      // the filename differently from our baseName prediction.
      let foundMp3 = null;
      try {
        const files = fs.readdirSync(targetDir);
        // Prefer exact match, then any new MP3 in the dir
        const mp3s = files.filter(f => f.toLowerCase().endsWith('.mp3'));
        if (mp3s.length > 0) {
          // Pick the one most similar to baseName, fallback to first
          const exact = mp3s.find(f => f.toLowerCase().startsWith(cleanTitle.toLowerCase()));
          foundMp3 = path.join(targetDir, exact || mp3s[0]);
        }
      } catch (_) {}

      if (!foundMp3) {
        if (isEpisode) {
          return reject(new Error('yt-dlp produced no audio file for episode'));
        }
        console.warn(`[yt-dlp] No MP3 found in ${targetDir} — trying spotdl fallback`);
        try {
          const result = await downloadWithSpotdl(trackInfo, targetDir, activeProcesses);
          return resolve({ mp3Path: result.mp3Path, usedSpotdl: true });
        } catch (spotErr) {
          console.warn(`[spotdl] Fallback also failed: ${spotErr.message}`);
          return reject(new Error(`yt-dlp and spotdl both failed. yt-dlp: no file produced. spotdl: ${spotErr.message}`));
        }
      }

      const finalMp3Path = foundMp3;

      // Tag the MP3 with Spotify metadata
      try {
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
        console.log(`[yt-dlp] ✓ Tagged: ${path.basename(finalMp3Path)}`);
      } catch (tagErr) {
        console.warn(`[Solora] Tagging error for "${title}":`, tagErr.message);
      }

      resolve({ mp3Path: finalMp3Path, usedSpotdl: false });
    });

    proc.on('error', async (err) => {
      if (activeProcesses) {
        const idx = activeProcesses.indexOf(proc);
        if (idx !== -1) activeProcesses.splice(idx, 1);
      }
      console.warn(`[yt-dlp] Spawn failed: ${err.message} — trying spotdl fallback`);
      try {
        const result = await downloadWithSpotdl(trackInfo, targetDir, activeProcesses);
        return resolve({ mp3Path: result.mp3Path, usedSpotdl: true });
      } catch (spotErr) {
        reject(new Error(`yt-dlp spawn failed (${err.message}) and spotdl also failed (${spotErr.message})`));
      }
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
  const { title, artist, subtitle, album, year, coverArt, spotifyUrl } = req.query;
  if (!title) return res.status(400).send('Title required');

  const { send, isClosed } = setupSSE(res);
  const jobTempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'solora-single-'));
  const activeProcesses = [];

  // Kill the download process if the client cancels
  res.on('close', () => {
    activeProcesses.forEach(p => { try { p.kill('SIGKILL'); } catch (_) {} });
  });

  send('status', `Searching for "${title}" by ${artist || 'unknown'}...`);
  console.log(`[Solora] Individual download: ${title} - ${artist}`);

  const trackInfo = { title, artist: artist || '', subtitle, album, year, coverArt, spotifyUrl };

  downloadTrackWithYtDlp(trackInfo, jobTempDir, activeProcesses, (pct) => {
    if (!isClosed()) send('progress', { pct: Math.round(pct * 0.85) }); // scale to 85% for tagging step
  })
    .then(({ mp3Path, usedSpotdl }) => {
      if (isClosed()) return;
      if (usedSpotdl) send('fallback', { tool: 'spotdl', title });
      send('progress', { pct: 95 });
      send('status', 'Tagging complete. Preparing download...');

      // Helper guarantees mp3Path exists on resolve — but guard anyway
      if (!mp3Path || !fs.existsSync(mp3Path)) {
        send('error', 'Download produced no file (yt-dlp + spotdl both failed). Check cookies.txt for YouTube bot-detection.');
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
  const { title, artist, subtitle, album, year, coverArt, spotifyUrl } = req.query;
  if (!title) return res.status(400).send('Track title is required.');

  const jobTempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'solora-job-'));
  const activeProcesses = [];
  console.log(`[Solora] On-demand download: ${title} - ${artist || ''}`);

  // Kill the download process if the client aborts the request
  res.on('close', () => {
    activeProcesses.forEach(p => { try { p.kill('SIGKILL'); } catch (_) {} });
  });

  downloadTrackWithYtDlp({ title, artist: artist || '', subtitle, album, year, coverArt, spotifyUrl }, jobTempDir, activeProcesses)
    .then(({ mp3Path, usedSpotdl }) => {
      // Helper guarantees mp3Path exists on resolve
      if (!mp3Path || !fs.existsSync(mp3Path)) {
        throw new Error('Download produced no file (yt-dlp + spotdl both failed). Check cookies.txt for YouTube bot-detection.');
      }

      const fileName = path.basename(mp3Path);
      if (usedSpotdl) res.setHeader('X-Solora-Fallback', 'spotdl');
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

  // Kill any running yt-dlp/spotdl processes if the client cancels
  res.on('close', () => {
    activeProcesses.forEach(p => { try { p.kill('SIGKILL'); } catch (_) {} });
  });

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
          const result = await downloadTrackWithYtDlp(track, jobTempDir, activeProcesses, (pct) => {
            if (!isClosed()) {
              send('track_progress', { id: track.id, pct: Math.round(pct) });
            }
          });
          if (result?.usedSpotdl && !isClosed()) {
            send('fallback', { tool: 'spotdl', title: track.title });
          }
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

  // Kill any running yt-dlp/spotdl processes if the client cancels
  res.on('close', () => {
    activeProcesses.forEach(p => { try { p.kill('SIGKILL'); } catch (_) {} });
  });

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
        const result = await downloadTrackWithYtDlp(track, targetDir, activeProcesses, (pct) => {
          if (!isClosed()) send('track_progress', { id: track.id, pct: Math.round(pct) });
        });
        if (result?.usedSpotdl && !isClosed()) {
          send('fallback', { tool: 'spotdl', title: track.title });
        }
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
  await new Promise(r => setTimeout(r, 100));
  res.end();
});

// ─────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`☀️  Solora running at http://localhost:${PORT}`);
  if (NAVIDROME_DIR) console.log(`📁 Navidrome default dir: ${NAVIDROME_DIR}`);
});
