// Board watcher. Same multi-strategy logic as the extension, in CommonJS.
//
//   1. adapter.getFenAttribute()  — direct attribute read (rare, but free)
//   2. adapter.readPieceGrid()    — scrape pieces, infer castling rights
//   3. SAN replay via fen-replay  — chess.js replay (used only when piece
//                                    scrape fails)
//
// Emits onPositionChange({ fen, sideToMove, orientation, source }) on every
// new unique FEN.

const { sansToFen, STARTING_FEN, composeFenFromGrid } = require('./fen-replay.js');

function createWatcher(adapter, onPositionChange) {
  let lastFen = null;

  function tryRead() {
    if (!adapter.getBoardElement()) return null;

    if (typeof adapter.getFenAttribute === 'function') {
      try {
        const attrFen = adapter.getFenAttribute();
        if (attrFen) return { fen: attrFen, source: 'attr' };
      } catch (e) {
        console.warn('[watcher] getFenAttribute threw:', e);
      }
    }

    if (typeof adapter.readPieceGrid === 'function') {
      try {
        const grid = adapter.readPieceGrid();
        if (grid) {
          const moves = adapter.getMoveList();
          const sideToMove = moves.length % 2 === 0 ? 'w' : 'b';
          const fen = composeFenFromGrid(grid, { sideToMove, moveCount: moves.length });
          return { fen, source: 'pieces' };
        }
      } catch (e) {
        console.warn('[watcher] readPieceGrid threw:', e);
      }
    }

    try {
      const sans = adapter.getMoveList();
      const start = adapter.getStartingFen() || STARTING_FEN;
      const fen = sansToFen(sans, start);
      return { fen, source: 'san' };
    } catch (e) {
      // Move list temporarily out of sync.
    }

    return null;
  }

  function readPosition() {
    const result = tryRead();
    if (!result) return;
    if (result.fen === lastFen) return;
    lastFen = result.fen;
    const sideToMove = result.fen.split(' ')[1] === 'w' ? 'white' : 'black';
    const orientation = adapter.getOrientation();
    console.log(`[watcher] new position via ${result.source}:`, result.fen);
    onPositionChange({ fen: result.fen, sideToMove, orientation, source: result.source });
  }

  readPosition();

  const unsub = adapter.observe(readPosition);

  return {
    stop: unsub,
    forceRead: readPosition
  };
}

module.exports = { createWatcher };
