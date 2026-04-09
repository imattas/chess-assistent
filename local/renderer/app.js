// Renderer logic for the main window: tab bar, webview host, engine sidebar.
// Runs with nodeIntegration on so we can `require` directly.

const { ipcRenderer } = require('electron');
const path = require('path');

// ---- Create the <webview> element with an absolute preload path ----

const webviewHost = document.getElementById('webview-host');
const webview = document.createElement('webview');
webview.id = 'webview';
webview.setAttribute('partition', 'persist:chess-assistant');
webview.setAttribute(
  'preload',
  'file://' + path.join(__dirname, '..', 'preload-webview.js')
);
// Enable nodeIntegration in the guest so the preload script can `require('electron')`.
webview.setAttribute('webpreferences', 'contextIsolation=no, nodeIntegration=yes');
webview.setAttribute('allowpopups', 'true');
webview.setAttribute('useragent',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/124.0.0.0 Safari/537.36');
webview.src = 'https://lichess.org/';
webviewHost.appendChild(webview);

webview.addEventListener('did-fail-load', (e) => {
  console.warn('[renderer] webview load failed:', e.errorCode, e.errorDescription, e.validatedURL);
});
webview.addEventListener('dom-ready', () => {
  console.log('[renderer] webview dom-ready:', webview.getURL());
});

// ---- Tab switching ----

const tabs = document.querySelectorAll('#site-tabs button');
tabs.forEach((btn) => {
  btn.addEventListener('click', () => {
    tabs.forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    try {
      webview.loadURL(btn.dataset.url);
    } catch (e) {
      console.error('[renderer] loadURL failed:', e);
    }
    // Clear stale arrows while the new page loads.
    clearEngineState();
  });
});

// ---- Status line + engine-ready handling ----

const statusEl = document.getElementById('status');
const diagBinary = document.getElementById('diag-binary');

ipcRenderer.on('engine-ready', (e, payload) => {
  statusEl.textContent = 'Engine ready';
  statusEl.classList.remove('error');
  statusEl.classList.add('ok');
  if (payload && payload.binaryPath) diagBinary.textContent = payload.binaryPath;
  // Push initial options once the engine is alive.
  sendEngineOptions();
});

ipcRenderer.on('engine-error', (e, payload) => {
  const msg = (payload && payload.message) || 'Engine failed to start';
  statusEl.textContent = 'Engine error';
  statusEl.classList.add('error');
  statusEl.classList.remove('ok');
  diagBinary.textContent = msg;
  console.error('[renderer] engine error:', payload);
  // Show the install hint in the sidebar diagnostic section.
  if (payload && payload.hint) {
    const note = document.createElement('div');
    note.className = 'diag-row';
    note.innerHTML = '<span></span><code>' + payload.hint + '</code>';
    document.getElementById('diagnostic').appendChild(note);
  }
});

// ---- Webview → host IPC (FEN from preload) ----

webview.addEventListener('ipc-message', async (event) => {
  if (event.channel === 'fen') {
    const payload = event.args[0] || {};
    const { fen, sideToMove, orientation, source } = payload;
    console.log('[renderer] got FEN from webview:', fen);
    document.getElementById('diag-fen').textContent = fen || '—';
    document.getElementById('diag-source').textContent = source || '—';
    await requestAnalyze(fen);
  }
});

// ---- Analysis flow ----

let analysisSeq = 0;
let currentAnalysisId = 0;

async function requestAnalyze(fen) {
  if (!fen) return;
  const id = ++analysisSeq;
  currentAnalysisId = id;
  // Fire-and-forget. The engine bridge supersedes previous searches.
  try {
    const opts = getAnalyzeOptions();
    await ipcRenderer.invoke('analyze', { fen, options: opts, id });
  } catch (e) {
    // Likely "superseded". Silent.
  }
}

function getAnalyzeOptions() {
  const mode = document.querySelector('input[name="mode"]:checked').value;
  if (mode === 'depth') {
    return { mode: 'depth', value: parseInt(document.getElementById('depth').value, 10) };
  }
  return { mode: 'time', value: parseInt(document.getElementById('time').value, 10) };
}

// ---- Engine info streaming (main → renderer) ----

ipcRenderer.on('engine-info', (event, { id, info }) => {
  if (id !== currentAnalysisId) return; // stale
  updateSidebar(info);
  if (info.pv && info.pv.length > 0) {
    webview.send('draw-arrow', {
      primary: info.pv[0],
      opponent: info.pv[1] || null
    });
  }
});

function updateSidebar(info) {
  // Eval bar
  const fill = document.getElementById('eval-fill');
  let displayCp = info.scoreCp != null ? info.scoreCp : 0;
  if (info.scoreMate != null) displayCp = info.scoreMate > 0 ? 1500 : -1500;
  const clamped = Math.max(-500, Math.min(500, displayCp));
  const pct = (clamped + 500) / 1000;
  if (clamped >= 0) {
    fill.style.left = '50%';
    fill.style.width = ((pct - 0.5) * 100) + '%';
    fill.style.background = 'var(--accent)';
  } else {
    fill.style.left = (pct * 100) + '%';
    fill.style.width = ((0.5 - pct) * 100) + '%';
    fill.style.background = 'var(--danger)';
  }

  // Best move + eval label
  const bestEl = document.getElementById('best-move');
  const evalEl = document.getElementById('eval-value');
  const uci = (info.pv && info.pv[0]) || '—';
  bestEl.textContent = uci;
  if (info.scoreMate != null) {
    evalEl.textContent = 'Mate in ' + info.scoreMate;
  } else if (info.scoreCp != null) {
    const pawns = (info.scoreCp / 100).toFixed(2);
    const sign = info.scoreCp >= 0 ? '+' : '';
    evalEl.textContent = sign + pawns;
  } else {
    evalEl.textContent = '—';
  }

  // Meta
  const meta = document.getElementById('meta');
  const knps = info.nps != null ? Math.round(info.nps / 1000) + ' kn/s' : '— kn/s';
  meta.textContent = 'depth ' + (info.depth || '—') + ' · ' + knps;

  // PV list
  const pvList = document.getElementById('pv-list');
  pvList.innerHTML = '';
  if (info.pv && info.pv.length > 0) {
    const line = document.createElement('div');
    line.className = 'pv-line';
    line.textContent = info.pv.slice(0, 12).join(' ');
    line.addEventListener('click', () => {
      try { navigator.clipboard.writeText(info.pv.join(' ')); } catch {}
    });
    pvList.appendChild(line);
  } else {
    const empty = document.createElement('div');
    empty.className = 'pv-empty';
    empty.textContent = 'No PV yet.';
    pvList.appendChild(empty);
  }
}

function clearEngineState() {
  document.getElementById('best-move').textContent = '—';
  document.getElementById('meta').textContent = 'depth — · — kn/s';
  document.getElementById('eval-value').textContent = '—';
  const fill = document.getElementById('eval-fill');
  fill.style.left = '50%';
  fill.style.width = '0%';
  const pvList = document.getElementById('pv-list');
  pvList.innerHTML = '<div class="pv-empty">Waiting for next position…</div>';
  try { webview.send('clear-arrow'); } catch {}
  ipcRenderer.invoke('stop-analysis');
}

// ---- Sidebar controls → engine options + analyze options ----

function bindRange(id, valueId, suffix) {
  const el = document.getElementById(id);
  const val = document.getElementById(valueId);
  const render = () => { val.textContent = el.value + (suffix || ''); };
  render();
  el.addEventListener('input', () => {
    render();
    if (id === 'elo' || id === 'threads' || id === 'hash' || id === 'multipv') {
      sendEngineOptions();
    }
    // Time/depth affect next analyze only; no UCI update needed.
  });
}

bindRange('elo', 'elo-value', '');
bindRange('time', 'time-value', '');
bindRange('depth', 'depth-value', '');
bindRange('threads', 'threads-value', '');
bindRange('hash', 'hash-value', '');
bindRange('multipv', 'multipv-value', '');

document.getElementById('unlimited').addEventListener('change', sendEngineOptions);

document.querySelectorAll('input[name="mode"]').forEach((r) => {
  r.addEventListener('change', () => {
    const mode = document.querySelector('input[name="mode"]:checked').value;
    document.getElementById('time-row').style.display = mode === 'time' ? '' : 'none';
    document.getElementById('depth-row').style.display = mode === 'depth' ? '' : 'none';
  });
});

function sendEngineOptions() {
  const elo = parseInt(document.getElementById('elo').value, 10);
  const unlimited = document.getElementById('unlimited').checked;
  const threads = parseInt(document.getElementById('threads').value, 10);
  const hash = parseInt(document.getElementById('hash').value, 10);
  const multiPv = parseInt(document.getElementById('multipv').value, 10);
  ipcRenderer.invoke('set-engine-options', {
    elo,
    limitStrength: !unlimited,
    threads,
    hash,
    multiPv
  }).catch((e) => console.error('[renderer] set-engine-options failed:', e));
}
