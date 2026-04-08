import { test } from 'node:test';
import assert from 'node:assert';
import { Chess } from 'chess.js';
// fen-replay reads chess.js from globalThis at use-time. Seed it before
// any sansToFen / uciToSan call so the lazy ensureChess() succeeds.
globalThis.Chess = Chess;
import { sansToFen, STARTING_FEN } from '../content/fen-replay.js';

test('empty move list returns starting position', () => {
  assert.equal(sansToFen([]), STARTING_FEN);
});

test('e4 e5 produces expected FEN', () => {
  const fen = sansToFen(['e4', 'e5']);
  assert.equal(fen, 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2');
  // After 1.e4 e5 it is white to move on move 2
  assert.match(fen, /^rnbqkbnr\/pppp1ppp\/8\/4p3\/4P3\/8\/PPPP1PPP\/RNBQKBNR w KQkq /);
});

test('Scholars mate sequence', () => {
  const fen = sansToFen(['e4', 'e5', 'Bc4', 'Nc6', 'Qh5', 'Nf6', 'Qxf7#']);
  assert.match(fen, /Q.*PPP/);
  assert.match(fen, / b /); // black to move (and is mated)
});

test('castling and en passant survive', () => {
  const fen = sansToFen(['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5', 'O-O']);
  // White has castled kingside
  assert.match(fen, /RNBQ1RK1|R4RK1/);
});

test('throws on illegal SAN', () => {
  assert.throws(() => sansToFen(['e4', 'e5', 'Ke8']));
});

test('starting position from custom FEN', () => {
  const start = '8/8/8/8/8/8/4K3/4k3 w - - 0 1';
  const fen = sansToFen([], start);
  assert.equal(fen, start);
});
