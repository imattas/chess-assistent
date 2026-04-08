// Pure-logic SAN-replay module. No DOM. Used by adapters and node tests.
// In the browser this file is consumed via dynamic import from content.js,
// where chess.js is already on globalThis (loaded by manifest content_scripts).
// In node tests we import chess.js directly.

let ChessCtor;
if (typeof globalThis.Chess === 'function') {
  ChessCtor = globalThis.Chess;
} else {
  const mod = await import('chess.js');
  ChessCtor = mod.Chess;
}

export const STARTING_FEN =
  'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

export function sansToFen(sans, startFen = STARTING_FEN) {
  const game = new ChessCtor(startFen);
  for (const san of sans) {
    const move = game.move(san);
    if (move === null) {
      throw new Error(`Illegal SAN move: ${san} at FEN ${game.fen()}`);
    }
  }
  return game.fen();
}

export function uciToSan(fen, uciMove) {
  const game = new ChessCtor(fen);
  // Parse UCI like "e2e4" or "e7e8q"
  const from = uciMove.slice(0, 2);
  const to = uciMove.slice(2, 4);
  const promotion = uciMove.length > 4 ? uciMove[4] : undefined;
  const move = game.move({ from, to, promotion });
  if (move === null) return uciMove;
  return move.san;
}
