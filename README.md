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
