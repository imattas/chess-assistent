// Board watcher: bridges an adapter to position-change events.
//
// Tries three strategies in order to compute a FEN. Piece-grid scrape is
// preferred over SAN replay because the move list is the most fragile part
// of either site's DOM and frequently goes missing on puzzle / practice /
// study pages — when that happens, replaying an empty move list yields the
// standard starting FEN, which silently passes the dedup check and pins the
// engine to the wrong position forever. The piece grid is the visual ground
// truth and works on every page that has a board element.
//
//   1. adapter.getFenAttribute()  — direct attribute read (rare, but free)
//   2. adapter.readPieceGrid()    — scrape pieces, infer castling rights
//   3. SAN replay via fen-replay  — chess.js replay (used only when piece
//                                    scrape fails to find any pieces)
//
// Emits onPositionChange({ fen, sideToMove, orientation, source }) on every
// new unique FEN. Source is one of 'attr', 'pieces', 'san' so callers can
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

    // 2. Piece scrape — preferred fallback because it reflects the actual
    //    visual state of the board regardless of whether a move list is
    //    rendered or where it lives in the DOM.
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

    // 3. SAN replay — last resort when piece scrape returns nothing.
    try {
      const sans = adapter.getMoveList();
      const start = adapter.getStartingFen() || STARTING_FEN;
      const fen = sansToFen(sans, start);
      return { fen, source: 'san' };
    } catch (e) {
      // Move list temporarily out of sync. Try again next mutation.
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
