import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { createAdapter } from '../../content/adapters/chesscom.js';

function loadFixture(name) {
  const html = readFileSync(
    new URL(`./fixtures/${name}.html`, import.meta.url),
    'utf8'
  );
  return new JSDOM(html).window.document;
}

test('finds the board element', () => {
  const doc = loadFixture('chesscom-game-e4-e5');
  const a = createAdapter(doc);
  const board = a.getBoardElement();
  assert.ok(board, 'board should be found');
  assert.equal(board.tagName.toLowerCase(), 'chess-board');
});

test('reads the move list as SAN', () => {
  const doc = loadFixture('chesscom-game-e4-e5');
  const a = createAdapter(doc);
  assert.deepEqual(a.getMoveList(), ['e4', 'e5']);
});

test('default orientation is white', () => {
  const doc = loadFixture('chesscom-game-e4-e5');
  const a = createAdapter(doc);
  assert.equal(a.getOrientation(), 'white');
});

test('flipped orientation detected', () => {
  const doc = loadFixture('chesscom-game-e4-e5');
  doc.querySelector('chess-board').classList.add('flipped');
  const a = createAdapter(doc);
  assert.equal(a.getOrientation(), 'black');
});

test('observe fires on DOM mutation', async () => {
  const doc = loadFixture('chesscom-game-e4-e5');
  const a = createAdapter(doc);
  let calls = 0;
  const unsub = a.observe(() => { calls++; });
  // Append a new move
  const ml = doc.querySelector('wc-simple-move-list .move');
  const span = doc.createElement('span');
  span.className = 'node-highlight-content';
  span.dataset.ply = '3';
  span.textContent = 'Nf3';
  ml.appendChild(span);
  await new Promise(r => setTimeout(r, 80)); // wait for MO + debounce
  assert.ok(calls >= 1, `observe should have fired, got ${calls}`);
  unsub();
});
