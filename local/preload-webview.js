// Webview preload. Runs inside the embedded chess site (chess.com, lichess,
// chess24, chesstempo, ...) with nodeIntegration enabled on the webview tag.
//
// Responsibilities:
//   1. Detect which site we're on and load the right adapter.
//   2. Set up a board watcher that sends each new FEN to the host renderer.
//   3. Listen for 'draw-arrow' messages from the host and render SVG arrows
//      over the site's real chess board.

const { ipcRenderer } = require('electron');

function pickAdapter(host) {
  if (host.includes('chess.com')) return require('./adapters/chesscom.js');
  if (host.includes('lichess.org')) return require('./adapters/lichess.js');
  return require('./adapters/generic.js');
}

function init() {
  const host = location.host;
  console.log('[chess-assistant-local] preload init on', host);

  let adapterModule;
  try {
    adapterModule = pickAdapter(host);
  } catch (e) {
    console.error('[chess-assistant-local] failed to load adapter:', e);
    return;
  }

  const { createAdapter } = adapterModule;
  const { createWatcher } = require('./board-watcher.js');
  const { createArrowLayer } = require('./arrow-overlay.js');

  const adapter = createAdapter(document);
  const arrow = createArrowLayer();

  createWatcher(adapter, ({ fen, sideToMove, orientation, source }) => {
    const board = adapter.getBoardElement();
    if (board) arrow.setBoard(board);
    ipcRenderer.sendToHost('fen', { fen, sideToMove, orientation, source });
  });

  ipcRenderer.on('draw-arrow', (event, payload) => {
    const orientation = adapter.getOrientation();
    const board = adapter.getBoardElement();
    if (board) arrow.setBoard(board);

    const primaryUci = payload && payload.primary;
    const opponentUci = payload && payload.opponent;

    const primary = primaryUci
      ? { from: primaryUci.slice(0, 2), to: primaryUci.slice(2, 4) }
      : null;
    const opponent = opponentUci
      ? { from: opponentUci.slice(0, 2), to: opponentUci.slice(2, 4) }
      : null;

    arrow.setMoves({ primary, opponent }, orientation);
  });

  ipcRenderer.on('clear-arrow', () => {
    arrow.clear();
  });

  console.log('[chess-assistant-local] preload ready');
}

// The preload runs before DOMContentLoaded on a fresh navigation. Wait for
// the DOM so the adapter can find board + move-list elements.
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
