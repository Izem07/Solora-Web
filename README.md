# ☀️ Solora

Self-hosted, local-only audio harvester & Spotify downloader designed to run seamlessly alongside **Navidrome** with the clean **Hylo** dark-and-gold aesthetic.

---

## 🎨 Theme & Aesthetic
- **Background**: `#0A0A0A` (Hylo true dark)
- **Accent**: `#F9CC1B` (Metallic yellow)
- **Typography**: Clean sans-serif, high contrast white headers & muted secondary text
- **Icon**: Solar disc with musical note & soundwave pulse in Hylo gold

---

## 🚀 Quick Start

### 1. Prerequisites
- **Node.js** (v18+) & `npm`
- **Python** (3.8+)
- **spotdl**:
  ```bash
  pip install spotdl
  spotdl --download-ffmpeg
  ```

### 2. Install Node Dependencies
```bash
npm install
```

### 3. Configure Environment
Check or copy `.env`:
```env
PORT=3000
MUSIC_DIR=/path/to/your/navidrome/music
GOOGLE_GENAI_KEY=your_key_here
```
> Note: On Windows, paths can be absolute (e.g. `D:/Music`) or relative (e.g. `./downloads`).

### 4. Run the Server
```bash
npm start
```

Visit [http://localhost:3000](http://localhost:3000) in your browser.
Paste any Spotify track, album, or playlist URL, hit **Download**, and Solora will download and tag the music straight into your Navidrome library folder.
