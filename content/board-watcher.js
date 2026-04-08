// Board watcher: bridges an adapter to position-change events.
//
// Tries three strategies in order to compute a FEN, falling through on
// failure of each:
//
//   1. adapter.getFenAttribute()  — direct attribute read (best, free)
//   2. SAN replay via fen-replay  — chess.js replay of the move list
//   3. adapter.readPieceGrid()    — last-resort piece DOM scrape with
//                                    inferred castling rights
//
// Emits onPositionChange({ fen, sideToMove, orientation, source }) on every
// new unique FEN. Source is one of 'attr', 'san', 'pieces' so callers can
// log which strategy succeeded.

import { sansToFen, STARTING_FEN, composeFenFromGrid } from './fen-replay.js';

const log = (...args) => console.log('[chess-assistant:watcher]', ...args);

export function createWatcher(adapter, onPositionChange) {
  let lastFen = null;

  function tryRead() {
    if (!adapter.getBoardElement()) return null;

    // 1. Attribute
    if (typeof adapter.getFenAttribute === 'function') {
      try {
        const attrFen = adapter.getFenAttribute();
        if (attrFen) return { fen: attrFen, source: 'attr' };
      } catch (e) {
        console.warn('[chess-assistant:watcher] getFenAttribute threw:', e);
      }
    }

    // 2. SAN replay
    try {
      const sans = adapter.getMoveList();
      const start = adapter.getStartingFen() || STARTING_FEN;
      const fen = sansToFen(sans, start);
      return { fen, source: 'san' };
    } catch (e) {
      // SAN replay failed (DOM out of sync, or unknown move). Fall through
      // to piece scrape.
    }

    // 3. Piece scrape
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
        console.warn('[chess-assistant:watcher] readPieceGrid threw:', e);
      }
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
    log(`new position via ${result.source}:`, result.fen);
    onPositionChange({ fen: result.fen, sideToMove, orientation, source: result.source });
  }

  // Initial read
  readPosition();

  const unsub = adapter.observe(readPosition);

  return {
    stop: unsub,
    forceRead: readPosition
  };
}
