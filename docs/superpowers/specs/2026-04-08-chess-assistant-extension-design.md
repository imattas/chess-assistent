# Chess Assistant Browser Extension — Design

**Date:** 2026-04-08
**Status:** Approved
**Owner:** imattas

## Goal

Build a single cross-browser (Chrome + Firefox) MV3 web extension that runs Stockfish locally and overlays move suggestions on chess.com and lichess.org boards. The user always plays the moves themselves — the extension never auto-clicks pieces. It is an analysis aid, not a bot driver.

## Non-goals

- No auto-move / no clicking pieces on the user's behalf.
- No remote engine or remote analysis API. Everything is bundled and offline.
- No anti-detection or evasion techniques. This is a personal analysis tool.
- No mobile-browser support, no Safari, no other chess sites in v1.

## Supported sites (v1)

- chess.com — live games (rapid / blitz / bullet), puzzles, analysis board.
- lichess.org — live games, puzzles, studies, analysis board.

## Architecture

A single MV3 extension. One manifest, with `browser_specific_settings.gecko` for Firefox (Chrome silently ignores the field). Per active tab on a supported site, the extension instantiates:

1. **Content script** — entry point that detects which site it's on and loads the matching board adapter. Also injects the overlay layer and reads/writes settings via `browser.storage.sync`.
2. **Board adapter** — site-specific module (`chesscom.js` or `lichess.js`) that knows how to find the board element, find the move list, detect orientation, and emit position-change events.
3. **Board watcher** — generic `MutationObserver`-based loop that listens to the adapter's events, recomputes the FEN by replaying the move list through `chess.js`, debounces ~50 ms, and pushes the FEN to the engine bridge.
4. **Engine worker** — a `Web Worker` spawned with `chrome.runtime.getURL('engine/stockfish.js')`, running the **single-threaded** Stockfish WASM build (no `SharedArrayBuffer` required, identical behavior on Chrome and Firefox). One worker per tab; cheap because we only ever have one chess game open at a time in practice.
5. **Engine bridge** — a thin wrapper around the worker that exposes a typed API (`setOptions`, `analyze`, `stop`) and handles UCI text on the wire.
6. **Overlay layer** — an absolutely-positioned SVG arrow drawn over the board element + a draggable floating side panel with eval, depth, and top-3 PV lines. Both injected directly into the host page DOM.
7. **Popup UI** — settings page that writes to `browser.storage.sync`. Content scripts hot-reload settings via `storage.onChanged`.
8. **Background script** — minimal, only handles install / icon-click events. No long-running work; the engine lives in the tab.

No remote network calls. No `eval`. No remote code loading. CSP-compatible with MV3 defaults.

## How we read the board

The robust strategy is **replay the move list through chess.js** rather than scraping piece positions, because move-list scraping survives DOM reskins much better than piece-class parsing.

### chess.com
- Move list selector: `wc-simple-move-list` and `.move-list-wrapper` (observed on live and analysis boards).
- Extract SAN strings in DOM order, feed into a fresh `chess.js` instance, read `.fen()`.
- Empty move list → standard starting FEN.
- Orientation: `chess-board[flipped]` class (white-at-bottom by default).
- Fallback (custom positions / Chess960 / puzzle setups): scan piece elements (`piece` class), read square-coordinate classes (e.g. `square-12`), reconstruct an 8×8 board, infer side-to-move from move count parity if not otherwise available.

### lichess.org
- Move list selectors: `l4x` (live game), `.analyse__moves` (analysis), `.puzzle__moves` (puzzles).
- Same SAN-replay approach.
- Orientation: `cg-wrap.orientation-black` class on the board container.
- Studies that ship a custom starting FEN: read it from the PGN headers in the page DOM.
- Fallback: walk piece divs in `cg-board`, parse the inline `transform: translate(x, y)` to derive square coordinates, build an 8×8 board.

### Output
The watcher emits `{fen, sideToMove, orientation}` on every change, debounced 50 ms, deduplicated against the previous value.

## Engine + UCI bridge

- Ships `engine/stockfish.js` + `engine/stockfish.wasm` (lichess single-thread build, ~1 MB total).
- Loaded via `new Worker(chrome.runtime.getURL('engine/stockfish.js'))` from inside the content script.
- `engine-bridge.js` exposes:
  - `setOptions({ elo, limitStrength, hash, threads })` — issues `setoption name UCI_LimitStrength value <bool>` and `setoption name UCI_Elo value <n>`. When `limitStrength` is false, ELO is ignored and the engine plays at full strength.
  - `analyze(fen, { mode: 'time' | 'depth', value })` — sends `position fen <fen>` then `go movetime <ms>` or `go depth <n>`. Returns an event emitter producing `info` updates `{ depth, scoreCp, scoreMate, pv: string[] /* UCI */ }` and a final `bestmove` event.
  - `stop()` — sends `stop`; used when the position changes mid-search so we don't waste cycles on stale positions.
- The bridge converts UCI moves (`g1f3`) to SAN (`Nf3`) using a `chess.js` instance seeded with the analyzed FEN, so the side panel can show human-readable notation.

## Overlay rendering

### Arrow layer
- An `<svg>` injected as a sibling of the board element, sized and positioned to match the board's bounding rect, with `pointer-events: none` so clicks pass through to the real board.
- The arrow is a thick translucent line + arrowhead polygon from the suggested move's source square to its destination square.
- Square coordinates are computed from `boardRect.width / 8`, with both axes inverted when the board is flipped.
- A `ResizeObserver` on the board element re-syncs the SVG on resize; a passive `scroll` listener re-syncs on page scroll.

### Side panel
- A `<div id="sf-overlay-panel">` injected into `document.body`, fixed-positioned, draggable by its header. Position is persisted in `browser.storage.sync`.
- Contents:
  - Horizontal eval bar (color-shifted by sign, capped at ±5 pawns; mate scores show `M5`, `-M3`, etc.)
  - Best move in SAN, large font.
  - Small line: `depth · nodes · nps`.
  - Top 3 PV lines, each as a clickable SAN sequence. Clicking copies that line to the clipboard. Clicking does **not** interact with the actual board.
  - Footer: `engine: ELO 2400 · 1.0s` reflecting current settings.
- All overlay CSS is scoped under `#sf-overlay-*` selectors. The panel root uses `all: initial` to insulate it from host-page CSS bleed.

## Popup UI / settings

A single popup with these controls. All values persist to `browser.storage.sync`. Content scripts subscribe to `storage.onChanged` and reapply settings live without needing a page reload.

- **Master toggle** (extension on/off).
- **Per-site toggles**: chess.com, lichess.org.
- **ELO slider**: 1320–3190, plus an "Unlimited" checkbox that disables `UCI_LimitStrength` so the engine plays at full strength.
- **Strength mode** (radio): Time-based / Depth-based.
- **Value slider**:
  - When mode = time: 100 ms – 10000 ms.
  - When mode = depth: 5 – 25 ply.
- **Trigger** (radio):
  - Auto-analyze on every move (default).
  - Only when it's my turn.
  - Manual hotkey only.
- **Hotkey rebind**: a "press a key combo" capture field; default `Alt+A`. Stored as a normalized combo string. Matched in the content script via `keydown` (we deliberately avoid the `commands` manifest key because rebinding it at runtime is awkward; a content-script listener works identically in both browsers).
- **Display toggles**: show arrow, show side panel, show eval bar, show PV lines.
- **Reset to defaults** button.

The popup UI itself will be designed and built using the `superpowers:frontend-design` skill during implementation, so the look-and-feel pass is treated as a real design step rather than a bag of unstyled inputs.

## Settings storage shape

```json
{
  "version": 1,
  "enabled": true,
  "sites": { "chesscom": true, "lichess": true },
  "engine": {
    "elo": 2400,
    "limitStrength": true,
    "mode": "time",
    "timeMs": 1000,
    "depth": 18
  },
  "trigger": "auto",        // "auto" | "myTurn" | "hotkey"
  "hotkey": "Alt+A",
  "display": {
    "arrow": true,
    "panel": true,
    "evalBar": true,
    "pvLines": true
  },
  "panelPosition": { "x": 24, "y": 24 }
}
```

## File layout

```
chess-assistant/
  manifest.json                # MV3, with browser_specific_settings.gecko
  background.js                # tiny: install + icon click only
  popup/
    popup.html
    popup.css
    popup.js
  content/
    content.js                 # entry: detects site, loads adapter
    adapters/
      chesscom.js
      lichess.js
    board-watcher.js           # MutationObserver + FEN computation
    overlay/
      arrow.js
      panel.js
      overlay.css
    settings.js                # storage read/write + change events
    hotkeys.js
  engine/
    stockfish.js               # lichess single-thread build
    stockfish.wasm
    engine-bridge.js           # UCI wrapper
  vendor/
    chess.min.js               # chess.js, MIT
    browser-polyfill.min.js    # webextension-polyfill, MPL
  icons/
    16.png 32.png 48.png 128.png
  scripts/
    build.sh                   # produces dist/chrome.zip + dist/firefox.zip
  test/
    fen-replay.test.js         # node test: SAN sequences → FEN
    adapter-fixtures/          # saved HTML snapshots from chess.com/lichess
    adapter.test.js            # jsdom test: fixture HTML → expected FEN
  README.md
```

## Permissions

- `storage` — for settings.
- `activeTab` — to inject overlay only on user-visited tabs.
- Host permissions: `https://*.chess.com/*`, `https://lichess.org/*`.

No `tabs`, no `<all_urls>`, no `webRequest`. Minimal-permission profile so the extension is auditable and reviewable.

## Build

`scripts/build.sh` produces two zips from the same source tree:
- `dist/chrome.zip` — manifest with `browser_specific_settings` stripped.
- `dist/firefox.zip` — manifest with `browser_specific_settings.gecko.id` populated.

No bundler, no transpile step. Plain ES modules. Keeps the project trivially auditable, easy to load unpacked, and easy to diff.

## Testing strategy

- **Unit tests (node)**: SAN-replay logic against known PGNs (a handful of opening-book games + a few endgame puzzles). Pure-function tests, fast.
- **Adapter tests (jsdom)**: capture real HTML snapshots from chess.com and lichess pages into `test/adapter-fixtures/`, then assert that each adapter parses them into the expected FEN. This is our regression net for when those sites change their DOM (which they do, periodically).
- **Manual smoke checklist** in README:
  1. Load unpacked in Chrome → open chess.com → start a game → confirm arrow appears within ~1 s of opponent's move.
  2. Same for Firefox.
  3. Same for lichess (live, puzzle, analysis, study).
  4. Toggle ELO / time / hotkey / display switches in popup → confirm overlay reacts live.

## Risks and mitigations

- **chess.com / lichess DOM changes** — adapters are isolated, fixture-tested, and easy to patch independently. No site-specific code leaks into the engine, watcher, or overlay layers.
- **WASM threading not available** — we deliberately use the single-thread build, which sidesteps `SharedArrayBuffer`/COOP-COEP entirely. Slower than threaded, but works everywhere with no host-page interference.
- **Bundle size** — ~1 MB for stockfish.wasm. Acceptable for an extension; well below extension store limits.
- **CSS bleed from host page** — overlay panel uses `all: initial` and a unique ID prefix.
- **Multiple boards on one page** — adapter picks the first visible board element; documented limitation in README.
- **Pre-moves / promotions** — we never interact with the board, so pre-moves don't affect us. Promotion UCI moves (`e7e8q`) are converted to SAN (`e8=Q`) by chess.js for display.

## Out of scope for v1

- Opening book / explorer integration.
- Tablebase lookups.
- Game review / blunder annotation.
- Sync of settings across devices beyond what `storage.sync` already does.
- Themes other than light / dark auto-detect.
- i18n.
