# Chess Assistant Extension Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a single MV3 cross-browser (Chrome + Firefox) extension that runs Stockfish locally and overlays move suggestions on chess.com and lichess boards. No automove — overlay only. See `docs/superpowers/specs/2026-04-08-chess-assistant-extension-design.md` for the full design.

**Architecture:** Plain ES modules, no bundler. One MV3 manifest works for both browsers via `browser_specific_settings`. Per tab: a content script loads a site adapter, watches the board via `MutationObserver`, replays the move list through `chess.js` to get a FEN, and feeds it to a single-thread Stockfish WASM running in a Web Worker. Suggestions are rendered as an SVG arrow over the board plus a draggable side panel.

**Tech Stack:** JavaScript (ES2022), MV3 manifest, `chess.js` (vendored UMD), `stockfish` WASM (single-thread, vendored), `webextension-polyfill`, Node 20+ built-in test runner (`node --test`), `jsdom` for adapter tests.

---

## File structure (target end state)

```
chess-assistant/
  manifest.json
  background.js
  popup/
    popup.html
    popup.css
    popup.js
  content/
    content.js
    adapters/
      adapter-base.js
      chesscom.js
      lichess.js
    board-watcher.js
    fen-replay.js
    settings.js
    hotkeys.js
    overlay/
      arrow.js
      panel.js
      overlay.css
  engine/
    stockfish.js          (vendored)
    stockfish.wasm        (vendored)
    engine-bridge.js
  vendor/
    chess.min.js          (vendored UMD build)
    browser-polyfill.min.js
  icons/
    16.png 32.png 48.png 128.png
  scripts/
    build.sh
  test/
    fen-replay.test.js
    settings.test.js
    engine-bridge.test.js
    adapters/
      chesscom.test.js
      lichess.test.js
      fixtures/
        chesscom-game-e4-e5.html
        chesscom-puzzle.html
        lichess-game-d4-d5.html
        lichess-analysis.html
        lichess-puzzle.html
  package.json            (devDeps: jsdom; scripts: test, build)
  .gitignore
  README.md
```

Each file has one responsibility. The adapters are isolated so a chess.com or lichess DOM change only touches one file. The engine bridge is the only file that speaks UCI. The overlay is the only file that touches host-page DOM for rendering.

---

## Task 1: Project scaffold

**Files:**
- Create: `package.json`
- Create: `.gitignore`
- Create: `README.md` (stub)

- [ ] **Step 1: Create `.gitignore`**

```
node_modules/
dist/
*.log
.DS_Store
```

- [ ] **Step 2: Create `package.json`**

```json
{
  "name": "chess-assistant",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node --test test/",
    "build": "bash scripts/build.sh"
  },
  "devDependencies": {
    "jsdom": "^24.0.0",
    "chess.js": "^1.0.0"
  }
}
```

- [ ] **Step 3: Create `README.md` stub**

```markdown
# Chess Assistant

Cross-browser (Chrome + Firefox) extension that overlays Stockfish suggestions on chess.com and lichess. See `docs/superpowers/specs/2026-04-08-chess-assistant-extension-design.md`.
```

- [ ] **Step 4: Install dev deps**

Run: `npm install`
Expected: creates `node_modules/`, no errors.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json .gitignore README.md
git commit -m "scaffold: package.json + gitignore + readme stub"
```

---

## Task 2: Vendor third-party libraries

**Files:**
- Create: `vendor/chess.min.js`
- Create: `vendor/browser-polyfill.min.js`
- Create: `engine/stockfish.js`
- Create: `engine/stockfish.wasm`

- [ ] **Step 1: Vendor chess.js as a browser-loadable UMD**

`chess.js` v1 is ESM-only. We need a build that exposes `globalThis.Chess` so content scripts can use it without modules.

Run:
```bash
mkdir -p vendor
npm install --no-save chess.js@1
```

Then create `vendor/chess.min.js` by writing a tiny UMD wrapper that re-exports Chess from the installed package:

```bash
cat > /tmp/chess-umd.mjs <<'EOF'
import { Chess } from 'chess.js';
globalThis.Chess = Chess;
EOF
```

We'll bundle this with esbuild (added inline, no permanent dep):
```bash
npx --yes esbuild@0.21.0 /tmp/chess-umd.mjs --bundle --format=iife --minify --outfile=vendor/chess.min.js
```

Expected: `vendor/chess.min.js` exists and is a single-file IIFE that sets `globalThis.Chess`.

- [ ] **Step 2: Vendor webextension-polyfill**

Run:
```bash
npm install --no-save webextension-polyfill@0.12.0
cp node_modules/webextension-polyfill/dist/browser-polyfill.min.js vendor/browser-polyfill.min.js
```

Expected: `vendor/browser-polyfill.min.js` exists.

- [ ] **Step 3: Vendor Stockfish WASM (single-thread build)**

Run:
```bash
mkdir -p engine
npm install --no-save stockfish@16.0.0
```

The `stockfish` npm package ships multiple builds. We use the single-thread WASM build (no `SharedArrayBuffer` required). Locate and copy the single-thread build files:

```bash
ls node_modules/stockfish/src/
```

Copy the single-threaded build (typical filenames; verify against the listing):
```bash
cp node_modules/stockfish/src/stockfish-nnue-16-single.js engine/stockfish.js
cp node_modules/stockfish/src/stockfish-nnue-16-single.wasm engine/stockfish.wasm
```

If the filenames differ in this version, copy whichever pair contains "single" in the name (single-thread, no `-mv` / no `-postinc`). Update the path inside `engine/stockfish.js` if it references the `.wasm` by name — open it and confirm it loads `stockfish.wasm` from the same directory.

Expected: both files in `engine/`, total ~40MB unzipped (NNUE network is large). The NNUE network may be inside the JS or as a separate file — copy any `.nnue` file too if present.

- [ ] **Step 4: Verify file presence**

Run:
```bash
ls -la vendor/ engine/
```
Expected: shows `chess.min.js`, `browser-polyfill.min.js`, `stockfish.js`, `stockfish.wasm` (and possibly an `.nnue` file).

- [ ] **Step 5: Commit**

```bash
git add vendor/ engine/
git commit -m "vendor: chess.js UMD, webextension-polyfill, stockfish single-thread WASM"
```

---

## Task 3: FEN replay module + tests

**Files:**
- Create: `content/fen-replay.js`
- Create: `test/fen-replay.test.js`

This is pure logic that converts a list of SAN strings into a FEN. Lives in `content/` because it's used by adapters and the watcher, but it has zero DOM dependencies and is fully unit-testable.

- [ ] **Step 1: Write the failing test**

Create `test/fen-replay.test.js`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert';
import { sansToFen, STARTING_FEN } from '../content/fen-replay.js';

test('empty move list returns starting position', () => {
  assert.equal(sansToFen([]), STARTING_FEN);
});

test('e4 e5 produces expected FEN', () => {
  const fen = sansToFen(['e4', 'e5']);
  assert.equal(fen, 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 3'.replace(' w ', ' w '));
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
  assert.match(fen, /R[^\/]*K[^\/]*1$|R4RK1/);
});

test('throws on illegal SAN', () => {
  assert.throws(() => sansToFen(['e4', 'e5', 'Ke8']));
});

test('starting position from custom FEN', () => {
  const start = '8/8/8/8/8/8/4K3/4k3 w - - 0 1';
  const fen = sansToFen([], start);
  assert.equal(fen, start);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL with `Cannot find module '../content/fen-replay.js'`.

- [ ] **Step 3: Implement `content/fen-replay.js`**

```javascript
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
```

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: all 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add content/fen-replay.js test/fen-replay.test.js
git commit -m "feat(fen-replay): SAN→FEN replay + UCI→SAN converter"
```

---

## Task 4: Settings module + tests

**Files:**
- Create: `content/settings.js`
- Create: `test/settings.test.js`

The settings module owns the storage shape and defaults. Tests run against a fake `browser.storage` so we never need a real browser.

- [ ] **Step 1: Write the failing test**

Create `test/settings.test.js`:

```javascript
import { test, beforeEach } from 'node:test';
import assert from 'node:assert';
import { loadSettings, saveSettings, DEFAULT_SETTINGS, subscribe }
  from '../content/settings.js';

let store;
const listeners = [];

function installFakeBrowser() {
  store = {};
  global.browser = {
    storage: {
      sync: {
        async get(key) {
          if (key === null || key === undefined) return { ...store };
          if (typeof key === 'string') return { [key]: store[key] };
          return Object.fromEntries(
            Object.keys(key).map(k => [k, store[k] ?? key[k]])
          );
        },
        async set(obj) {
          Object.assign(store, obj);
          for (const fn of listeners) fn(obj, 'sync');
        }
      },
      onChanged: {
        addListener(fn) { listeners.push(fn); },
        removeListener(fn) {
          const i = listeners.indexOf(fn);
          if (i >= 0) listeners.splice(i, 1);
        }
      }
    }
  };
}

beforeEach(() => {
  installFakeBrowser();
});

test('loadSettings returns defaults when storage empty', async () => {
  const s = await loadSettings();
  assert.deepEqual(s, DEFAULT_SETTINGS);
});

test('saveSettings persists partial updates', async () => {
  await saveSettings({ engine: { ...DEFAULT_SETTINGS.engine, elo: 1800 } });
  const s = await loadSettings();
  assert.equal(s.engine.elo, 1800);
  assert.equal(s.engine.mode, DEFAULT_SETTINGS.engine.mode);
});

test('subscribe fires on change', async () => {
  let received = null;
  const unsub = subscribe(s => { received = s; });
  await saveSettings({ enabled: false });
  // microtask flush
  await new Promise(r => setTimeout(r, 0));
  assert.equal(received.enabled, false);
  unsub();
});

test('defaults are valid', () => {
  assert.equal(DEFAULT_SETTINGS.version, 1);
  assert.equal(DEFAULT_SETTINGS.enabled, true);
  assert.equal(DEFAULT_SETTINGS.trigger, 'auto');
  assert.equal(DEFAULT_SETTINGS.hotkey, 'Alt+A');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL with `Cannot find module '../content/settings.js'`.

- [ ] **Step 3: Implement `content/settings.js`**

```javascript
// Settings module. Wraps browser.storage.sync with defaults and a subscribe API.
// In node tests, the test installs a fake `global.browser`.
// In the browser, `browser` is provided by browser-polyfill.min.js (loaded
// before this module by the manifest content_scripts entry).

export const DEFAULT_SETTINGS = Object.freeze({
  version: 1,
  enabled: true,
  sites: { chesscom: true, lichess: true },
  engine: {
    elo: 2400,
    limitStrength: true,
    mode: 'time',     // 'time' | 'depth'
    timeMs: 1000,
    depth: 18
  },
  trigger: 'auto',    // 'auto' | 'myTurn' | 'hotkey'
  hotkey: 'Alt+A',
  display: {
    arrow: true,
    panel: true,
    evalBar: true,
    pvLines: true
  },
  panelPosition: { x: 24, y: 24 }
});

const STORAGE_KEY = 'chessAssistantSettings';

function deepMerge(base, overlay) {
  if (overlay === undefined || overlay === null) return base;
  if (typeof base !== 'object' || base === null) return overlay;
  const out = Array.isArray(base) ? [...base] : { ...base };
  for (const key of Object.keys(overlay)) {
    out[key] = deepMerge(base[key], overlay[key]);
  }
  return out;
}

export async function loadSettings() {
  const result = await browser.storage.sync.get(STORAGE_KEY);
  const stored = result[STORAGE_KEY];
  return deepMerge(DEFAULT_SETTINGS, stored);
}

export async function saveSettings(partial) {
  const current = await loadSettings();
  const merged = deepMerge(current, partial);
  await browser.storage.sync.set({ [STORAGE_KEY]: merged });
  return merged;
}

const subscribers = new Set();
let listenerInstalled = false;

function installListener() {
  if (listenerInstalled) return;
  listenerInstalled = true;
  browser.storage.onChanged.addListener(async (changes, area) => {
    if (area !== 'sync' || !changes[STORAGE_KEY]) return;
    const next = await loadSettings();
    for (const fn of subscribers) {
      try { fn(next); } catch (e) { console.error('settings subscriber threw', e); }
    }
  });
}

export function subscribe(fn) {
  installListener();
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}
```

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: all 4 settings tests pass, plus the 6 from Task 3.

- [ ] **Step 5: Commit**

```bash
git add content/settings.js test/settings.test.js
git commit -m "feat(settings): storage wrapper with defaults + subscribe API"
```

---

## Task 5: Adapter base + chess.com adapter + tests

**Files:**
- Create: `content/adapters/adapter-base.js`
- Create: `content/adapters/chesscom.js`
- Create: `test/adapters/fixtures/chesscom-game-e4-e5.html`
- Create: `test/adapters/chesscom.test.js`

Each adapter exports a single `createAdapter(rootDoc)` function that returns:
```
{
  getBoardElement(): HTMLElement | null,
  getOrientation(): 'white' | 'black',
  getMoveList(): string[],   // SAN
  getStartingFen(): string | null,  // null = standard start
  observe(callback): () => void     // returns unsubscribe
}
```

- [ ] **Step 1: Create the base interface as documentation**

Create `content/adapters/adapter-base.js`:

```javascript
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
```

- [ ] **Step 2: Create the chess.com fixture**

Create `test/adapters/fixtures/chesscom-game-e4-e5.html`:

```html
<!doctype html>
<html><body>
  <chess-board class="board" id="board-single"></chess-board>
  <wc-simple-move-list class="move-list-wrapper">
    <div class="move">
      <span class="node-highlight-content selected" data-ply="1">e4</span>
      <span class="node-highlight-content" data-ply="2">e5</span>
    </div>
  </wc-simple-move-list>
</body></html>
```

- [ ] **Step 3: Write the failing test**

Create `test/adapters/chesscom.test.js`:

```javascript
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
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npm test`
Expected: FAIL with `Cannot find module '../../content/adapters/chesscom.js'`.

- [ ] **Step 5: Implement `content/adapters/chesscom.js`**

```javascript
// chess.com adapter. DOM scraping is isolated to this file.

export function createAdapter(rootDoc = document) {
  function getBoardElement() {
    return rootDoc.querySelector('chess-board');
  }

  function getOrientation() {
    const board = getBoardElement();
    if (!board) return 'white';
    return board.classList.contains('flipped') ? 'black' : 'white';
  }

  function getMoveList() {
    // Live games and analysis use wc-simple-move-list with .node-highlight-content spans
    // containing SAN. Each span has data-ply ordering.
    const nodes = rootDoc.querySelectorAll(
      'wc-simple-move-list .node-highlight-content, ' +
      '.move-list-wrapper .node-highlight-content'
    );
    if (nodes.length === 0) return [];
    const sorted = Array.from(nodes).sort((a, b) => {
      const pa = parseInt(a.dataset.ply || '0', 10);
      const pb = parseInt(b.dataset.ply || '0', 10);
      return pa - pb;
    });
    return sorted.map(n => n.textContent.trim()).filter(Boolean);
  }

  function getStartingFen() {
    // chess.com puzzle / analysis pages may expose a starting FEN attribute.
    // We check the board element for an `fen` attribute that does not match
    // the standard start.
    const board = getBoardElement();
    if (!board) return null;
    const attr = board.getAttribute('fen');
    if (!attr) return null;
    if (attr.startsWith('rnbqkbnr/pppppppp')) return null;
    return attr;
  }

  function observe(callback) {
    let timer = null;
    const fire = () => {
      clearTimeout(timer);
      timer = setTimeout(callback, 50);
    };
    const target = rootDoc.body || rootDoc.documentElement;
    const mo = new (rootDoc.defaultView || globalThis).MutationObserver(fire);
    mo.observe(target, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['class', 'fen', 'data-ply']
    });
    return () => { mo.disconnect(); clearTimeout(timer); };
  }

  return { getBoardElement, getOrientation, getMoveList, getStartingFen, observe };
}
```

- [ ] **Step 6: Run tests**

Run: `npm test`
Expected: all 5 chesscom adapter tests pass.

- [ ] **Step 7: Commit**

```bash
git add content/adapters/adapter-base.js content/adapters/chesscom.js \
        test/adapters/chesscom.test.js test/adapters/fixtures/chesscom-game-e4-e5.html
git commit -m "feat(adapter): chess.com adapter with fixture-based tests"
```

---

## Task 6: lichess adapter + tests

**Files:**
- Create: `content/adapters/lichess.js`
- Create: `test/adapters/fixtures/lichess-game-d4-d5.html`
- Create: `test/adapters/lichess.test.js`

- [ ] **Step 1: Create the lichess fixture**

Create `test/adapters/fixtures/lichess-game-d4-d5.html`:

```html
<!doctype html>
<html><body>
  <main class="round">
    <div class="cg-wrap orientation-white">
      <cg-board>
        <piece class="white pawn" style="transform: translate(300px, 100px);"></piece>
      </cg-board>
    </div>
    <l4x>
      <kwdb>1.</kwdb>
      <u8t san="d4">d4</u8t>
      <u8t san="d5">d5</u8t>
    </l4x>
  </main>
</body></html>
```

- [ ] **Step 2: Write the failing test**

Create `test/adapters/lichess.test.js`:

```javascript
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
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test`
Expected: FAIL with `Cannot find module '../../content/adapters/lichess.js'`.

- [ ] **Step 4: Implement `content/adapters/lichess.js`**

```javascript
// lichess.org adapter. DOM scraping isolated here.

export function createAdapter(rootDoc = document) {
  function getBoardElement() {
    return rootDoc.querySelector('cg-board');
  }

  function getOrientation() {
    const wrap = rootDoc.querySelector('.cg-wrap');
    if (!wrap) return 'white';
    if (wrap.classList.contains('orientation-black')) return 'black';
    return 'white';
  }

  function getMoveList() {
    // Live games:    <l4x><u8t san="...">SAN</u8t>...</l4x>
    // Analysis:      .analyse__moves with similar nodes
    // Puzzles:       .puzzle__moves with similar nodes
    const nodes = rootDoc.querySelectorAll(
      'l4x u8t[san], .analyse__moves u8t[san], .puzzle__moves u8t[san]'
    );
    if (nodes.length === 0) {
      // Fallback: look for any [san] element inside a moves container
      const fallback = rootDoc.querySelectorAll(
        'l4x [san], .analyse__moves [san], .puzzle__moves [san]'
      );
      return Array.from(fallback)
        .map(n => n.getAttribute('san'))
        .filter(Boolean);
    }
    return Array.from(nodes)
      .map(n => n.getAttribute('san'))
      .filter(Boolean);
  }

  function getStartingFen() {
    // Studies and analysis can ship custom FENs in <div class="pgn"> headers
    // or as data-fen on the board container.
    const wrap = rootDoc.querySelector('.cg-wrap, .main-board');
    const fen = wrap && wrap.getAttribute('data-fen');
    if (fen && !fen.startsWith('rnbqkbnr/pppppppp')) return fen;
    return null;
  }

  function observe(callback) {
    let timer = null;
    const fire = () => {
      clearTimeout(timer);
      timer = setTimeout(callback, 50);
    };
    const target = rootDoc.body || rootDoc.documentElement;
    const mo = new (rootDoc.defaultView || globalThis).MutationObserver(fire);
    mo.observe(target, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['class', 'san', 'data-fen']
    });
    return () => { mo.disconnect(); clearTimeout(timer); };
  }

  return { getBoardElement, getOrientation, getMoveList, getStartingFen, observe };
}
```

- [ ] **Step 5: Run tests**

Run: `npm test`
Expected: all 5 lichess adapter tests pass.

- [ ] **Step 6: Commit**

```bash
git add content/adapters/lichess.js test/adapters/lichess.test.js \
        test/adapters/fixtures/lichess-game-d4-d5.html
git commit -m "feat(adapter): lichess adapter with fixture-based tests"
```

---

## Task 7: Board watcher

**Files:**
- Create: `content/board-watcher.js`

The watcher composes an adapter + the FEN replay module and emits position-change events. No tests directly — the adapter tests already cover DOM observation, and the FEN replay tests cover SAN→FEN. The watcher is glue.

- [ ] **Step 1: Implement `content/board-watcher.js`**

```javascript
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
```

- [ ] **Step 2: Smoke-check syntax via node**

Run:
```bash
node --input-type=module -e "import('./content/board-watcher.js').then(m => console.log(Object.keys(m)));"
```
Expected: `[ 'createWatcher' ]`

- [ ] **Step 3: Commit**

```bash
git add content/board-watcher.js
git commit -m "feat(watcher): adapter→FEN-event bridge with dedup"
```

---

## Task 8: Engine bridge + tests (with mock worker)

**Files:**
- Create: `engine/engine-bridge.js`
- Create: `test/engine-bridge.test.js`

The bridge speaks UCI to a `Worker`-like object. We test it with a fake worker so we don't need real Stockfish in CI. Real Stockfish gets exercised manually via the smoke-test checklist.

- [ ] **Step 1: Write the failing test**

Create `test/engine-bridge.test.js`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert';
import { createEngineBridge } from '../engine/engine-bridge.js';

class FakeWorker {
  constructor() {
    this.sent = [];
    this.onmessage = null;
  }
  postMessage(line) {
    this.sent.push(line);
    // Simulate Stockfish responses for the lines we care about.
    queueMicrotask(() => {
      if (line === 'uci') {
        this._send('id name Fakefish');
        this._send('uciok');
      } else if (line === 'isready') {
        this._send('readyok');
      } else if (line.startsWith('go ')) {
        this._send('info depth 5 score cp 23 pv e2e4 e7e5 g1f3');
        this._send('info depth 6 score cp 27 pv e2e4 e7e5 g1f3 b8c6');
        this._send('bestmove e2e4 ponder e7e5');
      }
    });
  }
  _send(text) {
    if (this.onmessage) this.onmessage({ data: text });
  }
  terminate() {}
}

test('bridge exposes setOptions / analyze / stop', async () => {
  const w = new FakeWorker();
  const bridge = createEngineBridge(w);
  await bridge.ready();
  assert.ok(w.sent.includes('uci'));
  assert.ok(w.sent.includes('isready'));
});

test('setOptions sends LimitStrength + Elo when limited', async () => {
  const w = new FakeWorker();
  const bridge = createEngineBridge(w);
  await bridge.ready();
  await bridge.setOptions({ elo: 1800, limitStrength: true });
  assert.ok(w.sent.includes('setoption name UCI_LimitStrength value true'));
  assert.ok(w.sent.includes('setoption name UCI_Elo value 1800'));
});

test('setOptions disables LimitStrength when unlimited', async () => {
  const w = new FakeWorker();
  const bridge = createEngineBridge(w);
  await bridge.ready();
  await bridge.setOptions({ limitStrength: false });
  assert.ok(w.sent.includes('setoption name UCI_LimitStrength value false'));
});

test('analyze emits info events and resolves with bestmove', async () => {
  const w = new FakeWorker();
  const bridge = createEngineBridge(w);
  await bridge.ready();
  const infos = [];
  const result = await bridge.analyze(
    'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    { mode: 'time', value: 100 },
    info => infos.push(info)
  );
  assert.ok(infos.length >= 2);
  assert.equal(infos.at(-1).depth, 6);
  assert.equal(infos.at(-1).scoreCp, 27);
  assert.deepEqual(infos.at(-1).pv, ['e2e4', 'e7e5', 'g1f3', 'b8c6']);
  assert.equal(result.bestmove, 'e2e4');
});

test('stop sends stop command', async () => {
  const w = new FakeWorker();
  const bridge = createEngineBridge(w);
  await bridge.ready();
  bridge.stop();
  assert.ok(w.sent.includes('stop'));
});

test('analyze with depth mode sends go depth', async () => {
  const w = new FakeWorker();
  const bridge = createEngineBridge(w);
  await bridge.ready();
  await bridge.analyze(
    'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    { mode: 'depth', value: 12 },
    () => {}
  );
  assert.ok(w.sent.some(l => l === 'go depth 12'));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL with `Cannot find module '../engine/engine-bridge.js'`.

- [ ] **Step 3: Implement `engine/engine-bridge.js`**

```javascript
// UCI bridge over a Worker. The Worker is injected so this module is
// trivially testable with a FakeWorker.

export function createEngineBridge(worker) {
  let readyResolve;
  const readyPromise = new Promise(r => { readyResolve = r; });
  let currentInfoListener = null;
  let currentBestmoveResolve = null;
  let currentBestmoveReject = null;

  function send(line) {
    worker.postMessage(line);
  }

  function parseInfoLine(line) {
    // info depth N score cp X|mate Y pv m1 m2 m3
    const parts = line.split(' ');
    const info = { depth: 0, scoreCp: null, scoreMate: null, pv: [] };
    for (let i = 0; i < parts.length; i++) {
      const tok = parts[i];
      if (tok === 'depth') info.depth = parseInt(parts[++i], 10);
      else if (tok === 'score') {
        const kind = parts[++i];
        const val = parseInt(parts[++i], 10);
        if (kind === 'cp') info.scoreCp = val;
        else if (kind === 'mate') info.scoreMate = val;
      } else if (tok === 'pv') {
        info.pv = parts.slice(i + 1);
        break;
      }
    }
    return info;
  }

  worker.onmessage = (ev) => {
    const text = typeof ev.data === 'string' ? ev.data : String(ev.data);
    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (trimmed === 'uciok') {
        // wait for readyok before resolving
      } else if (trimmed === 'readyok') {
        if (readyResolve) { readyResolve(); readyResolve = null; }
      } else if (trimmed.startsWith('info ') && trimmed.includes(' pv ')) {
        if (currentInfoListener) {
          currentInfoListener(parseInfoLine(trimmed));
        }
      } else if (trimmed.startsWith('bestmove ')) {
        const parts = trimmed.split(' ');
        const bestmove = parts[1];
        const ponder = parts[3];
        if (currentBestmoveResolve) {
          currentBestmoveResolve({ bestmove, ponder });
          currentBestmoveResolve = null;
          currentBestmoveReject = null;
          currentInfoListener = null;
        }
      }
    }
  };

  send('uci');
  send('isready');

  async function ready() {
    return readyPromise;
  }

  async function setOptions({ elo, limitStrength, hash, threads }) {
    if (typeof limitStrength === 'boolean') {
      send(`setoption name UCI_LimitStrength value ${limitStrength}`);
    }
    if (typeof elo === 'number' && limitStrength !== false) {
      send(`setoption name UCI_Elo value ${elo}`);
    }
    if (typeof hash === 'number') {
      send(`setoption name Hash value ${hash}`);
    }
    if (typeof threads === 'number') {
      send(`setoption name Threads value ${threads}`);
    }
  }

  function analyze(fen, { mode, value }, onInfo) {
    // Cancel any previous search
    if (currentBestmoveReject) {
      currentBestmoveReject(new Error('superseded'));
      currentBestmoveResolve = null;
      currentBestmoveReject = null;
      send('stop');
    }
    currentInfoListener = onInfo || (() => {});
    const promise = new Promise((resolve, reject) => {
      currentBestmoveResolve = resolve;
      currentBestmoveReject = reject;
    });
    send(`position fen ${fen}`);
    if (mode === 'depth') {
      send(`go depth ${value}`);
    } else {
      send(`go movetime ${value}`);
    }
    return promise;
  }

  function stop() {
    send('stop');
  }

  function destroy() {
    try { worker.terminate(); } catch {}
  }

  return { ready, setOptions, analyze, stop, destroy };
}
```

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: all 6 engine-bridge tests pass.

- [ ] **Step 5: Commit**

```bash
git add engine/engine-bridge.js test/engine-bridge.test.js
git commit -m "feat(engine): UCI bridge with Fake-Worker tests"
```

---

## Task 9: Hotkey module

**Files:**
- Create: `content/hotkeys.js`

Small enough to skip a test file — the logic is one function and is exercised manually.

- [ ] **Step 1: Implement `content/hotkeys.js`**

```javascript
// Hotkey listener. Parses combo strings like "Alt+A" or "Ctrl+Shift+P"
// and fires a callback when matched. Designed for use in a content script
// where we deliberately avoid the manifest `commands` key (so users can rebind
// at runtime via the popup).

function normalizeCombo(combo) {
  // "Alt+A" → { alt: true, ctrl: false, shift: false, meta: false, key: 'a' }
  const parts = combo.split('+').map(s => s.trim().toLowerCase());
  const out = { alt: false, ctrl: false, shift: false, meta: false, key: '' };
  for (const p of parts) {
    if (p === 'alt') out.alt = true;
    else if (p === 'ctrl' || p === 'control') out.ctrl = true;
    else if (p === 'shift') out.shift = true;
    else if (p === 'meta' || p === 'cmd' || p === 'command') out.meta = true;
    else out.key = p;
  }
  return out;
}

export function installHotkey(getCombo, onTrigger) {
  function handler(e) {
    const combo = getCombo();
    if (!combo) return;
    const want = normalizeCombo(combo);
    if (e.altKey !== want.alt) return;
    if (e.ctrlKey !== want.ctrl) return;
    if (e.shiftKey !== want.shift) return;
    if (e.metaKey !== want.meta) return;
    if (e.key.toLowerCase() !== want.key) return;
    e.preventDefault();
    onTrigger();
  }
  window.addEventListener('keydown', handler, true);
  return () => window.removeEventListener('keydown', handler, true);
}

export function captureCombo(onCaptured) {
  // Used by the popup UI: returns the next pressed key combo.
  function handler(e) {
    e.preventDefault();
    e.stopPropagation();
    const parts = [];
    if (e.ctrlKey) parts.push('Ctrl');
    if (e.altKey) parts.push('Alt');
    if (e.shiftKey) parts.push('Shift');
    if (e.metaKey) parts.push('Meta');
    if (e.key.length === 1) parts.push(e.key.toUpperCase());
    else if (!['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) parts.push(e.key);
    if (parts.length === 0 || parts.every(p => ['Ctrl','Alt','Shift','Meta'].includes(p))) {
      return; // wait for a real key
    }
    window.removeEventListener('keydown', handler, true);
    onCaptured(parts.join('+'));
  }
  window.addEventListener('keydown', handler, true);
  return () => window.removeEventListener('keydown', handler, true);
}
```

- [ ] **Step 2: Commit**

```bash
git add content/hotkeys.js
git commit -m "feat(hotkeys): rebindable keydown listener + popup capture helper"
```

---

## Task 10: Overlay arrow

**Files:**
- Create: `content/overlay/arrow.js`
- Create: `content/overlay/overlay.css`

- [ ] **Step 1: Create `content/overlay/overlay.css`**

```css
/* Scoped under #sf-overlay-* IDs to avoid collisions with host page CSS. */

#sf-overlay-arrow-svg {
  position: absolute;
  top: 0;
  left: 0;
  pointer-events: none;
  z-index: 99998;
  overflow: visible;
}

#sf-overlay-panel {
  all: initial;
  position: fixed;
  z-index: 99999;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  font-size: 13px;
  color: #e8e8e8;
  background: rgba(20, 22, 28, 0.94);
  border: 1px solid #2a2d36;
  border-radius: 10px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
  padding: 0;
  width: 260px;
  user-select: none;
}

#sf-overlay-panel * {
  box-sizing: border-box;
  font-family: inherit;
  color: inherit;
}

#sf-overlay-panel-header {
  cursor: move;
  padding: 8px 12px;
  background: #1a1d24;
  border-radius: 10px 10px 0 0;
  font-weight: 600;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

#sf-overlay-panel-body {
  padding: 12px;
}

.sf-overlay-evalbar {
  height: 8px;
  width: 100%;
  background: #2a2d36;
  border-radius: 4px;
  overflow: hidden;
  margin-bottom: 10px;
  position: relative;
}
.sf-overlay-evalbar-fill {
  position: absolute;
  top: 0; bottom: 0; left: 50%;
  background: #4caf50;
  transition: width 0.2s, left 0.2s;
}
.sf-overlay-bestmove {
  font-size: 22px;
  font-weight: 700;
  margin: 4px 0 8px;
}
.sf-overlay-meta {
  font-size: 11px;
  opacity: 0.7;
  margin-bottom: 8px;
}
.sf-overlay-pvline {
  font-size: 12px;
  padding: 3px 6px;
  border-radius: 4px;
  margin-bottom: 2px;
  cursor: pointer;
  font-family: ui-monospace, 'SF Mono', Menlo, monospace;
}
.sf-overlay-pvline:hover {
  background: #2a2d36;
}
.sf-overlay-footer {
  font-size: 10px;
  opacity: 0.5;
  margin-top: 8px;
  text-align: right;
}
```

- [ ] **Step 2: Implement `content/overlay/arrow.js`**

```javascript
// SVG arrow drawn over the board element. Re-syncs on resize and scroll.

const SVG_NS = 'http://www.w3.org/2000/svg';
const ARROW_ID = 'sf-overlay-arrow-svg';

function squareToXY(square, orientation) {
  // square = "e4"
  const file = square.charCodeAt(0) - 'a'.charCodeAt(0); // 0..7
  const rank = parseInt(square[1], 10) - 1;              // 0..7
  // White at bottom: file 0 = left, rank 0 = bottom
  let col = file;
  let row = 7 - rank;
  if (orientation === 'black') {
    col = 7 - file;
    row = rank;
  }
  return { col, row };
}

export function createArrowLayer() {
  let svg = null;
  let line = null;
  let head = null;
  let boardEl = null;
  let resizeObserver = null;
  let scrollHandler = null;
  let currentMove = null;
  let currentOrientation = 'white';

  function ensureSvg() {
    if (svg) return;
    svg = document.createElementNS(SVG_NS, 'svg');
    svg.id = ARROW_ID;
    line = document.createElementNS(SVG_NS, 'line');
    line.setAttribute('stroke', 'rgba(80, 200, 120, 0.78)');
    line.setAttribute('stroke-linecap', 'round');
    head = document.createElementNS(SVG_NS, 'polygon');
    head.setAttribute('fill', 'rgba(80, 200, 120, 0.85)');
    svg.appendChild(line);
    svg.appendChild(head);
    document.body.appendChild(svg);
  }

  function position() {
    if (!boardEl || !currentMove || !svg) return;
    const r = boardEl.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return;
    svg.style.left = `${r.left + window.scrollX}px`;
    svg.style.top = `${r.top + window.scrollY}px`;
    svg.setAttribute('width', r.width);
    svg.setAttribute('height', r.height);
    svg.setAttribute('viewBox', `0 0 ${r.width} ${r.height}`);

    const sq = r.width / 8;
    const from = squareToXY(currentMove.from, currentOrientation);
    const to = squareToXY(currentMove.to, currentOrientation);
    const x1 = from.col * sq + sq / 2;
    const y1 = from.row * sq + sq / 2;
    const x2 = to.col * sq + sq / 2;
    const y2 = to.row * sq + sq / 2;

    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.hypot(dx, dy);
    const ux = dx / len;
    const uy = dy / len;
    const headLen = sq * 0.45;
    const headWid = sq * 0.32;
    // Shorten the line so the head sits flush
    const tx = x2 - ux * headLen * 0.6;
    const ty = y2 - uy * headLen * 0.6;

    line.setAttribute('x1', x1);
    line.setAttribute('y1', y1);
    line.setAttribute('x2', tx);
    line.setAttribute('y2', ty);
    line.setAttribute('stroke-width', sq * 0.18);

    // Arrowhead polygon: triangle pointing toward (x2, y2)
    const px = -uy;
    const py = ux;
    const baseX = x2 - ux * headLen;
    const baseY = y2 - uy * headLen;
    const lX = baseX + px * headWid;
    const lY = baseY + py * headWid;
    const rX = baseX - px * headWid;
    const rY = baseY - py * headWid;
    head.setAttribute('points', `${x2},${y2} ${lX},${lY} ${rX},${rY}`);
  }

  function attachObservers() {
    if (resizeObserver) resizeObserver.disconnect();
    if (scrollHandler) window.removeEventListener('scroll', scrollHandler, true);
    if (!boardEl) return;
    resizeObserver = new ResizeObserver(position);
    resizeObserver.observe(boardEl);
    scrollHandler = () => position();
    window.addEventListener('scroll', scrollHandler, { passive: true, capture: true });
    window.addEventListener('resize', scrollHandler);
  }

  function setBoard(el) {
    boardEl = el;
    attachObservers();
    position();
  }

  function setMove({ from, to }, orientation) {
    currentMove = { from, to };
    currentOrientation = orientation;
    ensureSvg();
    position();
  }

  function clear() {
    currentMove = null;
    if (svg) svg.remove();
    svg = null;
    line = null;
    head = null;
  }

  function destroy() {
    clear();
    if (resizeObserver) resizeObserver.disconnect();
    if (scrollHandler) {
      window.removeEventListener('scroll', scrollHandler, true);
      window.removeEventListener('resize', scrollHandler);
    }
  }

  return { setBoard, setMove, clear, destroy };
}
```

- [ ] **Step 3: Commit**

```bash
git add content/overlay/arrow.js content/overlay/overlay.css
git commit -m "feat(overlay): SVG arrow layer + scoped CSS"
```

---

## Task 11: Overlay panel

**Files:**
- Create: `content/overlay/panel.js`

- [ ] **Step 1: Implement `content/overlay/panel.js`**

```javascript
// Floating draggable side panel. Renders eval, depth, best move, and PV lines.

const PANEL_ID = 'sf-overlay-panel';

export function createPanel({ initialPosition, onPositionChange }) {
  let panel = null;
  let header = null;
  let body = null;
  let dragOffset = null;

  function ensurePanel() {
    if (panel) return;
    panel = document.createElement('div');
    panel.id = PANEL_ID;
    panel.style.left = `${initialPosition?.x ?? 24}px`;
    panel.style.top = `${initialPosition?.y ?? 24}px`;

    header = document.createElement('div');
    header.id = 'sf-overlay-panel-header';
    header.textContent = 'Stockfish';
    panel.appendChild(header);

    body = document.createElement('div');
    body.id = 'sf-overlay-panel-body';
    body.innerHTML = `
      <div class="sf-overlay-evalbar"><div class="sf-overlay-evalbar-fill"></div></div>
      <div class="sf-overlay-bestmove">—</div>
      <div class="sf-overlay-meta">depth — · — kn/s</div>
      <div class="sf-overlay-pvlist"></div>
      <div class="sf-overlay-footer"></div>
    `;
    panel.appendChild(body);
    document.body.appendChild(panel);

    header.addEventListener('mousedown', startDrag);
  }

  function startDrag(e) {
    const r = panel.getBoundingClientRect();
    dragOffset = { x: e.clientX - r.left, y: e.clientY - r.top };
    window.addEventListener('mousemove', onDrag);
    window.addEventListener('mouseup', endDrag);
    e.preventDefault();
  }
  function onDrag(e) {
    if (!dragOffset) return;
    const x = Math.max(0, e.clientX - dragOffset.x);
    const y = Math.max(0, e.clientY - dragOffset.y);
    panel.style.left = `${x}px`;
    panel.style.top = `${y}px`;
  }
  function endDrag() {
    if (!dragOffset) return;
    dragOffset = null;
    window.removeEventListener('mousemove', onDrag);
    window.removeEventListener('mouseup', endDrag);
    const r = panel.getBoundingClientRect();
    if (onPositionChange) onPositionChange({ x: Math.round(r.left), y: Math.round(r.top) });
  }

  function update({ scoreCp, scoreMate, depth, nodes, nps, bestMoveSan, pvSans, footer }) {
    ensurePanel();

    // Eval bar
    const fill = panel.querySelector('.sf-overlay-evalbar-fill');
    let displayCp;
    if (scoreMate != null) displayCp = scoreMate > 0 ? 1500 : -1500;
    else displayCp = scoreCp ?? 0;
    const clamped = Math.max(-500, Math.min(500, displayCp));
    const pct = (clamped + 500) / 1000;  // 0..1
    if (clamped >= 0) {
      fill.style.left = '50%';
      fill.style.width = `${(pct - 0.5) * 100}%`;
      fill.style.background = '#4caf50';
    } else {
      fill.style.left = `${pct * 100}%`;
      fill.style.width = `${(0.5 - pct) * 100}%`;
      fill.style.background = '#e57373';
    }

    // Best move
    const bm = panel.querySelector('.sf-overlay-bestmove');
    if (scoreMate != null) {
      bm.textContent = `${bestMoveSan || '—'}  (M${Math.abs(scoreMate)})`;
    } else if (scoreCp != null) {
      const pawns = (scoreCp / 100).toFixed(2);
      const sign = scoreCp >= 0 ? '+' : '';
      bm.textContent = `${bestMoveSan || '—'}  (${sign}${pawns})`;
    } else {
      bm.textContent = bestMoveSan || '—';
    }

    // Meta
    const meta = panel.querySelector('.sf-overlay-meta');
    const knps = nps != null ? `${Math.round(nps / 1000)} kn/s` : '— kn/s';
    meta.textContent = `depth ${depth ?? '—'} · ${knps}`;

    // PV list
    const pvList = panel.querySelector('.sf-overlay-pvlist');
    pvList.innerHTML = '';
    (pvSans || []).slice(0, 3).forEach(line => {
      const div = document.createElement('div');
      div.className = 'sf-overlay-pvline';
      div.textContent = line;
      div.addEventListener('click', () => navigator.clipboard?.writeText(line).catch(() => {}));
      pvList.appendChild(div);
    });

    // Footer
    const f = panel.querySelector('.sf-overlay-footer');
    f.textContent = footer || '';
  }

  function show() { ensurePanel(); panel.style.display = ''; }
  function hide() { if (panel) panel.style.display = 'none'; }
  function destroy() {
    if (panel) { panel.remove(); panel = null; }
  }

  return { update, show, hide, destroy };
}
```

- [ ] **Step 2: Commit**

```bash
git add content/overlay/panel.js
git commit -m "feat(overlay): draggable side panel with eval bar and PV lines"
```

---

## Task 12: Content script entry — wire it all together

**Files:**
- Create: `content/content.js`

- [ ] **Step 1: Implement `content/content.js`**

```javascript
// Content script entry point. Loaded into chess.com and lichess pages.
// Detects which site we're on, instantiates the right adapter, wires the
// watcher to the engine bridge, and renders the overlay.

import { loadSettings, subscribe } from './settings.js';
import { createWatcher } from './board-watcher.js';
import { createEngineBridge } from '../engine/engine-bridge.js';
import { createArrowLayer } from './overlay/arrow.js';
import { createPanel } from './overlay/panel.js';
import { uciToSan } from './fen-replay.js';
import { installHotkey } from './hotkeys.js';

async function main() {
  const host = location.host;
  let adapterModule;
  if (host.endsWith('chess.com')) {
    adapterModule = await import(browser.runtime.getURL('content/adapters/chesscom.js'));
  } else if (host.endsWith('lichess.org')) {
    adapterModule = await import(browser.runtime.getURL('content/adapters/lichess.js'));
  } else {
    return;
  }

  let settings = await loadSettings();
  if (!settings.enabled) return;
  if (host.endsWith('chess.com') && !settings.sites.chesscom) return;
  if (host.endsWith('lichess.org') && !settings.sites.lichess) return;

  // Spin up the engine worker
  const worker = new Worker(browser.runtime.getURL('engine/stockfish.js'));
  const bridge = createEngineBridge(worker);
  await bridge.ready();
  await bridge.setOptions({
    elo: settings.engine.elo,
    limitStrength: settings.engine.limitStrength,
    threads: 1,
    hash: 16
  });

  // Create overlay layers
  const arrow = createArrowLayer();
  const panel = createPanel({
    initialPosition: settings.panelPosition,
    onPositionChange: pos => {
      browser.storage.sync.get('chessAssistantSettings').then(r => {
        const s = r.chessAssistantSettings || {};
        s.panelPosition = pos;
        browser.storage.sync.set({ chessAssistantSettings: s });
      });
    }
  });
  if (!settings.display.panel) panel.hide();

  const adapter = adapterModule.createAdapter(document);

  let lastFen = null;
  let lastSideToMove = 'white';

  async function analyzePosition(fen, sideToMove, orientation) {
    const board = adapter.getBoardElement();
    if (board) arrow.setBoard(board);

    const collected = { lastInfo: null };
    try {
      await bridge.analyze(
        fen,
        { mode: settings.engine.mode, value: settings.engine.mode === 'depth'
            ? settings.engine.depth
            : settings.engine.timeMs },
        info => {
          collected.lastInfo = info;
          if (!info.pv || info.pv.length === 0) return;
          const uci = info.pv[0];
          const from = uci.slice(0, 2);
          const to = uci.slice(2, 4);
          if (settings.display.arrow) arrow.setMove({ from, to }, orientation);
          if (settings.display.panel) {
            const bestMoveSan = uciToSan(fen, uci);
            const pvSans = info.pv.slice(0, 6).map(u => {
              try { return uciToSan(fen, u); } catch { return u; }
            });
            panel.update({
              scoreCp: info.scoreCp,
              scoreMate: info.scoreMate,
              depth: info.depth,
              nps: null,
              bestMoveSan,
              pvSans: [pvSans.join(' ')],
              footer: `engine: ${settings.engine.limitStrength ? `ELO ${settings.engine.elo}` : 'unlimited'} · ${settings.engine.mode === 'depth' ? `d${settings.engine.depth}` : `${settings.engine.timeMs}ms`}`
            });
          }
        }
      );
    } catch (e) {
      // Search was superseded by a newer position. Ignore.
    }
  }

  function shouldAnalyze(sideToMove, orientation) {
    if (settings.trigger === 'auto') return true;
    if (settings.trigger === 'myTurn') return sideToMove === orientation;
    return false; // hotkey-only
  }

  const watcher = createWatcher(adapter, ({ fen, sideToMove, orientation }) => {
    lastFen = fen;
    lastSideToMove = sideToMove;
    bridge.stop();
    arrow.clear();
    if (shouldAnalyze(sideToMove, orientation)) {
      analyzePosition(fen, sideToMove, orientation);
    }
  });

  // Hotkey: re-analyze on demand
  installHotkey(() => settings.hotkey, () => {
    if (lastFen) analyzePosition(lastFen, lastSideToMove, adapter.getOrientation());
  });

  // Live settings updates
  subscribe(async (next) => {
    settings = next;
    await bridge.setOptions({
      elo: settings.engine.elo,
      limitStrength: settings.engine.limitStrength
    });
    if (!settings.display.panel) panel.hide(); else panel.show();
    if (!settings.display.arrow) arrow.clear();
  });
}

main().catch(e => console.error('[chess-assistant]', e));
```

- [ ] **Step 2: Commit**

```bash
git add content/content.js
git commit -m "feat(content): wire adapter + watcher + engine + overlay"
```

---

## Task 13: Manifest + background script

**Files:**
- Create: `manifest.json`
- Create: `background.js`

- [ ] **Step 1: Create `background.js`**

```javascript
// Minimal background script. The engine and watcher live in the tab — this
// only handles the install event so users get a friendly first-run nudge.

self.addEventListener('install', () => {});

if (typeof browser !== 'undefined' && browser.runtime?.onInstalled) {
  browser.runtime.onInstalled.addListener(details => {
    if (details.reason === 'install') {
      browser.tabs.create({ url: browser.runtime.getURL('popup/popup.html') });
    }
  });
} else if (typeof chrome !== 'undefined' && chrome.runtime?.onInstalled) {
  chrome.runtime.onInstalled.addListener(details => {
    if (details.reason === 'install') {
      chrome.tabs.create({ url: chrome.runtime.getURL('popup/popup.html') });
    }
  });
}
```

- [ ] **Step 2: Create `manifest.json`**

```json
{
  "manifest_version": 3,
  "name": "Chess Assistant",
  "version": "0.1.0",
  "description": "Local Stockfish overlay for chess.com and lichess. No automove.",
  "icons": {
    "16": "icons/16.png",
    "32": "icons/32.png",
    "48": "icons/48.png",
    "128": "icons/128.png"
  },
  "action": {
    "default_popup": "popup/popup.html",
    "default_icon": {
      "16": "icons/16.png",
      "32": "icons/32.png",
      "48": "icons/48.png"
    }
  },
  "background": {
    "service_worker": "background.js",
    "scripts": ["background.js"]
  },
  "permissions": ["storage", "activeTab"],
  "host_permissions": [
    "https://*.chess.com/*",
    "https://lichess.org/*"
  ],
  "content_scripts": [
    {
      "matches": [
        "https://*.chess.com/*",
        "https://lichess.org/*"
      ],
      "js": [
        "vendor/browser-polyfill.min.js",
        "vendor/chess.min.js",
        "content/content.js"
      ],
      "css": [
        "content/overlay/overlay.css"
      ],
      "run_at": "document_idle"
    }
  ],
  "web_accessible_resources": [
    {
      "resources": [
        "engine/stockfish.js",
        "engine/stockfish.wasm",
        "content/adapters/chesscom.js",
        "content/adapters/lichess.js",
        "content/board-watcher.js",
        "content/fen-replay.js",
        "content/settings.js",
        "content/hotkeys.js",
        "content/overlay/arrow.js",
        "content/overlay/panel.js",
        "engine/engine-bridge.js"
      ],
      "matches": [
        "https://*.chess.com/*",
        "https://lichess.org/*"
      ]
    }
  ],
  "browser_specific_settings": {
    "gecko": {
      "id": "chess-assistant@imattas.local",
      "strict_min_version": "115.0"
    }
  },
  "content_security_policy": {
    "extension_pages": "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'"
  }
}
```

Note: `content_scripts` only loads three files directly (polyfill, chess.js, content.js). Everything else is loaded via dynamic `import(browser.runtime.getURL(...))` from inside `content.js`, which is why it's listed in `web_accessible_resources`. Content scripts in MV3 cannot themselves be ES modules, but they can call dynamic `import()` of web-accessible files — that's our escape hatch.

- [ ] **Step 3: Commit**

```bash
git add manifest.json background.js
git commit -m "feat: MV3 manifest + minimal background script"
```

---

## Task 14: Placeholder icons

**Files:**
- Create: `icons/16.png` `icons/32.png` `icons/48.png` `icons/128.png`

- [ ] **Step 1: Generate placeholder icons**

Run:
```bash
mkdir -p icons
for size in 16 32 48 128; do
  python3 -c "
import struct, zlib
size = $size
# Solid green PNG
def png(width, height, rgb):
    raw = b''
    for y in range(height):
        raw += b'\\x00' + bytes(rgb) * width
    def chunk(t, d):
        return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t+d) & 0xffffffff)
    sig = b'\\x89PNG\\r\\n\\x1a\\n'
    ihdr = struct.pack('>IIBBBBB', width, height, 8, 2, 0, 0, 0)
    idat = zlib.compress(raw)
    return sig + chunk(b'IHDR', ihdr) + chunk(b'IDAT', idat) + chunk(b'IEND', b'')
open('icons/${size}.png', 'wb').write(png(size, size, (76, 175, 80)))
"
done
ls -la icons/
```
Expected: four PNG files exist.

- [ ] **Step 2: Commit**

```bash
git add icons/
git commit -m "chore: placeholder icons"
```

---

## Task 15: Popup UI — design pass with frontend-design skill

**Files:**
- Create: `popup/popup.html`
- Create: `popup/popup.css`
- Create: `popup/popup.js`

- [ ] **Step 1: Invoke the `superpowers:frontend-design` skill**

Brief the skill with this scope: a single popup (max ~360px wide) for an MV3 extension that surfaces Stockfish settings. Required controls:
- Master on/off toggle.
- Per-site toggles (chess.com, lichess).
- ELO slider 1320–3190 + "Unlimited" checkbox.
- Strength mode (Time / Depth) radio + value slider that swaps unit (ms vs ply).
- Trigger (Auto / My turn / Hotkey only) radio.
- Hotkey rebind field (click → "press a key").
- Display toggles (arrow, panel, eval bar, PV lines).
- Reset to defaults button.

Constraints: dark theme matching the overlay panel (`#14161c` background, `#e8e8e8` text, accent `#4caf50`), no external fonts, no images. All settings live-bind via `browser.storage.sync` (the popup writes; content scripts subscribe).

Take the design output and proceed with the next steps to implement it.

- [ ] **Step 2: Implement `popup/popup.html`**

```html
<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <link rel="stylesheet" href="popup.css">
</head>
<body>
  <div class="popup">
    <header class="popup-header">
      <h1>Chess Assistant</h1>
      <label class="switch">
        <input type="checkbox" id="enabled">
        <span class="slider"></span>
      </label>
    </header>

    <section class="group">
      <h2>Sites</h2>
      <label class="row"><input type="checkbox" id="site-chesscom"> chess.com</label>
      <label class="row"><input type="checkbox" id="site-lichess"> lichess.org</label>
    </section>

    <section class="group">
      <h2>Engine strength</h2>
      <label class="row">
        <span>ELO <span id="elo-value">2400</span></span>
        <input type="range" id="elo" min="1320" max="3190" step="10">
      </label>
      <label class="row"><input type="checkbox" id="unlimited"> Unlimited (full strength)</label>
      <div class="row segmented">
        <label><input type="radio" name="mode" value="time"> Time</label>
        <label><input type="radio" name="mode" value="depth"> Depth</label>
      </div>
      <label class="row" id="time-row">
        <span>Time per move <span id="time-value">1000</span> ms</span>
        <input type="range" id="time" min="100" max="10000" step="100">
      </label>
      <label class="row" id="depth-row">
        <span>Depth <span id="depth-value">18</span></span>
        <input type="range" id="depth" min="5" max="25" step="1">
      </label>
    </section>

    <section class="group">
      <h2>Trigger</h2>
      <div class="row segmented">
        <label><input type="radio" name="trigger" value="auto"> Auto</label>
        <label><input type="radio" name="trigger" value="myTurn"> My turn</label>
        <label><input type="radio" name="trigger" value="hotkey"> Hotkey only</label>
      </div>
      <label class="row">
        <span>Hotkey</span>
        <button id="hotkey-btn" type="button">Alt+A</button>
      </label>
    </section>

    <section class="group">
      <h2>Display</h2>
      <label class="row"><input type="checkbox" id="show-arrow"> Show arrow</label>
      <label class="row"><input type="checkbox" id="show-panel"> Show panel</label>
      <label class="row"><input type="checkbox" id="show-evalbar"> Show eval bar</label>
      <label class="row"><input type="checkbox" id="show-pvlines"> Show PV lines</label>
    </section>

    <footer class="popup-footer">
      <button id="reset" type="button">Reset to defaults</button>
    </footer>
  </div>

  <script src="../vendor/browser-polyfill.min.js"></script>
  <script type="module" src="popup.js"></script>
</body>
</html>
```

- [ ] **Step 3: Implement `popup/popup.css`**

```css
:root {
  --bg: #14161c;
  --bg2: #1a1d24;
  --border: #2a2d36;
  --text: #e8e8e8;
  --muted: #888c95;
  --accent: #4caf50;
  --accent-dim: #366c39;
}

* { box-sizing: border-box; }

html, body {
  margin: 0;
  padding: 0;
  background: var(--bg);
  color: var(--text);
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  font-size: 13px;
  width: 320px;
}

.popup { padding: 12px; }

.popup-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}
.popup-header h1 {
  font-size: 15px;
  margin: 0;
  font-weight: 700;
  letter-spacing: 0.2px;
}

.group {
  background: var(--bg2);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 10px 12px;
  margin-bottom: 10px;
}
.group h2 {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.6px;
  color: var(--muted);
  margin: 0 0 8px;
  font-weight: 600;
}

.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 5px 0;
  cursor: pointer;
}
.row span { flex: 1; }
.row input[type="range"] {
  flex: 0 0 140px;
  accent-color: var(--accent);
}
.row input[type="checkbox"] {
  accent-color: var(--accent);
}

.segmented {
  background: var(--bg);
  border-radius: 6px;
  padding: 2px;
  display: flex;
  gap: 2px;
}
.segmented label {
  flex: 1;
  text-align: center;
  padding: 5px 0;
  border-radius: 4px;
  cursor: pointer;
}
.segmented input[type="radio"] {
  display: none;
}
.segmented label:has(input:checked) {
  background: var(--accent-dim);
  color: white;
}

#hotkey-btn, #reset {
  background: var(--bg);
  border: 1px solid var(--border);
  color: var(--text);
  border-radius: 6px;
  padding: 6px 12px;
  font-size: 12px;
  cursor: pointer;
  font-family: inherit;
}
#hotkey-btn:hover, #reset:hover { border-color: var(--accent); }
#hotkey-btn.capturing { background: var(--accent-dim); border-color: var(--accent); }

.switch {
  position: relative;
  display: inline-block;
  width: 36px;
  height: 20px;
}
.switch input { display: none; }
.switch .slider {
  position: absolute;
  inset: 0;
  background: var(--border);
  border-radius: 20px;
  transition: background 0.15s;
}
.switch .slider::before {
  content: '';
  position: absolute;
  left: 2px;
  top: 2px;
  width: 16px;
  height: 16px;
  background: white;
  border-radius: 50%;
  transition: transform 0.15s;
}
.switch input:checked + .slider {
  background: var(--accent);
}
.switch input:checked + .slider::before {
  transform: translateX(16px);
}

.popup-footer { text-align: center; }
```

- [ ] **Step 4: Implement `popup/popup.js`**

```javascript
import { loadSettings, saveSettings, DEFAULT_SETTINGS } from '../content/settings.js';
import { captureCombo } from '../content/hotkeys.js';

const $ = (id) => document.getElementById(id);

function bindCheckbox(id, getter, setter) {
  const el = $(id);
  el.checked = getter();
  el.addEventListener('change', () => setter(el.checked));
}

function bindRange(id, valueId, getter, setter, formatter = (v) => v) {
  const el = $(id);
  const valEl = $(valueId);
  el.value = String(getter());
  if (valEl) valEl.textContent = String(formatter(el.value));
  el.addEventListener('input', () => {
    if (valEl) valEl.textContent = String(formatter(el.value));
    setter(parseInt(el.value, 10));
  });
}

function bindRadio(name, getter, setter) {
  const radios = document.querySelectorAll(`input[name="${name}"]`);
  for (const r of radios) {
    r.checked = r.value === getter();
    r.addEventListener('change', () => { if (r.checked) setter(r.value); });
  }
}

async function render() {
  const s = await loadSettings();

  bindCheckbox('enabled', () => s.enabled, async v => { await saveSettings({ enabled: v }); });
  bindCheckbox('site-chesscom', () => s.sites.chesscom, async v =>
    saveSettings({ sites: { ...s.sites, chesscom: v } }));
  bindCheckbox('site-lichess', () => s.sites.lichess, async v =>
    saveSettings({ sites: { ...s.sites, lichess: v } }));

  bindRange('elo', 'elo-value', () => s.engine.elo, async v =>
    saveSettings({ engine: { ...s.engine, elo: v } }));

  bindCheckbox('unlimited', () => !s.engine.limitStrength, async v =>
    saveSettings({ engine: { ...s.engine, limitStrength: !v } }));

  bindRadio('mode', () => s.engine.mode, async v =>
    saveSettings({ engine: { ...s.engine, mode: v } }));

  bindRange('time', 'time-value', () => s.engine.timeMs, async v =>
    saveSettings({ engine: { ...s.engine, timeMs: v } }));

  bindRange('depth', 'depth-value', () => s.engine.depth, async v =>
    saveSettings({ engine: { ...s.engine, depth: v } }));

  bindRadio('trigger', () => s.trigger, async v => saveSettings({ trigger: v }));

  const hotkeyBtn = $('hotkey-btn');
  hotkeyBtn.textContent = s.hotkey;
  hotkeyBtn.addEventListener('click', () => {
    hotkeyBtn.textContent = 'Press a key…';
    hotkeyBtn.classList.add('capturing');
    captureCombo(combo => {
      hotkeyBtn.textContent = combo;
      hotkeyBtn.classList.remove('capturing');
      saveSettings({ hotkey: combo });
    });
  });

  bindCheckbox('show-arrow', () => s.display.arrow, async v =>
    saveSettings({ display: { ...s.display, arrow: v } }));
  bindCheckbox('show-panel', () => s.display.panel, async v =>
    saveSettings({ display: { ...s.display, panel: v } }));
  bindCheckbox('show-evalbar', () => s.display.evalBar, async v =>
    saveSettings({ display: { ...s.display, evalBar: v } }));
  bindCheckbox('show-pvlines', () => s.display.pvLines, async v =>
    saveSettings({ display: { ...s.display, pvLines: v } }));

  $('reset').addEventListener('click', async () => {
    await browser.storage.sync.set({ chessAssistantSettings: DEFAULT_SETTINGS });
    window.location.reload();
  });
}

render().catch(e => console.error('[popup]', e));
```

- [ ] **Step 5: Smoke-test in browser**

Run:
```bash
ls popup/
```
Expected: `popup.html`, `popup.css`, `popup.js`.

(Visual smoke test happens in Task 17 when we load the unpacked extension.)

- [ ] **Step 6: Commit**

```bash
git add popup/
git commit -m "feat(popup): settings UI with live-binding to storage.sync"
```

---

## Task 16: Build script

**Files:**
- Create: `scripts/build.sh`

- [ ] **Step 1: Implement `scripts/build.sh`**

```bash
#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIST="$ROOT/dist"
rm -rf "$DIST"
mkdir -p "$DIST"

STAGE_CHROME="$DIST/stage-chrome"
STAGE_FIREFOX="$DIST/stage-firefox"

copy_sources() {
  local target="$1"
  mkdir -p "$target"
  cp -r manifest.json background.js popup content engine vendor icons "$target/"
}

copy_sources "$STAGE_CHROME"
copy_sources "$STAGE_FIREFOX"

# Chrome doesn't accept browser_specific_settings — strip it.
node -e "
const fs = require('fs');
const path = '$STAGE_CHROME/manifest.json';
const m = JSON.parse(fs.readFileSync(path, 'utf8'));
delete m.browser_specific_settings;
delete m.background.scripts;  // Chrome MV3 uses service_worker only
fs.writeFileSync(path, JSON.stringify(m, null, 2));
"

# Firefox MV3 uses background.scripts (no service worker).
node -e "
const fs = require('fs');
const path = '$STAGE_FIREFOX/manifest.json';
const m = JSON.parse(fs.readFileSync(path, 'utf8'));
delete m.background.service_worker;
fs.writeFileSync(path, JSON.stringify(m, null, 2));
"

(cd "$STAGE_CHROME" && zip -r -q "../chrome.zip" .)
(cd "$STAGE_FIREFOX" && zip -r -q "../firefox.zip" .)

rm -rf "$STAGE_CHROME" "$STAGE_FIREFOX"

echo "Built:"
ls -lh "$DIST"/*.zip
```

- [ ] **Step 2: Run the build**

Run:
```bash
chmod +x scripts/build.sh
npm run build
```
Expected: `dist/chrome.zip` and `dist/firefox.zip` exist.

- [ ] **Step 3: Commit**

```bash
git add scripts/build.sh
git commit -m "build: cross-browser zip packager"
```

---

## Task 17: README + manual smoke test

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Replace `README.md` with the full version**

```markdown
# Chess Assistant

Cross-browser (Chrome + Firefox) MV3 extension that overlays Stockfish suggestions on chess.com and lichess. **No automove** — the user always plays the moves themselves.

## Features

- Local single-thread Stockfish WASM (no network calls).
- SVG arrow drawn on the board for the best move.
- Floating side panel with eval bar, depth, and top PV lines.
- ELO slider (UCI_LimitStrength) for hint strength.
- Configurable trigger (auto / on-my-turn / hotkey).
- Rebindable hotkey (default `Alt+A`).
- Per-site toggles (chess.com, lichess.org).

## Build

```
npm install
npm run build
```

Outputs `dist/chrome.zip` and `dist/firefox.zip`.

## Load unpacked (Chrome)

1. Open `chrome://extensions`.
2. Enable Developer Mode.
3. Click "Load unpacked" and select the project root.

## Load unpacked (Firefox)

1. Open `about:debugging#/runtime/this-firefox`.
2. Click "Load Temporary Add-on".
3. Select `manifest.json`.

## Tests

```
npm test
```

Runs unit tests (FEN replay, settings, engine bridge, both adapters).

## Manual smoke checklist

After loading unpacked in each browser:

1. Open the extension popup. Verify all controls render and are responsive.
2. Open `https://www.chess.com/play/computer`, start a game.
   - Within ~1s of each move, an arrow should appear and the panel should update.
   - Try toggling ELO and time-per-move in the popup; confirm overlay reflects new settings.
3. Open `https://www.chess.com/puzzles/rated`. Confirm overlay works on puzzles.
4. Open `https://lichess.org/training`. Confirm overlay works on puzzles.
5. Open `https://lichess.org/analysis`. Make a few moves; confirm overlay updates.
6. Toggle `Show arrow` off — arrow should disappear, panel should remain.
7. Set Trigger to `Hotkey only`. Press `Alt+A` — analysis should run for the current position.
8. Rebind hotkey to `Ctrl+Shift+S`. Verify it now triggers instead.

## Architecture

See `docs/superpowers/specs/2026-04-08-chess-assistant-extension-design.md`.
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: full README with build, install, and smoke-test instructions"
```

---

## Task 18: Final verification

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: all tests pass across `fen-replay`, `settings`, `engine-bridge`, `chesscom`, `lichess`.

- [ ] **Step 2: Run the build**

Run: `npm run build`
Expected: `dist/chrome.zip` and `dist/firefox.zip` exist.

- [ ] **Step 3: Sanity-check the manifest in each zip**

Run:
```bash
unzip -p dist/chrome.zip manifest.json | head -30
unzip -p dist/firefox.zip manifest.json | head -30
```
Expected: chrome.zip manifest has no `browser_specific_settings` field; firefox.zip manifest does.

- [ ] **Step 4: Mark plan complete**

The plan is fully implemented when all tests pass and both zips are produced. Manual smoke testing in real browsers is the user's job — point them to the smoke checklist in `README.md`.

---

## Self-review (filled in by plan author)

**Spec coverage:**
- Single-thread Stockfish WASM, bundled, offline → Task 2 (vendor) + Task 8 (bridge) + Task 12 (wire-up).
- chess.com adapter → Task 5.
- lichess adapter → Task 6.
- SAN → FEN replay via chess.js → Task 3.
- Board watcher with debounce + dedup → Task 7.
- UCI bridge with `setOptions`, `analyze`, `stop` → Task 8.
- SVG arrow overlay → Task 10.
- Floating draggable side panel → Task 11.
- Popup UI (with frontend-design pass) → Task 15.
- Settings module with all options from spec → Task 4 + Task 15.
- Hotkey rebinding → Task 9 + Task 15.
- Manifest cross-browser → Task 13.
- Build script → Task 16.
- Tests for FEN replay, settings, adapters, engine bridge → Tasks 3, 4, 5, 6, 8.
- README + smoke checklist → Task 17.

**Placeholders:** None — every code step shows the full code to write.

**Type consistency:** Verified function names match across tasks: `createAdapter`, `createWatcher`, `createEngineBridge`, `createArrowLayer`, `createPanel`, `loadSettings`, `saveSettings`, `subscribe`, `installHotkey`, `captureCombo`, `sansToFen`, `uciToSan`. Settings shape is identical in `DEFAULT_SETTINGS`, popup binding, and content wire-up.
