// Content script entry point. Loaded into chess.com and lichess pages.
// Detects which site we're on, instantiates the right adapter, wires the
// watcher to the engine bridge, and renders the overlay.

import { loadSettings, subscribe } from './settings.js';
import { createWatcher } from './board-watcher.js';
import { createEngineBridge } from '../engine/engine-bridge.js';
import { createArrowLayer } from './overlay/arrow.js';
import { createPanel } from './overlay/panel.js';
import { uciToSan } from './fen-replay.js';
import { installHotkey } from './hotkeys.js';

async function main() {
  const host = location.host;
  let adapterModule;
  if (host.endsWith('chess.com')) {
    adapterModule = await import(browser.runtime.getURL('content/adapters/chesscom.js'));
  } else if (host.endsWith('lichess.org')) {
    adapterModule = await import(browser.runtime.getURL('content/adapters/lichess.js'));
  } else {
    return;
  }

  let settings = await loadSettings();
  if (!settings.enabled) return;
  if (host.endsWith('chess.com') && !settings.sites.chesscom) return;
  if (host.endsWith('lichess.org') && !settings.sites.lichess) return;

  // Spin up the engine worker
  const worker = new Worker(browser.runtime.getURL('engine/stockfish-nnue-16-single.js'));
  const bridge = createEngineBridge(worker);
  await bridge.ready();
  await bridge.setOptions({
    elo: settings.engine.elo,
    limitStrength: settings.engine.limitStrength,
    threads: 1,
    hash: 16
  });

  // Create overlay layers
  const arrow = createArrowLayer();
  const panel = createPanel({
    initialPosition: settings.panelPosition,
    onPositionChange: pos => {
      browser.storage.sync.get('chessAssistantSettings').then(r => {
        const s = r.chessAssistantSettings || {};
        s.panelPosition = pos;
        browser.storage.sync.set({ chessAssistantSettings: s });
      });
    }
  });
  if (!settings.display.panel) panel.hide();

  const adapter = adapterModule.createAdapter(document);

  let lastFen = null;
  let lastSideToMove = 'white';

  async function analyzePosition(fen, sideToMove, orientation) {
    const board = adapter.getBoardElement();
    if (board) arrow.setBoard(board);

    const collected = { lastInfo: null };
    try {
      await bridge.analyze(
        fen,
        { mode: settings.engine.mode, value: settings.engine.mode === 'depth'
            ? settings.engine.depth
            : settings.engine.timeMs },
        info => {
          collected.lastInfo = info;
          if (!info.pv || info.pv.length === 0) return;
          const uci = info.pv[0];
          const from = uci.slice(0, 2);
          const to = uci.slice(2, 4);
          if (settings.display.arrow) arrow.setMove({ from, to }, orientation);
          if (settings.display.panel) {
            const bestMoveSan = uciToSan(fen, uci);
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

  const watcher = createWatcher(adapter, ({ fen, sideToMove, orientation }) => {
    lastFen = fen;
    lastSideToMove = sideToMove;
    bridge.stop();
    arrow.clear();
    if (shouldAnalyze(sideToMove, orientation)) {
      analyzePosition(fen, sideToMove, orientation);
    }
  });

  // Hotkey: re-analyze on demand
  installHotkey(() => settings.hotkey, () => {
    if (lastFen) analyzePosition(lastFen, lastSideToMove, adapter.getOrientation());
  });

  // Live settings updates
  subscribe(async (next) => {
    settings = next;
    await bridge.setOptions({
      elo: settings.engine.elo,
      limitStrength: settings.engine.limitStrength
    });
    if (!settings.display.panel) panel.hide(); else panel.show();
    if (!settings.display.arrow) arrow.clear();
  });
}

main().catch(e => console.error('[chess-assistant]', e));
