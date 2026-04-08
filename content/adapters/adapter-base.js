// Adapter contract. This file is documentation only — JS has no interfaces.
// Each site adapter exports `createAdapter(rootDoc)` returning an object with:
//
//   getBoardElement(): HTMLElement | null
//     Returns the visible chess board element (the one we draw the arrow over).
//
//   getOrientation(): 'white' | 'black'
//     Which color is at the bottom of the board.
//
//   getMoveList(): string[]
//     Array of SAN strings in game order. Empty array for the starting position.
//
//   getStartingFen(): string | null
//     The custom starting FEN if the position is not standard (e.g. studies,
//     puzzles, Chess960). Null means use the standard starting FEN.
//
//   observe(callback): () => void
//     Calls `callback()` whenever the board state may have changed. Returns an
//     unsubscribe function. The callback receives no arguments — the watcher
//     re-reads everything via the getters above.

export const ADAPTER_INTERFACE = [
  'getBoardElement',
  'getOrientation',
  'getMoveList',
  'getStartingFen',
  'observe'
];
