# ☀️ Solora

> Spotify playlist inspector and downloader with direct browser downloads and seamless Navidrome sync.

---

## ⚡ Features

- **Full Playlist Support** — inspects up to 900 tracks per playlist using Spotify's internal spclient API, bypassing the 100-track embed limit
- **Instant Metadata** — per-track 640×640 album art, artist, album, release year via Spotify oEmbed (batches of 10)
- **Real-Time SSE Progress** — live `yt-dlp` download metrics streamed to the browser, no polling
- **High-Fidelity MP3 Tagging** — ID3v2 tags (title, artist, album, year, cover art) embedded via `node-id3`
- **Batch ZIP Download** — select any tracks, download as a single `.zip`
- **Navidrome Direct Sync** — download tagged MP3s straight to your music library folder; triggers an automatic library scan via the Subsonic API
- **6× Parallel Downloads** — concurrent yt-dlp workers for both ZIP and Navidrome jobs
- **Add Individual Tracks** — append any Spotify track URL to the current list on the fly
- **Visual Status** — green glow = downloaded to browser, blue glow = synced to Navidrome

---

## 🛠️ Prerequisites

| Requirement | Version | Notes |
|---|---|---|
| Node.js | v18+ (v20 recommended) | |
| yt-dlp | latest | must be in system `PATH` |
| ffmpeg | any recent | required by yt-dlp for MP3 conversion, must be in `PATH` |

Install yt-dlp:
```bash
# Windows
winget install yt-dlp

# macOS / Linux
brew install yt-dlp
```

---

## 🚀 Quick Start

```bash
git clone https://github.com/your-username/Solora-Web.git
cd Solora-Web
npm install
node main.js        # or: npm start
```

Open `http://localhost:3000` in your browser.

---

## ⚙️ Environment Variables (`.env`)

All variables are optional — everything can also be configured in the web UI.

```ini
PORT=3000

# Server-side default music directory for Navidrome sync
# Can be a local path or a UNC path (\\server\Music)
NAVIDROME_DIR=

# Navidrome server URL — triggers auto library scan after sync
NAVIDROME_URL=http://localhost:4533
NAVIDROME_USER=
NAVIDROME_PASSWORD=

# Token-based auth (optional alternative to password)
NAVIDROME_TOKEN=
NAVIDROME_SALT=
```

---

## 📖 Usage

### 1. Configure (one-time, saved to localStorage)

Click **⚙ Settings** to expand the config panel:

| Field | What to enter |
|---|---|
| Solora Backend | Leave blank if running locally. Enter `http://host:3000` if remote. |
| Navidrome URL | e.g. `http://192.168.1.10:4533` — used to trigger library scans |
| Music Directory | Path where MP3s are written, e.g. `\\192.168.1.10\Music` or `/music` |
| Username / Password | Your Navidrome credentials. Click **Test** to verify. |

### 2. Inspect a Playlist or Track

Paste any public Spotify URL (track, album, or playlist) and click **Inspect**.

- Playlists up to 900 tracks are fully loaded
- Use **+ Add** to append individual track URLs to the current list

### 3. Download or Sync

- **Single track → browser**: click **Download MP3** on the card
- **Single track → Navidrome**: click the **🚀** button on the card
- **Batch → ZIP**: select tracks, click **⚡ Download ZIP** in the bottom bar
- **Batch → Navidrome**: select tracks, click **🚀 Send to Navidrome** in the bottom bar

Batch jobs run 6 tracks in parallel. Progress streams live via SSE.

---

## 🔌 API Endpoints

| Endpoint | Method | Description |
|---|---|---|
| `/api/metadata` | GET | Full track list (up to 900) with cover art and release year |
| `/api/download-track` | GET | Single track download, streamed to browser |
| `/api/zip-start` | POST | SSE — concurrent downloads, emits per-track progress |
| `/api/zip-download/:token` | GET | Serves assembled ZIP after SSE job completes |
| `/api/send-to-navidrome` | POST | SSE — downloads tagged MP3s directly to music directory |
| `/api/navidrome-test` | POST | Tests Navidrome credentials and connectivity |

---

## 📝 License

MIT — designed for personal media archiving and self-hosted streaming.
