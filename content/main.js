// Real content-script logic. Loaded as an ES module via dynamic import from
// content/content.js. Wires the site adapter, watcher, engine bridge, and
// overlay together.
//
// Diagnostic logging: every interesting event is logged with a
// `[chess-assistant]` prefix to the page console (DevTools → Console). When
// users report issues, the console output identifies which layer broke.

import { loadSettings, saveSettings, subscribe } from './settings.js';
import { createWatcher } from './board-watcher.js';
import { createEngineBridge } from '../engine/engine-bridge.js';
import { createArrowLayer } from './overlay/arrow.js';
import { createPanel } from './overlay/panel.js';
import { uciToSan, isValidFen } from './fen-replay.js';
import { installHotkey } from './hotkeys.js';

const TAG = '[chess-assistant]';
const log = (...a) => console.log(TAG, ...a);
const warn = (...a) => console.warn(TAG, ...a);
const error = (...a) => console.error(TAG, ...a);

// Spawning a Stockfish Worker from a chrome-extension:// URL inside a content
// script is blocked by the host page's CSP `worker-src` directive on both
// chess.com and lichess. Workaround: fetch the engine loader as text, embed
// it inside a same-origin Blob with a `Module.locateFile` override that
// resolves the wasm and nnue back to chrome-extension://, and spawn a Worker
// from the Blob URL. The Blob inherits the page origin so it satisfies
// `worker-src 'self'`, and the embedded loader's runtime fetches resolve
// against the extension URL via locateFile.
async function createEngineWorker() {
  const enginePrefix = browser.runtime.getURL('engine/');
  const engineUrl = browser.runtime.getURL('engine/stockfish-nnue-16-single.js');

  // Try direct first — modern Chrome may allow it via the WAR carve-out, and
  // Firefox usually does. If it throws (CSP block), fall back to blob.
  try {
    const direct = new Worker(engineUrl);
    log('engine worker spawned via direct chrome-extension URL');
    return direct;
  } catch (e) {
    warn('direct worker failed, falling back to blob bootstrap:', e.message);
  }

  const resp = await fetch(engineUrl);
  if (!resp.ok) throw new Error(`fetch stockfish loader failed: ${resp.status}`);
  const scriptText = await resp.text();
  const bootstrap =
    `var Module = (typeof Module === 'undefined' ? {} : Module);\n` +
    `Module.locateFile = function(p) { return ${JSON.stringify(enginePrefix)} + p; };\n` +
    scriptText;
  const blob = new Blob([bootstrap], { type: 'application/javascript' });
  const blobUrl = URL.createObjectURL(blob);
  log('engine worker spawned via blob bootstrap:', blobUrl);
  return new Worker(blobUrl);
}

export async function run() {
  log('bootstrap starting on', location.host);

  const host = location.host;
  let adapterModule;
  if (host.endsWith('chess.com')) {
    log('loading chess.com adapter');
    adapterModule = await import(browser.runtime.getURL('content/adapters/chesscom.js'));
  } else if (host.endsWith('lichess.org')) {
    log('loading lichess adapter');
    adapterModule = await import(browser.runtime.getURL('content/adapters/lichess.js'));
  } else {
    log('host not supported, exiting:', host);
    return;
  }

  let settings = await loadSettings();
  log('settings loaded:', JSON.stringify({
    enabled: settings.enabled,
    sites: settings.sites,
    elo: settings.engine.elo,
    mode: settings.engine.mode,
    trigger: settings.trigger
  }));

  if (!settings.enabled) { log('extension disabled in popup, exiting'); return; }
  if (host.endsWith('chess.com') && !settings.sites.chesscom) {
    log('chess.com disabled in popup, exiting');
    return;
  }
  if (host.endsWith('lichess.org') && !settings.sites.lichess) {
    log('lichess disabled in popup, exiting');
    return;
  }

  // Engine bootstrap. We wrap it in a function so we can re-spawn the worker
  // if Stockfish crashes (e.g. fed an invalid FEN that causes the wasm to
  // throw index-out-of-bounds — once that happens the engine is unusable
  // for the rest of the session and we have to start a new one).
  let bridge;
  let worker;
  let restartingEngine = false;

  async function startEngine() {
    try {
      worker = await createEngineWorker();
    } catch (e) {
      error('failed to create engine worker:', e);
      throw e;
    }
    worker.onerror = (e) => {
      error('engine worker error:', e.message || e);
      // Auto-restart on crash, but only once at a time.
      if (restartingEngine) return;
      restartingEngine = true;
      setTimeout(async () => {
        warn('restarting engine worker after crash');
        try {
          if (bridge) bridge.destroy?.();
        } catch {}
        try {
          await startEngine();
          warn('engine restarted');
        } catch (err) {
          error('engine restart failed:', err);
        } finally {
          restartingEngine = false;
        }
      }, 100);
    };
    bridge = createEngineBridge(worker);
    log('engine bridge created, waiting for ready');
    await bridge.ready();
    log('engine ready');
    await bridge.setOptions({
      elo: settings.engine.elo,
      limitStrength: settings.engine.limitStrength,
      threads: 1,
      hash: 16
    });
  }

  try {
    await startEngine();
  } catch (e) {
    return;
  }

  // Create overlay layers
  const arrow = createArrowLayer();
  const panel = createPanel({
    initialPosition: settings.panelPosition,
    onPositionChange: pos => {
      saveSettings({ panelPosition: pos }).catch(e =>
        error('failed to persist panel position:', e));
    }
  });
  panel.setDisplay({
    evalBar: settings.display.evalBar,
    pvLines: settings.display.pvLines
  });
  if (!settings.display.panel) panel.hide();

  const adapter = adapterModule.createAdapter(document);
  log('adapter ready, board element initially:', !!adapter.getBoardElement());

  let lastFen = null;
  let lastSideToMove = 'white';
  let lastOrientation = 'white';

  async function analyzePosition(fen, sideToMove, orientation) {
    // Sanity-check the FEN before sending to Stockfish. Bad FENs (kingless,
    // wrong rank widths) crash the wasm with index-out-of-bounds and the
    // engine is unusable for the rest of the session.
    if (!isValidFen(fen)) {
      warn('skipping analyze: FEN failed validity check:', fen);
      return;
    }
    if (!bridge) {
      warn('skipping analyze: engine not ready');
      return;
    }

    // Re-query the board on every analyze so SPA-driven element replacement
    // (e.g. chess.com new-game transitions) doesn't leave us drawing onto a
    // detached node.
    const board = adapter.getBoardElement();
    if (board) {
      arrow.setBoard(board);
    } else {
      warn('board element vanished mid-analyze; arrow will be invisible');
    }

    log('analyzing:', fen);
    try {
      await bridge.analyze(
        fen,
        {
          mode: settings.engine.mode,
          value: settings.engine.mode === 'depth'
            ? settings.engine.depth
            : settings.engine.timeMs
        },
        info => {
          if (!info.pv || info.pv.length === 0) return;
          const primaryUci = info.pv[0];
          const opponentUci = info.pv[1] || null;
          const primary = {
            from: primaryUci.slice(0, 2),
            to: primaryUci.slice(2, 4)
          };
          const opponent = opponentUci ? {
            from: opponentUci.slice(0, 2),
            to: opponentUci.slice(2, 4)
          } : null;
          if (settings.display.arrow) {
            arrow.setMoves({ primary, opponent }, orientation);
          }
          if (settings.display.panel) {
            const bestMoveSan = uciToSan(fen, primaryUci);
            const pvSans = info.pv.slice(0, 6).map(u => {
              try { return uciToSan(fen, u); } catch { return u; }
            });
            panel.update({
              scoreCp: info.scoreCp,
              scoreMate: info.scoreMate,
              depth: info.depth,
              nps: null,
              bestMoveSan,
              pvSans: [pvSans.join(' ')],
              footer: `engine: ${settings.engine.limitStrength ? `ELO ${settings.engine.elo}` : 'unlimited'} · ${settings.engine.mode === 'depth' ? `d${settings.engine.depth}` : `${settings.engine.timeMs}ms`}`
            });
          }
        }
      );
    } catch (e) {
      // Search was superseded by a newer position. Ignore.
    }
  }

  function shouldAnalyze(sideToMove, orientation) {
    if (settings.trigger === 'auto') return true;
    if (settings.trigger === 'myTurn') return sideToMove === orientation;
    return false; // hotkey-only
  }

  const watcher = createWatcher(adapter, ({ fen, sideToMove, orientation, source }) => {
    log(`position changed (source=${source}, side=${sideToMove}, orient=${orientation})`);
    lastFen = fen;
    lastSideToMove = sideToMove;
    lastOrientation = orientation;
    bridge.stop();
    arrow.clear();
    if (shouldAnalyze(sideToMove, orientation)) {
      analyzePosition(fen, sideToMove, orientation);
    } else {
      log(`skipping analyze due to trigger=${settings.trigger}`);
    }
  });

  // Hotkey: force a fresh re-read of the current board state (in case the
  // watcher missed a mutation or the dedup short-circuited a stale FEN),
  // then analyze whatever the watcher believes the current position is.
  installHotkey(() => settings.hotkey, () => {
    log('hotkey pressed — forcing fresh read');
    watcher.forceRead();
    if (lastFen) {
      analyzePosition(lastFen, lastSideToMove, lastOrientation);
    } else {
      warn('hotkey pressed but no position has been read yet');
    }
  });

  // One-shot diagnostic dump 1.5s after bootstrap. Gives us visibility into
  // exactly what each adapter strategy returns on the user's current page
  // type so DOM-shape regressions are debuggable from a single console
  // paste.
  setTimeout(() => {
    try {
      log('=== diagnostic dump ===');
      log('host:', location.host, 'path:', location.pathname);
      const board = adapter.getBoardElement();
      log('board element present:', !!board, board ? `(${board.tagName.toLowerCase()})` : '');
      log('orientation:', adapter.getOrientation());
      const attrFen = adapter.getFenAttribute && adapter.getFenAttribute();
      log('fen attribute:', attrFen || '(none)');
      const moves = adapter.getMoveList();
      log(`move list (${moves.length} moves):`, moves.slice(0, 12).join(' '), moves.length > 12 ? '...' : '');
      const grid = adapter.readPieceGrid && adapter.readPieceGrid();
      if (grid) {
        const visual = grid.map(r => r.map(c => c || '.').join('')).join('/');
        log('piece grid:', visual);
      } else {
        log('piece grid: (none)');
      }
      log('current lastFen:', lastFen || '(none)');
      log('=== end diagnostic dump ===');
    } catch (e) {
      error('diagnostic dump failed:', e);
    }
  }, 1500);

  // Live settings updates
  subscribe(async (next) => {
    log('settings updated');
    settings = next;
    await bridge.setOptions({
      elo: settings.engine.elo,
      limitStrength: settings.engine.limitStrength
    });
    panel.setDisplay({
      evalBar: settings.display.evalBar,
      pvLines: settings.display.pvLines
    });
    if (!settings.display.panel) panel.hide(); else panel.show();
    if (!settings.display.arrow) arrow.clear();
  });

  log('bootstrap complete');
}
