const inspectBtn         = document.getElementById('inspectBtn');
const urlInput           = document.getElementById('urlInput');
const serverInput        = document.getElementById('serverUrl');
const navidromeDirInput  = document.getElementById('navidromeDirInput');
const navidromeUrlInput  = document.getElementById('navidromeUrlInput');
const navidromeUserInput = document.getElementById('navidromeUserInput');
const navidromePassInput = document.getElementById('navidromePassInput');
const testNavidromeBtn   = document.getElementById('testNavidromeBtn');
const navidromeStatus    = document.getElementById('navidromeStatus');
const trackList          = document.getElementById('trackList');
const collectionHeader   = document.getElementById('collectionHeader');
const selectionToolbar   = document.getElementById('selectionToolbar');
const selectAllCheckbox  = document.getElementById('selectAllCheckbox');
const selectedCountBadge = document.getElementById('selectedCountBadge');
const floatingActionBar  = document.getElementById('floatingActionBar');
const floatingSelectedText = document.getElementById('floatingSelectedText');
const downloadSelectedZipBtn = document.getElementById('downloadSelectedZipBtn');
const sendToNavidromeBtn = document.getElementById('sendToNavidromeBtn');
const toastNotification  = document.getElementById('toastNotification');
const toggleTerminalBtn  = document.getElementById('toggleTerminalBtn');
const terminalBody       = document.getElementById('terminalBody');
const terminalLogs       = document.getElementById('terminalLogs');
const progressSection    = document.getElementById('progressSection');
const progressBarFill    = document.getElementById('progressBarFill');
const progressStatusText = document.getElementById('progressStatusText');
const cancelBtn          = document.getElementById('cancelBtn');
const addTrackRow        = document.getElementById('addTrackRow');
const addTrackInput      = document.getElementById('addTrackInput');
const addTrackBtn        = document.getElementById('addTrackBtn');
const settingsToggle     = document.getElementById('settingsToggle');
const settingsBody       = document.getElementById('settingsBody');

// ─────────────────────────────────────────────────
// Settings panel toggle
// ─────────────────────────────────────────────────
if (settingsToggle && settingsBody) {
  // Auto-open if no Navidrome URL has been saved yet (first run)
  const hasNavUrl = !!(localStorage.getItem('solora_navidrome_url') || '');
  if (!hasNavUrl) settingsBody.classList.remove('hidden');

  settingsToggle.addEventListener('click', () => {
    const hidden = settingsBody.classList.toggle('hidden');
    settingsToggle.classList.toggle('open', !hidden);
  });
}

let currentTracks     = [];
let currentSourceUrl  = '';
const selectedTrackIds  = new Set();
const downloadedTrackIds = new Set();
let isSingleDownloading = false;

// ─────────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────────
function escapeHtml(text) {
  if (!text) return '';
  const d = document.createElement('div');
  d.textContent = text;
  return d.innerHTML;
}

function formatDuration(ms) {
  if (!ms) return '--:--';
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function logActivity(msg) {
  if (!terminalLogs) return;
  terminalLogs.textContent += `${msg}\n`;
  terminalLogs.scrollTop = terminalLogs.scrollHeight;
}

function showToast(message, duration = 4500) {
  if (!toastNotification) return;
  toastNotification.textContent = message;
  toastNotification.classList.remove('hidden');
  clearTimeout(toastNotification._timer);
  toastNotification._timer = setTimeout(() => toastNotification.classList.add('hidden'), duration);
}

function setProgress(pct, statusText) {
  progressBarFill.style.width = `${Math.min(100, Math.max(0, pct))}%`;
  if (statusText !== undefined) progressStatusText.textContent = statusText;
}

function showProgress(statusText) {
  progressSection.classList.remove('hidden');
  setProgress(0, statusText);
}

function hideProgress(delay = 2200) {
  setTimeout(() => {
    progressSection.classList.add('hidden');
    setProgress(0);
  }, delay);
}

// ─────────────────────────────────────────────────
// Mark downloaded track card with green border
// ─────────────────────────────────────────────────
function markTrackAsDownloaded(trackId) {
  downloadedTrackIds.add(trackId);
  const card = document.getElementById(`card-${trackId}`);
  if (!card) return;
  card.classList.add('downloaded');
  const btn = card.querySelector('.btn-download-action');
  if (btn) {
    btn.classList.remove('downloading');
    btn.classList.add('downloaded');
    btn.innerHTML = '✓ Downloaded';
    btn.disabled = false;
  }
}

// ─────────────────────────────────────────────────
// Terminal toggle
// ─────────────────────────────────────────────────
if (toggleTerminalBtn && terminalBody) {
  toggleTerminalBtn.addEventListener('click', () => {
    const hidden = terminalBody.classList.toggle('hidden');
    toggleTerminalBtn.classList.toggle('open', !hidden);
  });
}

// ─────────────────────────────────────────────────
// Server URL & Navidrome dir persistence
// ─────────────────────────────────────────────────
if (serverInput) {
  serverInput.value = localStorage.getItem('solora_server_url') || '';
  serverInput.addEventListener('change', () => {
    const v = serverInput.value.trim().replace(/\/+$/, '');
    v ? localStorage.setItem('solora_server_url', v) : localStorage.removeItem('solora_server_url');
  });
}

if (navidromeDirInput) {
  navidromeDirInput.value = localStorage.getItem('solora_navidrome_dir') || '';
  navidromeDirInput.addEventListener('change', () => {
    const v = navidromeDirInput.value.trim();
    v ? localStorage.setItem('solora_navidrome_dir', v) : localStorage.removeItem('solora_navidrome_dir');
  });
}

if (navidromeUrlInput) {
  navidromeUrlInput.value = localStorage.getItem('solora_navidrome_url') || '';
  navidromeUrlInput.addEventListener('change', () => {
    const v = navidromeUrlInput.value.trim().replace(/\/+$/, '');
    v ? localStorage.setItem('solora_navidrome_url', v) : localStorage.removeItem('solora_navidrome_url');
  });
}

if (navidromeUserInput) {
  navidromeUserInput.value = localStorage.getItem('solora_navidrome_user') || '';
  navidromeUserInput.addEventListener('change', () => {
    const v = navidromeUserInput.value.trim();
    v ? localStorage.setItem('solora_navidrome_user', v) : localStorage.removeItem('solora_navidrome_user');
  });
}

if (navidromePassInput) {
  navidromePassInput.value = localStorage.getItem('solora_navidrome_pass') || '';
  navidromePassInput.addEventListener('change', () => {
    const v = navidromePassInput.value;
    v ? localStorage.setItem('solora_navidrome_pass', v) : localStorage.removeItem('solora_navidrome_pass');
  });
}

// ─────────────────────────────────────────────────
// Navidrome Test & Status Feedback
// ─────────────────────────────────────────────────
function setNavidromeStatus(type, message) {
  if (!navidromeStatus) return;
  navidromeStatus.className = `navidrome-status ${type}`;
  navidromeStatus.textContent = message;
  navidromeStatus.classList.remove('hidden');
}

async function testNavidromeConnection(silent = false) {
  const user = navidromeUserInput?.value.trim() || '';
  const pass = navidromePassInput?.value || '';
  const navidromeUrl = (navidromeUrlInput?.value.trim() || localStorage.getItem('solora_navidrome_url') || '').replace(/\/+$/, '');

  if (!user) {
    if (!silent) setNavidromeStatus('error', '⚠️ Enter a Navidrome username to test');
    return false;
  }

  const base = getBaseUrl() || '';
  if (testNavidromeBtn) {
    testNavidromeBtn.disabled = true;
    testNavidromeBtn.textContent = '...';
  }
  setNavidromeStatus('checking', 'Checking Navidrome credentials...');

  try {
    const res = await fetch(`${base}/api/navidrome-test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user, pass, navidromeUrl })
    });
    const data = await res.json();

    if (res.ok && data.success) {
      setNavidromeStatus('success', `✓ ${data.message}`);
      return true;
    } else {
      setNavidromeStatus('error', `❌ ${data.message || 'Authentication failed'}`);
      return false;
    }
  } catch (err) {
    setNavidromeStatus('error', `❌ Cannot reach server: ${err.message}`);
    return false;
  } finally {
    if (testNavidromeBtn) {
      testNavidromeBtn.disabled = false;
      testNavidromeBtn.textContent = 'Test';
    }
  }
}

if (testNavidromeBtn) {
  testNavidromeBtn.addEventListener('click', () => testNavidromeConnection(false));
}

// Check on initial load if credentials already saved
if (navidromeUserInput?.value.trim()) {
  testNavidromeConnection(true);
}

function getBaseUrl() {
  const custom = (serverInput?.value || '').trim() || localStorage.getItem('solora_server_url') || '';
  if (custom) return custom.replace(/\/+$/, '');

  // If hosted on GitHub Pages or remote host and no backend configured, warn user
  if (window.location.hostname.endsWith('github.io')) {
    return null;
  }
  return '';
}

// ─────────────────────────────────────────────────
// SSE stream reader helper
// callback(msg) is called for each parsed JSON event
// returns a cancel function
// ─────────────────────────────────────────────────
function readSSEStream(fetchPromise, onMessage, onError) {
  let cancelled = false;
  let reader = null;

  fetchPromise.then(response => {
    if (cancelled) return;
    if (!response.ok) {
      return response.text().then(t => onError(new Error(`Server ${response.status}: ${t}`))).catch(onError);
    }

    reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    const pump = ({ done, value }) => {
      if (cancelled || done) return;
      buffer += decoder.decode(value, { stream: true });

      const parts = buffer.split('\n\n');
      buffer = parts.pop();

      for (const part of parts) {
        const line = part.replace(/^data: /, '').trim();
        if (!line || line.startsWith(':')) continue; // skip keepalives
        try {
          onMessage(JSON.parse(line));
        } catch (_) {}
      }

      reader.read().then(pump).catch(err => { if (!cancelled) onError(err); });
    };

    reader.read().then(pump).catch(err => { if (!cancelled) onError(err); });
  }).catch(err => { if (!cancelled) onError(err); });

  return () => {
    cancelled = true;
    try { reader?.cancel(); } catch (_) {}
  };
}

// ─────────────────────────────────────────────────
// Inspect button
// ─────────────────────────────────────────────────
inspectBtn.addEventListener('click', async () => {
  const url = urlInput.value.trim();
  if (!url) return;

  const base = getBaseUrl();
  if (base === null) {
    trackList.innerHTML = `<div class="placeholder" style="color:#ef4444">⚠️ You are on GitHub Pages! Please enter your running Solora backend address (e.g. <code>http://localhost:3000</code> or your server IP) in the "Solora Backend Server" field above.</div>`;
    inspectBtn.disabled = false;
    inspectBtn.textContent = 'Inspect';
    serverInput?.focus();
    return;
  }

  inspectBtn.disabled = true;
  inspectBtn.textContent = 'Inspecting...';
  collectionHeader.classList.add('hidden');
  selectionToolbar.classList.add('hidden');
  floatingActionBar.classList.add('hidden');
  if (addTrackRow) addTrackRow.classList.add('hidden');
  selectedTrackIds.clear();
  selectAllCheckbox.checked = false;

  logActivity(`[Inspect] Querying metadata for: ${url}`);
  trackList.innerHTML = `
    <div class="placeholder">
      <div class="spinner"></div>
      <div>Fetching track metadata from Spotify...</div>
    </div>
  `;

  try {
    const res  = await fetch(`${base}/api/metadata?url=${encodeURIComponent(url)}`);
    const data = await res.json();

    if (!res.ok || data.error) {
      trackList.innerHTML = `<div class="placeholder" style="color:#ef4444">❌ ${data.error || 'Failed to inspect link.'}</div>`;
      return;
    }

    currentTracks    = data.tracks || [];
    currentSourceUrl = url;
    renderMetadata(data, base);
    // Reveal the "add individual track" row now that we have a list
    if (addTrackRow) addTrackRow.classList.remove('hidden');
    if (addTrackInput) addTrackInput.value = '';
  } catch (err) {
    trackList.innerHTML = `<div class="placeholder" style="color:#ef4444">❌ Connection error: ${err.message}</div>`;
  } finally {
    inspectBtn.disabled  = false;
    inspectBtn.textContent = 'Inspect';
  }
});

// ─────────────────────────────────────────────────
// Add individual track
// ─────────────────────────────────────────────────
async function addIndividualTrack() {
  const url = addTrackInput?.value.trim();
  if (!url) return;

  // Must be a /track/ URL
  if (!url.includes('spotify.com/track/')) {
    showToast('⚠️ Paste a Spotify track URL (not a playlist or album).');
    addTrackInput?.select();
    return;
  }

  // Duplicate check
  const urlId = url.match(/track\/([a-zA-Z0-9]+)/)?.[1];
  if (urlId && currentTracks.some(t => t.id === urlId)) {
    showToast('⚠️ That track is already in the list.');
    addTrackInput.value = '';
    return;
  }

  const base = getBaseUrl();
  addTrackBtn.disabled = true;
  addTrackBtn.textContent = '...';
  logActivity(`[Add Track] Fetching: ${url}`);

  // Show a skeleton card while fetching
  const skeletonId = `skeleton-${Date.now()}`;
  const skeleton = document.createElement('div');
  skeleton.className = 'track-card track-skeleton';
  skeleton.id = skeletonId;
  skeleton.innerHTML = `
    <div class="track-checkbox-wrap"><input type="checkbox" class="custom-checkbox" disabled></div>
    <div class="track-main">
      <div class="track-thumb-placeholder skeleton-pulse"></div>
      <div class="track-details">
        <div class="skeleton-line skeleton-pulse" style="width:60%;height:13px;margin-bottom:6px;border-radius:4px"></div>
        <div class="skeleton-line skeleton-pulse" style="width:40%;height:11px;border-radius:4px"></div>
      </div>
    </div>
    <div class="track-actions"><div class="track-right"><span style="color:#444;font-size:0.8rem">Loading...</span></div></div>
  `;

  // Remove placeholder text if this is the first track
  const placeholder = trackList.querySelector('.placeholder');
  if (placeholder) placeholder.remove();

  trackList.appendChild(skeleton);
  trackList.scrollTop = trackList.scrollHeight;

  try {
    const res  = await fetch(`${base}/api/metadata?url=${encodeURIComponent(url)}`);
    const data = await res.json();

    if (!res.ok || data.error) throw new Error(data.error || 'Failed to fetch track');
    if (!data.tracks?.length) throw new Error('No track data returned');

    const track = data.tracks[0];

    // Replace skeleton with real card
    skeleton.remove();
    currentTracks.push(track);
    appendTrackCard(track, base);

    // Make sure toolbar is visible
    selectionToolbar.classList.remove('hidden');
    updateSelectionUI();

    addTrackInput.value = '';
    logActivity(`[Add Track] ✓ Added: ${track.title} — ${track.artist}`);
    showToast(`✓ Added: ${track.title}`);
  } catch (err) {
    skeleton.remove();
    showToast(`❌ ${err.message}`);
    logActivity(`[Add Track Error] ${err.message}`);
  } finally {
    addTrackBtn.disabled  = false;
    addTrackBtn.textContent = '+ Add';
  }
}

// Wire up button + Enter key
if (addTrackBtn)  addTrackBtn.addEventListener('click', addIndividualTrack);
if (addTrackInput) addTrackInput.addEventListener('keydown', e => { if (e.key === 'Enter') addIndividualTrack(); });

// ─────────────────────────────────────────────────
// Append a single track card to the live list
// ─────────────────────────────────────────────────
function appendTrackCard(track, base) {
  const isDownloaded = downloadedTrackIds.has(track.id);
  const navidromeSentIds = JSON.parse(localStorage.getItem('solora_navidrome_sent') || '[]');
  const isSentToNav = navidromeSentIds.includes(track.id);

  const card = document.createElement('div');
  card.className = `track-card${isDownloaded ? ' downloaded' : ''}${isSentToNav ? ' nav-sent' : ''}`;
  card.id = `card-${track.id}`;

  const metaParts = [];
  if (track.album) metaParts.push(track.album);
  if (track.year)  metaParts.push(track.year);
  const metaLine = metaParts.join(' · ');

  card.innerHTML = `
    <div class="track-checkbox-wrap">
      <input type="checkbox" class="custom-checkbox track-select-box" data-id="${escapeHtml(track.id)}">
    </div>
    <div class="track-main">
      ${track.coverArt ? `<img src="${escapeHtml(track.coverArt)}" class="track-thumb" alt="Art">` : '<div class="track-thumb-placeholder"></div>'}
      <div class="track-details">
        <div class="track-title" title="${escapeHtml(track.title)}">${escapeHtml(track.title)}</div>
        <div class="track-artist" title="${escapeHtml(track.artist)}">${escapeHtml(track.artist)}</div>
        ${metaLine ? `<div class="track-meta">${escapeHtml(metaLine)}</div>` : ''}
      </div>
    </div>
    <div class="track-actions">
      <div class="track-right">
        <div class="track-progress-wrap hidden">
          <div class="track-progress-bar"><div class="track-progress-fill" id="tp-${track.id}"></div></div>
        </div>
        <span class="track-duration">${formatDuration(track.durationMs)}</span>
        <div class="track-btn-row">
          <button class="btn-send-nav${isSentToNav ? ' sent' : ''}" title="Send to Navidrome" ${isSentToNav ? 'disabled' : ''}>
            ${isSentToNav ? '✓' : '🚀'}
          </button>
          <button class="btn-download-action${isDownloaded ? ' downloaded' : ''}" ${isDownloaded ? 'disabled' : ''}>
            ${isDownloaded ? '✓ Downloaded' : 'Download MP3'}
          </button>
        </div>
      </div>
    </div>
  `;

  card.querySelector('.track-select-box').addEventListener('change', e => {
    toggleTrackSelection(track.id, e.target.checked);
  });
  card.querySelector('.btn-download-action').addEventListener('click', e => {
    e.stopPropagation();
    if (!downloadedTrackIds.has(track.id)) triggerOnDemandDownload(track, card, base);
  });
  card.querySelector('.btn-send-nav').addEventListener('click', e => {
    e.stopPropagation();
    triggerSingleNavidrome(track, card, base);
  });

  // Flash the new card so the user sees it was added
  card.classList.add('track-added');
  setTimeout(() => card.classList.remove('track-added'), 800);

  trackList.appendChild(card);
  card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// ─────────────────────────────────────────────────
// Render track list
// ─────────────────────────────────────────────────
function renderMetadata(data, base) {
  if (data.type === 'playlist' || data.type === 'album') {
    collectionHeader.classList.remove('hidden');
    collectionHeader.innerHTML = `
      ${data.coverArt ? `<img src="${escapeHtml(data.coverArt)}" class="collection-cover" alt="Cover">` : ''}
      <div class="collection-meta">
        <h2>${escapeHtml(data.title)}</h2>
        <p>${escapeHtml(data.subtitle || '')} &bull; ${data.totalTracks} track${data.totalTracks === 1 ? '' : 's'}</p>
      </div>
    `;
  } else {
    collectionHeader.classList.add('hidden');
  }

  if (!data.tracks?.length) {
    trackList.innerHTML = `<div class="placeholder">No tracks found.</div>`;
    selectionToolbar.classList.add('hidden');
    return;
  }

  selectionToolbar.classList.remove('hidden');
  trackList.innerHTML = '';

  data.tracks.forEach(track => {
    const isDownloaded = downloadedTrackIds.has(track.id);
    const card = document.createElement('div');
    card.className = `track-card${isDownloaded ? ' downloaded' : ''}`;
    card.id = `card-${track.id}`;

    const metaParts = [];
    if (track.album) metaParts.push(track.album);
    if (track.year)  metaParts.push(track.year);
    const metaLine = metaParts.join(' · ');

    const navidromeSentIds = JSON.parse(localStorage.getItem('solora_navidrome_sent') || '[]');
    const isSentToNav = navidromeSentIds.includes(track.id);

    card.innerHTML = `
      <div class="track-checkbox-wrap">
        <input type="checkbox" class="custom-checkbox track-select-box" data-id="${escapeHtml(track.id)}">
      </div>
      <div class="track-main">
        ${track.coverArt ? `<img src="${escapeHtml(track.coverArt)}" class="track-thumb" alt="Art">` : '<div class="track-thumb-placeholder"></div>'}
        <div class="track-details">
          <div class="track-title" title="${escapeHtml(track.title)}">${escapeHtml(track.title)}</div>
          <div class="track-artist" title="${escapeHtml(track.artist)}">${escapeHtml(track.artist)}</div>
          ${metaLine ? `<div class="track-meta">${escapeHtml(metaLine)}</div>` : ''}
        </div>
      </div>
      <div class="track-actions">
        <div class="track-right">
          <div class="track-progress-wrap hidden">
            <div class="track-progress-bar"><div class="track-progress-fill" id="tp-${track.id}"></div></div>
          </div>
          <span class="track-duration">${formatDuration(track.durationMs)}</span>
          <div class="track-btn-row">
            <button class="btn-send-nav${isSentToNav ? ' sent' : ''}" title="Send to Navidrome" ${isSentToNav ? 'disabled' : ''}>
              ${isSentToNav ? '✓' : '🚀'}
            </button>
            <button class="btn-download-action${isDownloaded ? ' downloaded' : ''}" ${isDownloaded ? 'disabled' : ''}>
              ${isDownloaded ? '✓ Downloaded' : 'Download MP3'}
            </button>
          </div>
        </div>
      </div>
    `;

    card.querySelector('.track-select-box').addEventListener('change', e => {
      toggleTrackSelection(track.id, e.target.checked);
    });

    card.querySelector('.btn-download-action').addEventListener('click', e => {
      e.stopPropagation();
      if (!isDownloaded) triggerOnDemandDownload(track, card, base);
    });

    card.querySelector('.btn-send-nav').addEventListener('click', e => {
      e.stopPropagation();
      triggerSingleNavidrome(track, card, base);
    });

    trackList.appendChild(card);
  });

  updateSelectionUI();
}

// ─────────────────────────────────────────────────
// Selection management
// ─────────────────────────────────────────────────
function toggleTrackSelection(trackId, isSelected) {
  const card = document.getElementById(`card-${trackId}`);
  if (isSelected) {
    selectedTrackIds.add(trackId);
    card?.classList.add('selected');
  } else {
    selectedTrackIds.delete(trackId);
    card?.classList.remove('selected');
  }
  updateSelectionUI();
}

selectAllCheckbox.addEventListener('change', () => {
  const checkAll = selectAllCheckbox.checked;
  currentTracks.forEach(track => {
    const card = document.getElementById(`card-${track.id}`);
    const box  = card?.querySelector('.track-select-box');
    if (box) box.checked = checkAll;
    if (checkAll) { selectedTrackIds.add(track.id); card?.classList.add('selected'); }
    else          { selectedTrackIds.delete(track.id); card?.classList.remove('selected'); }
  });
  updateSelectionUI();
});

function updateSelectionUI() {
  const count = selectedTrackIds.size;
  selectedCountBadge.textContent  = `${count} selected`;
  floatingSelectedText.textContent = `${count} track${count === 1 ? '' : 's'} selected`;
  count > 0
    ? floatingActionBar.classList.remove('hidden')
    : floatingActionBar.classList.add('hidden');
  selectAllCheckbox.checked = currentTracks.length > 0 && count === currentTracks.length;
}

function getSelectedTracks() {
  return currentTracks.filter(t => selectedTrackIds.has(t.id));
}

// ─────────────────────────────────────────────────
// Per-track mini progress bar helpers
// ─────────────────────────────────────────────────
function showTrackProgress(trackId) {
  const card = document.getElementById(`card-${trackId}`);
  if (!card) return;
  card.querySelector('.track-progress-wrap')?.classList.remove('hidden');
}

function setTrackProgress(trackId, pct) {
  const fill = document.getElementById(`tp-${trackId}`);
  if (fill) fill.style.width = `${pct}%`;
}

function hideTrackProgress(trackId) {
  const card = document.getElementById(`card-${trackId}`);
  if (!card) return;
  card.querySelector('.track-progress-wrap')?.classList.add('hidden');
  setTrackProgress(trackId, 0);
}

// ─────────────────────────────────────────────────
// 1. Batch ZIP download — SSE
// ─────────────────────────────────────────────────
downloadSelectedZipBtn.addEventListener('click', () => {
  const selected = getSelectedTracks();
  if (!selected.length) return;

  const base = getBaseUrl();
  downloadSelectedZipBtn.disabled = true;
  downloadSelectedZipBtn.textContent = 'Preparing...';

  showProgress(`Starting download for ${selected.length} track(s)...`);
  logActivity(`[Zip] Starting SSE job for ${selected.length} tracks...`);

  let cancelStream = null;
  let done = false;

  const cleanup = () => {
    downloadSelectedZipBtn.disabled = false;
    downloadSelectedZipBtn.textContent = '⚡ Download Selected (.zip)';
  };

  cancelBtn.onclick = () => {
    if (cancelStream) cancelStream();
    done = true;
    cleanup();
    hideProgress(0);
    showToast('⚠️ Zip download cancelled.');
    logActivity('[Zip] Cancelled.');
    // Clean up per-track progress bars
    selected.forEach(t => hideTrackProgress(t.id));
  };

  cancelStream = readSSEStream(
    fetch(`${base}/api/zip-start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tracks: selected })
    }),
    (msg) => {
      if (done) return;
      if (msg.type === 'log') {
        logActivity(`[Solora] ${msg.data}`);
      } else if (msg.type === 'status') {
        logActivity(`[Zip] ${msg.data}`);
        progressStatusText.textContent = msg.data;
      } else if (msg.type === 'track_start') {
        const pct = Math.round((msg.data.completed / msg.data.total) * 90);
        setProgress(Math.max(pct, 3), `Downloading (${msg.data.completed + 1}/${msg.data.total}): ${msg.data.title}`);
        showTrackProgress(msg.data.id);
        setTrackProgress(msg.data.id, 0);
      } else if (msg.type === 'track_progress') {
        setTrackProgress(msg.data.id, msg.data.pct);
      } else if (msg.type === 'track_done') {
        const pct = Math.round((msg.data.completed / msg.data.total) * 90);
        setProgress(pct, `Completed ${msg.data.completed} of ${msg.data.total}...`);
        hideTrackProgress(msg.data.id);
        if (msg.data.id) markTrackAsDownloaded(msg.data.id);
      } else if (msg.type === 'track_fail') {
        const pct = Math.round((msg.data.completed / msg.data.total) * 90);
        setProgress(pct, `${msg.data.completed}/${msg.data.total} — ⚠ Failed: ${msg.data.title}`);
        hideTrackProgress(msg.data.id);
      } else if (msg.type === 'error') {
        showToast(`❌ ${msg.data}`);
        logActivity(`[Zip Error] ${msg.data}`);
        setProgress(0, `❌ ${msg.data}`);
        hideProgress(3000);
        cleanup();
        done = true;
      } else if (msg.type === 'done') {
        setProgress(95, `Bundling ${msg.data.count} track(s) into ZIP...`);
        logActivity(`[Zip] Packaging ${msg.data.count} tracks...`);

        const a = document.createElement('a');
        a.href = `${base}/api/zip-download/${msg.data.token}`;
        a.download = 'Solora_Music_Bundle.zip';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);

        setProgress(100, 'ZIP complete!');
        showToast(`⚡ ZIP downloaded (${msg.data.count} tracks)!`);
        logActivity('[Zip] Complete.');
        hideProgress(2500);
        cleanup();
        done = true;
      }
    },
    (err) => {
      if (done) return;
      showToast(`❌ Zip error: ${err.message}`);
      logActivity(`[Zip Error] ${err.message}`);
      setProgress(0, `❌ ${err.message}`);
      hideProgress(3000);
      cleanup();
    }
  );
});

// ─────────────────────────────────────────────────
// 2. Send to Navidrome — SSE
// ─────────────────────────────────────────────────
sendToNavidromeBtn.addEventListener('click', () => {
  const selected = getSelectedTracks();
  if (!selected.length) return;

  const base       = getBaseUrl();
  const targetDir  = navidromeDirInput?.value.trim() || '';

  sendToNavidromeBtn.disabled  = true;
  sendToNavidromeBtn.textContent = 'Syncing...';

  showProgress(`Sending ${selected.length} track(s) to Navidrome...`);
  logActivity(`[Navidrome] Syncing ${selected.length} tracks → ${targetDir || '(server default)'}`);

  let cancelStream = null;
  let done = false;

  const cleanup = () => {
    sendToNavidromeBtn.disabled  = false;
    sendToNavidromeBtn.textContent = '🚀 Send to Navidrome';
  };

  cancelBtn.onclick = () => {
    if (cancelStream) cancelStream();
    done = true;
    cleanup();
    hideProgress(0);
    showToast('⚠️ Navidrome sync cancelled.');
    logActivity('[Navidrome] Cancelled.');
    selected.forEach(t => hideTrackProgress(t.id));
  };

  const navUser    = navidromeUserInput?.value.trim() || '';
  const navPass    = navidromePassInput?.value || '';
  const navUrl     = (navidromeUrlInput?.value.trim() || localStorage.getItem('solora_navidrome_url') || '').replace(/\/+$/, '');

  cancelStream = readSSEStream(
    fetch(`${base}/api/send-to-navidrome`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        tracks: selected, 
        destinationDir: targetDir,
        navidromeUser: navUser,
        navidromePass: navPass,
        navidromeUrl: navUrl
      })
    }),
    (msg) => {
      if (done) return;
      if (msg.type === 'log') {
        logActivity(`[Navidrome] ${msg.data}`);
      } else if (msg.type === 'status') {
        logActivity(`[Navidrome] ${msg.data}`);
        progressStatusText.textContent = msg.data;
      } else if (msg.type === 'track_start') {
        const pct = Math.round((msg.data.completed / msg.data.total) * 90);
        setProgress(Math.max(pct, 3), `Sending (${msg.data.completed + 1}/${msg.data.total}): ${msg.data.title}`);
        showTrackProgress(msg.data.id);
        setTrackProgress(msg.data.id, 0);
      } else if (msg.type === 'track_progress') {
        setTrackProgress(msg.data.id, msg.data.pct);
      } else if (msg.type === 'track_done') {
        const pct = Math.round((msg.data.completed / msg.data.total) * 90);
        setProgress(pct, `Synced ${msg.data.completed} of ${msg.data.total}...`);
        hideTrackProgress(msg.data.id);
        if (msg.data.id) markTrackAsDownloaded(msg.data.id);
      } else if (msg.type === 'track_fail') {
        const pct = Math.round((msg.data.completed / msg.data.total) * 90);
        setProgress(pct, `${msg.data.completed}/${msg.data.total} — ⚠ Failed: ${msg.data.title}`);
        hideTrackProgress(msg.data.id);
      } else if (msg.type === 'done') {
        setProgress(100, `Synced ${msg.data.succeeded}/${msg.data.total} tracks!`);
        let toast = `🚀 Synced ${msg.data.succeeded} track${msg.data.succeeded === 1 ? '' : 's'} to Navidrome!`;
        if (msg.data.scanTriggered) toast += ' (Library scan started)';
        showToast(toast);
        logActivity(`[Navidrome] Done: ${msg.data.succeeded} succeeded, ${msg.data.failed} failed → ${msg.data.targetDir}`);
        hideProgress(2000);
        cleanup();
        done = true;
      }
    },
    (err) => {
      if (done) return;
      showToast(`❌ Navidrome error: ${err.message}`);
      logActivity(`[Navidrome Error] ${err.message}`);
      setProgress(0, `❌ ${err.message}`);
      hideProgress(3000);
      cleanup();
    }
  );
});

// ─────────────────────────────────────────────────
// Mark a track as sent to Navidrome (rocket → green ✓)
// ─────────────────────────────────────────────────
function markTrackSentToNav(trackId) {
  const card = document.getElementById(`card-${trackId}`);
  if (!card) return;
  card.classList.add('nav-sent');
  const btn = card.querySelector('.btn-send-nav');
  if (btn) {
    btn.classList.add('sent');
    btn.textContent = '✓';
    btn.disabled = true;
    btn.title = 'Sent to Navidrome';
  }
  // Persist across re-renders
  const stored = JSON.parse(localStorage.getItem('solora_navidrome_sent') || '[]');
  if (!stored.includes(trackId)) {
    stored.push(trackId);
    localStorage.setItem('solora_navidrome_sent', JSON.stringify(stored));
  }
}

// ─────────────────────────────────────────────────
// Single-track Send to Navidrome (SSE)
// ─────────────────────────────────────────────────
function triggerSingleNavidrome(track, card, base) {
  const navBtn = card.querySelector('.btn-send-nav');
  if (navBtn?.disabled) return;

  const targetDir = navidromeDirInput?.value.trim() || '';
  if (!targetDir) {
    showToast('⚠️ Set your Navidrome Music Directory in the settings first.');
    navidromeDirInput?.focus();
    return;
  }

  if (navBtn) { navBtn.disabled = true; navBtn.textContent = '⏳'; navBtn.title = 'Sending...'; }
  showTrackProgress(track.id);
  setTrackProgress(track.id, 0);
  logActivity(`[Navidrome] Sending: ${track.title} - ${track.artist || ''}`);

  let done = false;

  const navUser = navidromeUserInput?.value.trim() || '';
  const navPass = navidromePassInput?.value || '';
  const navUrl  = (navidromeUrlInput?.value.trim() || localStorage.getItem('solora_navidrome_url') || '').replace(/\/+$/, '');

  readSSEStream(
    fetch(`${base}/api/send-to-navidrome`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        tracks: [track], 
        destinationDir: targetDir,
        navidromeUser: navUser,
        navidromePass: navPass,
        navidromeUrl: navUrl
      })
    }),
    (msg) => {
      if (done) return;
      if (msg.type === 'track_progress') {
        setTrackProgress(track.id, msg.data.pct);
      } else if (msg.type === 'track_start') {
        setTrackProgress(track.id, 0);
      } else if (msg.type === 'track_done') {
        setTrackProgress(track.id, 100);
        hideTrackProgress(track.id);
        markTrackSentToNav(track.id);
        showToast(`🚀 "${track.title}" sent to Navidrome!`);
        logActivity(`[Navidrome] ✓ Sent: ${track.title}`);
        done = true;
      } else if (msg.type === 'track_fail') {
        hideTrackProgress(track.id);
        showToast(`❌ Failed to send "${track.title}": ${msg.data.error}`);
        logActivity(`[Navidrome Error] ${track.title}: ${msg.data.error}`);
        if (navBtn) { navBtn.disabled = false; navBtn.textContent = '🚀'; navBtn.title = 'Send to Navidrome'; }
        done = true;
      } else if (msg.type === 'done') {
        // scan triggered notification
        if (msg.data.scanTriggered) showToast(`🚀 "${track.title}" sent! Library scan started.`);
        done = true;
      }
    },
    (err) => {
      if (done) return;
      hideTrackProgress(track.id);
      showToast(`❌ Navidrome error: ${err.message}`);
      logActivity(`[Navidrome Error] ${err.message}`);
      if (navBtn) { navBtn.disabled = false; navBtn.textContent = '🚀'; navBtn.title = 'Send to Navidrome'; }
    }
  );
}

// ─────────────────────────────────────────────────
// 3. Individual track download (one at a time)
// ─────────────────────────────────────────────────
async function triggerOnDemandDownload(track, card, base) {
  if (isSingleDownloading) {
    showToast('⚠️ Another download is in progress. Please wait.');
    return;
  }

  isSingleDownloading = true;
  const btn = card.querySelector('.btn-download-action');
  if (btn) { btn.classList.add('downloading'); btn.textContent = 'Downloading...'; btn.disabled = true; }

  showProgress(`Downloading: ${track.title}...`);
  showTrackProgress(track.id);
  logActivity(`[Download] Starting: ${track.title} - ${track.artist || ''}`);

  const params = new URLSearchParams({
    title:    track.title,
    artist:   track.artist   || '',
    subtitle: track.subtitle || '',
    album:    track.album    || '',
    year:     track.year     || '',
    coverArt: track.coverArt || ''
  });

  const downloadUrl = `${base}/api/download-track?${params}`;
  let error = null;

  try {
    const response = await fetch(downloadUrl);

    if (!response.ok) {
      const txt = await response.text();
      throw new Error(txt || `Server error ${response.status}`);
    }

    // Stream the blob and show progress via content-length
    const contentLength = response.headers.get('Content-Length');
    const total = contentLength ? parseInt(contentLength) : 0;
    const reader = response.body.getReader();
    const chunks = [];
    let received = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.length;
      if (total > 0) {
        const pct = Math.round((received / total) * 90);
        setProgress(pct, `Downloading: ${track.title}... (${Math.round(received / 1024)}KB)`);
        setTrackProgress(track.id, pct);
      } else {
        // No content-length — pulse bar
        const cur = parseFloat(progressBarFill.style.width) || 10;
        if (cur < 85) setProgress(cur + 3, `Downloading: ${track.title}...`);
      }
    }

    setProgress(95, `Saving ${track.title}.mp3...`);
    setTrackProgress(track.id, 100);

    const blob = new Blob(chunks, { type: 'audio/mpeg' });
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = `${track.title} - ${track.artist || 'Artist'}.mp3`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(objectUrl);

    setProgress(100, 'Download complete!');
    showToast(`⚡ Downloaded: ${track.title}!`);
    logActivity(`[Download] ✓ Finished: ${track.title}`);
    markTrackAsDownloaded(track.id);
    hideProgress(2000);
  } catch (err) {
    error = err;
    showToast(`❌ Error: ${err.message}`);
    logActivity(`[Download Error] ${err.message}`);
    setProgress(0, `❌ ${err.message}`);
    hideProgress(3000);
  } finally {
    isSingleDownloading = false;
    hideTrackProgress(track.id);
    if (btn) {
      btn.classList.remove('downloading');
      btn.disabled = false;
      if (!error && downloadedTrackIds.has(track.id)) {
        btn.classList.add('downloaded');
        btn.textContent = '✓ Downloaded';
        btn.disabled = true;
      } else {
        btn.textContent = 'Download MP3';
      }
    }
  }
}
