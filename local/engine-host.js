// Native Stockfish subprocess wrapper. Spawns the system `stockfish` binary
// and exposes a typed async API on top of the UCI protocol.
//
// Uses the same race-safe single-active + single-pending search queue as the
// extension's engine bridge, so rapid-fire analyze() calls don't cross
// bestmove lines. All UCI text is kept in process — no network, no polling.

const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

/**
 * Find a Stockfish binary on this host. Tries (in order):
 *   1. $STOCKFISH_PATH env var
 *   2. `command -v stockfish` on the user's PATH
 *   3. common Linux/macOS install locations
 *   4. ./engine/stockfish or ./engine/stockfish.exe next to this file
 *
 * Throws a descriptive error with install hints if nothing is found.
 */
function findStockfish() {
  if (process.env.STOCKFISH_PATH && fs.existsSync(process.env.STOCKFISH_PATH)) {
    return process.env.STOCKFISH_PATH;
  }

  try {
    const which = process.platform === 'win32' ? 'where' : 'command -v';
    const out = execSync(`${which} stockfish`, { encoding: 'utf8' }).trim().split('\n')[0];
    if (out && fs.existsSync(out)) return out;
  } catch { /* not on PATH */ }

  const candidates = [
    '/usr/games/stockfish',
    '/usr/bin/stockfish',
    '/usr/local/bin/stockfish',
    '/opt/homebrew/bin/stockfish',
    path.join(__dirname, 'engine', 'stockfish'),
    path.join(__dirname, 'engine', 'stockfish.exe')
  ];
  for (const c of candidates) {
    try { if (fs.existsSync(c)) return c; } catch {}
  }

  throw new Error(
    'Stockfish binary not found. Install it with your package manager:\n' +
    '  Arch / Artix:  sudo pacman -S stockfish\n' +
    '  Debian / Ubuntu:  sudo apt install stockfish\n' +
    '  macOS (Homebrew):  brew install stockfish\n' +
    '  Windows:  download from https://stockfishchess.org/download/ and\n' +
    '            either put stockfish.exe on PATH or set STOCKFISH_PATH env var,\n' +
    '            or drop it at ' + path.join(__dirname, 'engine', 'stockfish.exe')
  );
}

function parseInfoLine(line) {
  // info depth N score cp X|mate Y pv m1 m2 m3 ...
  const parts = line.split(/\s+/);
  const info = {
    depth: 0,
    scoreCp: null,
    scoreMate: null,
    nodes: null,
    nps: null,
    multipv: 1,
    pv: []
  };
  for (let i = 0; i < parts.length; i++) {
    const tok = parts[i];
    if (tok === 'depth') info.depth = parseInt(parts[++i], 10);
    else if (tok === 'multipv') info.multipv = parseInt(parts[++i], 10);
    else if (tok === 'nodes') info.nodes = parseInt(parts[++i], 10);
    else if (tok === 'nps') info.nps = parseInt(parts[++i], 10);
    else if (tok === 'score') {
      const kind = parts[++i];
      const val = parseInt(parts[++i], 10);
      if (kind === 'cp') info.scoreCp = val;
      else if (kind === 'mate') info.scoreMate = val;
    } else if (tok === 'pv') {
      info.pv = parts.slice(i + 1);
      break;
    }
  }
  return info;
}

function createEngineHost() {
  const binaryPath = findStockfish();
  const proc = spawn(binaryPath, [], { stdio: ['pipe', 'pipe', 'pipe'] });

  let buffer = '';
  let ready = false;
  const readyWaiters = [];

  let activeSearch = null;
  let pendingSearch = null;

  proc.stdout.on('data', (chunk) => {
    buffer += chunk.toString();
    let idx;
    while ((idx = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (line) handleLine(line);
    }
  });

  proc.stderr.on('data', (chunk) => {
    console.error('[stockfish stderr]', chunk.toString().trimEnd());
  });

  proc.on('exit', (code, signal) => {
    console.log('[stockfish] exited code=' + code + ' signal=' + signal);
  });

  proc.on('error', (err) => {
    console.error('[stockfish] spawn error:', err);
  });

  function send(line) {
    try { proc.stdin.write(line + '\n'); } catch (e) { console.error('[stockfish] write failed:', e); }
  }

  function handleLine(line) {
    if (line === 'readyok') {
      ready = true;
      while (readyWaiters.length) readyWaiters.shift()();
      return;
    }
    if (line.startsWith('info ') && line.includes(' pv ')) {
      if (activeSearch) {
        try { activeSearch.onInfo(parseInfoLine(line)); } catch (e) { console.error('[stockfish] onInfo threw:', e); }
      }
      return;
    }
    if (line.startsWith('bestmove ')) {
      const parts = line.split(/\s+/);
      const result = { bestmove: parts[1], ponder: parts[3] };
      const finished = activeSearch;
      activeSearch = null;
      if (finished) finished.resolve(result);
      if (pendingSearch) {
        activeSearch = pendingSearch;
        pendingSearch = null;
        startSearch(activeSearch);
      }
      return;
    }
  }

  function awaitReady() {
    if (ready) return Promise.resolve();
    return new Promise((resolve) => readyWaiters.push(resolve));
  }

  function startSearch(search) {
    send(`position fen ${search.fen}`);
    if (search.opts.mode === 'depth') {
      send(`go depth ${search.opts.value}`);
    } else {
      send(`go movetime ${search.opts.value}`);
    }
  }

  function analyze(fen, opts, onInfo) {
    const options = opts || { mode: 'time', value: 1000 };
    return new Promise((resolve, reject) => {
      const search = {
        fen,
        opts: options,
        onInfo: onInfo || (() => {}),
        resolve,
        reject
      };
      if (activeSearch) {
        if (pendingSearch) pendingSearch.reject(new Error('superseded'));
        pendingSearch = search;
        send('stop');
      } else {
        activeSearch = search;
        startSearch(search);
      }
    });
  }

  function stop() {
    if (pendingSearch) {
      pendingSearch.reject(new Error('stopped'));
      pendingSearch = null;
    }
    send('stop');
  }

  async function setOptions(opts = {}) {
    const { elo, limitStrength, hash, threads, multiPv, syzygyPath, skillLevel } = opts;
    if (typeof limitStrength === 'boolean') send(`setoption name UCI_LimitStrength value ${limitStrength}`);
    if (typeof elo === 'number' && limitStrength !== false) send(`setoption name UCI_Elo value ${elo}`);
    if (typeof hash === 'number') send(`setoption name Hash value ${hash}`);
    if (typeof threads === 'number') send(`setoption name Threads value ${threads}`);
    if (typeof multiPv === 'number') send(`setoption name MultiPV value ${multiPv}`);
    if (typeof syzygyPath === 'string' && syzygyPath) send(`setoption name SyzygyPath value ${syzygyPath}`);
    if (typeof skillLevel === 'number') send(`setoption name Skill Level value ${skillLevel}`);
    send('isready');
  }

  function destroy() {
    if (activeSearch) {
      try { activeSearch.reject(new Error('destroyed')); } catch {}
      activeSearch = null;
    }
    if (pendingSearch) {
      try { pendingSearch.reject(new Error('destroyed')); } catch {}
      pendingSearch = null;
    }
    try { send('quit'); } catch {}
    try { proc.kill('SIGTERM'); } catch {}
  }

  // Kick off the UCI handshake.
  send('uci');
  send('isready');

  return { analyze, stop, setOptions, destroy, awaitReady, binaryPath };
}

module.exports = { createEngineHost, findStockfish };
