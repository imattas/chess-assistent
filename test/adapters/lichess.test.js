import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { createAdapter } from '../../content/adapters/lichess.js';

function loadFixture(name) {
  const html = readFileSync(
    new URL(`./fixtures/${name}.html`, import.meta.url),
    'utf8'
  );
  return new JSDOM(html).window.document;
}

test('finds the board element', () => {
  const doc = loadFixture('lichess-game-d4-d5');
  const a = createAdapter(doc);
  const board = a.getBoardElement();
  assert.ok(board);
  assert.equal(board.tagName.toLowerCase(), 'cg-board');
});

test('reads SAN move list', () => {
  const doc = loadFixture('lichess-game-d4-d5');
  const a = createAdapter(doc);
  assert.deepEqual(a.getMoveList(), ['d4', 'd5']);
});

test('orientation white by default', () => {
  const doc = loadFixture('lichess-game-d4-d5');
  const a = createAdapter(doc);
  assert.equal(a.getOrientation(), 'white');
});

test('orientation black when class set', () => {
  const doc = loadFixture('lichess-game-d4-d5');
  const wrap = doc.querySelector('.cg-wrap');
  wrap.classList.remove('orientation-white');
  wrap.classList.add('orientation-black');
  const a = createAdapter(doc);
  assert.equal(a.getOrientation(), 'black');
});

test('observe fires on mutation', async () => {
  const doc = loadFixture('lichess-game-d4-d5');
  const a = createAdapter(doc);
  let calls = 0;
  const unsub = a.observe(() => { calls++; });
  const l4x = doc.querySelector('l4x');
  const u8t = doc.createElement('u8t');
  u8t.setAttribute('san', 'Nf3');
  u8t.textContent = 'Nf3';
  l4x.appendChild(u8t);
  await new Promise(r => setTimeout(r, 80));
  assert.ok(calls >= 1);
  unsub();
});
