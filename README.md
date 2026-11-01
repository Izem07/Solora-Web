# ☀️ Solora

> Modern, lightweight Spotify inspection and downloading tool with direct browser downloads and seamless Navidrome integration.

---

## ⚡ Highlights

- **Instant Metadata Extraction**: Inspects public Spotify playlists, albums, or individual tracks via embed endpoints with per-track 640x640 album art, artist, title, album, and release year.
- **Custom Track Queuing**: Inspect an entire playlist and append individual tracks on the fly using the **+ Add** row.
- **Real-Time Progress Streaming**: Powered by Server-Sent Events (SSE) that reflect actual `yt-dlp` download metrics—no simulated timers.
- **High-Fidelity MP3 Tagging**: Embeds complete ID3v2 tags (title, artist, album, year, comment/subtitle, high-res front cover) directly into the MP3 using `node-id3`.
- **🚀 Navidrome Direct Sync**: Send individual songs or batches directly into your user-specified Navidrome music library (local directory or network share like `\\server\Music`), with automatic library scan triggering via the Subsonic API.
- **⚡ Batch ZIP Downloads**: Download any selection of tracks bundled into a single ZIP archive.
- **Vivid Visual Status**:
  - 🟢 **Green glow & border**: Downloaded to browser.
  - 🔵 **Blue glow & border**: Synced to Navidrome.
  - Live per-track mini progress indicators on active cards.

---

## 🛠️ Prerequisites

1. **Node.js**: v18+ (v20+ recommended)
2. **yt-dlp**: Must be installed and accessible in your system `PATH`.
   - Windows (winget): `winget install yt-dlp`
   - Linux / macOS: `brew install yt-dlp` or via package manager
3. **ffmpeg**: Required by `yt-dlp` for audio extraction and MP3 conversion (`ffmpeg` must be in `PATH`).

---

## 🚀 Quick Start

### 1. Clone & Install Dependencies

```bash
git clone https://github.com/your-username/Solora-Web.git
cd Solora-Web
npm install
```

### 2. Environment Configuration (Optional)

Create or edit `.env` in the root folder:

```ini
# Port to run the web server on
PORT=3000

# Optional default server-side Navidrome music directory
# Note: You can also specify/override this dynamically in the Web UI
NAVIDROME_DIR=

# Navidrome Subsonic API credentials (triggers automatic scan after sync)
NAVIDROME_URL=http://localhost:4533
NAVIDROME_USER=
NAVIDROME_PASSWORD=
NAVIDROME_TOKEN=
NAVIDROME_SALT=
```

### 3. Launch the Server

```bash
npm start
# or
node main.js
```

Open your browser and navigate to:
```text
http://localhost:3000
```

---

## 📖 Usage Guide

### 1. Inspect Music
- Paste any public Spotify playlist, album, or track URL into the main input field.
- Click **Inspect** (or press Enter).
- All tracks will load with individual album art, duration, and metadata.

### 2. Add Individual Tracks to the Queue
- After inspecting a playlist or album, an **Add Track** row will appear beneath the search bar.
- Paste any single Spotify track URL (`https://open.spotify.com/track/...`) and click **+ Add** or press Enter.
- The track will appear at the bottom of your active list with a flash highlight.

### 3. Downloading Tracks

- **Single Track (Browser)**: Click **Download MP3** on any track card.
- **Single Track (Navidrome)**: Click the **🚀** rocket button on any track card to sync directly to your configured music folder.
- **Batch Download (.zip)**: Select checkboxes for the desired tracks (or click **Select All**) and click **⚡ Download Selected (.zip)** on the floating bottom bar.
- **Batch Navidrome Sync**: Select the tracks and click **🚀 Send to Navidrome** on the floating action bar. Tracks will download concurrently (3 at a time) directly to your library.

---

## ⚙️ Architecture & Endpoints

| Endpoint | Method | Description |
|---|---|---|
| `/api/metadata` | `GET` | Fetches track details, per-track cover art (upgraded to 640x640), and release years. |
| `/api/download-track` | `GET` | On-demand single track download streamed directly to browser with automatic temp cleanup. |
| `/api/zip-start` | `POST` | SSE endpoint managing concurrent `yt-dlp` downloads, emitting real-time progress events. |
| `/api/zip-download/:token` | `GET` | Serves the assembled ZIP package after SSE job completion. |
| `/api/send-to-navidrome` | `POST` | SSE endpoint downloading tagged individual MP3s directly into user's designated music directory. |

---

## 📝 License

MIT License. Designed and maintained for personal media archiving and self-hosted streaming setups.
