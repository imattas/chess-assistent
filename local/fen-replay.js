// Pure-logic SAN-replay module. CommonJS version for Electron. Uses the
// `chess.js` npm package directly (no globalThis dance needed here).

const { Chess } = require('chess.js');

const STARTING_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

function sansToFen(sans, startFen = STARTING_FEN) {
  const game = new Chess(startFen);
  for (const san of sans) {
    const move = game.move(san);
    if (move === null) {
      throw new Error(`Illegal SAN move: ${san} at FEN ${game.fen()}`);
    }
  }
  return game.fen();
}

function uciToSan(fen, uciMove) {
  const game = new Chess(fen);
  const from = uciMove.slice(0, 2);
  const to = uciMove.slice(2, 4);
  const promotion = uciMove.length > 4 ? uciMove[4] : undefined;
  const move = game.move({ from, to, promotion });
  if (move === null) return uciMove;
  return move.san;
}

function gridToFen(grid) {
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

function inferCastlingRights(grid) {
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

function composeFenFromGrid(grid, { sideToMove = 'w', moveCount = 0 } = {}) {
  const board = gridToFen(grid);
  const castling = inferCastlingRights(grid);
  const fullmove = Math.floor(moveCount / 2) + 1;
  return `${board} ${sideToMove} ${castling} - 0 ${fullmove}`;
}

function isValidFen(fen) {
  if (typeof fen !== 'string') return false;
  const parts = fen.trim().split(/\s+/);
  if (parts.length < 4) return false;
  const board = parts[0];
  if (!board.includes('K') || !board.includes('k')) return false;
  const ranks = board.split('/');
  if (ranks.length !== 8) return false;
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

module.exports = {
  STARTING_FEN,
  sansToFen,
  uciToSan,
  gridToFen,
  inferCastlingRights,
  composeFenFromGrid,
  isValidFen
};
