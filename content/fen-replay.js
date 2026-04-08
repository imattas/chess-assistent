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

// Cheap structural FEN validity check. Catches the kingless / partial-scrape
// FENs that would crash Stockfish 16 NNUE with index-out-of-bounds. Not a
// legality check — just enough to prevent us from feeding garbage to the
// engine.
export function isValidFen(fen) {
  if (typeof fen !== 'string') return false;
  const parts = fen.trim().split(/\s+/);
  if (parts.length < 4) return false;
  const board = parts[0];
  if (!board.includes('K') || !board.includes('k')) return false;
  const ranks = board.split('/');
  if (ranks.length !== 8) return false;
  // Each rank's character widths must sum to 8.
  for (const rank of ranks) {
    let width = 0;
    for (const ch of rank) {
      if (/[1-8]/.test(ch)) width += parseInt(ch, 10);
      else if (/[prnbqkPRNBQK]/.test(ch)) width += 1;
      else return false;
    }
    if (width !== 8) return false;
  }
  if (parts[1] !== 'w' && parts[1] !== 'b') return false;
  return true;
}

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

// ---- Piece-grid → FEN helpers ----
//
// Adapters that scrape piece DOM directly produce an 8x8 grid where row 0 is
// rank 8 (black back rank) and row 7 is rank 1 (white back rank). Each cell
// is either null (empty) or a single character: uppercase = white, lowercase
// = black, in standard PNRBQK letters. Use `composeFenFromGrid` to turn that
// into a Stockfish-ready FEN with conservatively inferred castling rights.

export function gridToFen(grid) {
  const ranks = grid.map(row => {
    let out = '';
    let empty = 0;
    for (const cell of row) {
      if (cell) {
        if (empty) { out += empty; empty = 0; }
        out += cell;
      } else {
        empty++;
      }
    }
    if (empty) out += empty;
    return out;
  });
  return ranks.join('/');
}

// Castling rights inferred conservatively from king/rook positions on their
// starting squares. In standard chess a king or rook on its starting square
// has never moved (kings can't return there via legal moves; rooks similarly
// can't return to a corner once moved without being captured first), so this
// is sound, not a guess.
export function inferCastlingRights(grid) {
  let rights = '';
  if (grid[7][4] === 'K') {
    if (grid[7][7] === 'R') rights += 'K';
    if (grid[7][0] === 'R') rights += 'Q';
  }
  if (grid[0][4] === 'k') {
    if (grid[0][7] === 'r') rights += 'k';
    if (grid[0][0] === 'r') rights += 'q';
  }
  return rights || '-';
}

export function composeFenFromGrid(grid, { sideToMove = 'w', moveCount = 0 } = {}) {
  const board = gridToFen(grid);
  const castling = inferCastlingRights(grid);
  const fullmove = Math.floor(moveCount / 2) + 1;
  // En passant and halfmove clock are unknown from a static piece scrape;
  // '-' and 0 are conservative defaults that never produce illegal moves.
  return `${board} ${sideToMove} ${castling} - 0 ${fullmove}`;
}
