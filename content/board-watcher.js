// Board watcher: bridges an adapter to position-change events.
// Calls onPositionChange({ fen, sideToMove, orientation }) on each new unique
// position.

import { sansToFen, STARTING_FEN } from './fen-replay.js';

export function createWatcher(adapter, onPositionChange) {
  let lastFen = null;

  function readPosition() {
    let fen;
    try {
      const sans = adapter.getMoveList();
      const start = adapter.getStartingFen() || STARTING_FEN;
      fen = sansToFen(sans, start);
    } catch (e) {
      // SAN replay failed (DOM out of sync, or unknown move). Skip silently;
      // we'll try again on the next mutation.
      return;
    }
    if (fen === lastFen) return;
    lastFen = fen;
    const sideToMove = fen.split(' ')[1] === 'w' ? 'white' : 'black';
    const orientation = adapter.getOrientation();
    onPositionChange({ fen, sideToMove, orientation });
  }

  // Initial read
  readPosition();

  const unsub = adapter.observe(readPosition);

  return {
    stop: unsub,
    forceRead: readPosition
  };
}
