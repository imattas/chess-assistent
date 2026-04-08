// Pure-logic SAN-replay module. No DOM, no top-level await.
//
// In the browser this file is consumed via dynamic import from main.js,
// where chess.js is already on `globalThis.Chess` (loaded by manifest's
// content_scripts.js array as `vendor/chess.min.js` BEFORE main.js runs).
//
// In Node tests, the test file must `import { Chess } from 'chess.js'` and
// assign `globalThis.Chess = Chess` before any sansToFen / uciToSan call.
// `ensureChess` is called lazily at use-time, so import order doesn't matter.

export const STARTING_FEN =
  'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

function ensureChess() {
  if (typeof globalThis.Chess === 'function') return globalThis.Chess;
  throw new Error(
    'chess.js is not loaded. In the browser, vendor/chess.min.js must run ' +
    'before this module. In Node tests, set globalThis.Chess from the ' +
    'chess.js package before calling sansToFen/uciToSan.'
  );
}

export function sansToFen(sans, startFen = STARTING_FEN) {
  const Chess = ensureChess();
  const game = new Chess(startFen);
  for (const san of sans) {
    const move = game.move(san);
    if (move === null) {
      throw new Error(`Illegal SAN move: ${san} at FEN ${game.fen()}`);
    }
  }
  return game.fen();
}

export function uciToSan(fen, uciMove) {
  const Chess = ensureChess();
  const game = new Chess(fen);
  // Parse UCI like "e2e4" or "e7e8q"
  const from = uciMove.slice(0, 2);
  const to = uciMove.slice(2, 4);
  const promotion = uciMove.length > 4 ? uciMove[4] : undefined;
  const move = game.move({ from, to, promotion });
  if (move === null) return uciMove;
  return move.san;
}
