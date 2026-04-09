# Chess Assistant — Local Desktop App

Standalone desktop app that **embeds chess sites** (Lichess, Chess.com, Chess24, Chesstempo, ...) with a **Stockfish sidebar on the right**. No browser needed, no browser extension. Your logins persist across restarts.

The extension in the parent directory still works — this local app is a different deployment mode, sharing the same adapters and overlay code.

## Why use the local app?

- Real native Stockfish (uses your system's `stockfish` binary — latest version from your package manager).
- Proper threading and configurable `Hash`, `Threads`, `MultiPV`, `SyzygyPath`, etc. (vs the single-threaded WASM the extension is stuck with because of page CSP).
- Self-contained window — you can dedicate a monitor to "chess mode" without a browser around.
- Cookies persist in an isolated Electron session, so you log into Lichess / Chess.com once and stay logged in.
- Same overlay code as the extension: green arrow for the engine's best move, red arrow for the predicted opponent reply, drawn directly over the embedded site's real board.

## Prerequisites

**Stockfish** must be installed on your system. The app uses the `stockfish` command from your PATH (or a few standard locations).

- **Arch / Artix:** `sudo pacman -S stockfish`
- **Debian / Ubuntu:** `sudo apt install stockfish`
- **macOS (Homebrew):** `brew install stockfish`
- **Windows:** download from [stockfishchess.org/download](https://stockfishchess.org/download/) and either put `stockfish.exe` on PATH, set the `STOCKFISH_PATH` environment variable, or drop it at `local/engine/stockfish.exe`.

Verify with `stockfish --version` before starting the app.

**Node + Electron dev deps:**

```bash
cd local
npm install
```

First-time install downloads Electron (~200 MB).

## Running

```bash
npm start
```

This launches the Electron window. You'll see:

- Top bar: brand + site tabs (Lichess / Chess.com / Chess24 / Chesstempo) + engine status.
- Left pane: the embedded chess site in a `<webview>`. Navigate, play, log in — it's a full browser view.
- Right sidebar: engine eval bar, best move, PV, and live settings for ELO / time / depth / threads / hash / MultiPV.

As soon as you reach a position with pieces on the board, the watcher scrapes the FEN (attribute → piece grid → SAN replay, same multi-strategy as the extension), sends it to the native Stockfish subprocess, and streams `info` lines back into the sidebar. The green + red arrows are drawn directly over the site's board via the webview's preload script.

## Logins persist

The `<webview>` uses `partition="persist:chess-assistant"`. Electron persists cookies, localStorage, and IndexedDB for persistent partitions automatically, under:

- Linux: `~/.config/Chess Assistant/Partitions/chess-assistant/`
- macOS: `~/Library/Application Support/Chess Assistant/Partitions/chess-assistant/`
- Windows: `%APPDATA%\Chess Assistant\Partitions\chess-assistant\`

Log into Lichess or Chess.com once; you'll stay logged in on subsequent launches.

## Configurable engine options

All exposed in the sidebar, all wired to UCI `setoption`:

| Sidebar control | UCI option                |
|-----------------|---------------------------|
| ELO slider      | `UCI_Elo` + `UCI_LimitStrength` |
| Unlimited       | `UCI_LimitStrength value false` |
| Time/Depth mode | `go movetime` / `go depth`  |
| Threads         | `Threads`                 |
| Hash            | `Hash`                    |
| MultiPV         | `MultiPV`                 |

Additional options the engine host supports but that don't have UI yet (set from code via `engine.setOptions({ syzygyPath, skillLevel })`):

- `SyzygyPath` — path to tablebase files.
- `Skill Level` — 0–20 classical weakening.

## Environment variables

- `STOCKFISH_PATH` — absolute path to a specific Stockfish binary, overrides PATH lookup.

## Build a distributable

```bash
npm run build:linux    # AppImage
npm run build          # detects host platform (AppImage / dmg / nsis)
```

Produces a self-contained bundle in `dist/`. Note: the Stockfish binary is NOT bundled — the distributable expects the end user to have `stockfish` installed. Bundling Stockfish would require per-OS binaries and significantly larger downloads.

## How it compares to the extension

| Feature | Extension | Local app |
|---|---|---|
| Engine | Bundled WASM (single-thread) | System `stockfish` (native, threaded) |
| Strength | ~2500 ELO effective cap | Full Stockfish, tunable |
| Install | Load unpacked / temp add-on | `npm install` + `npm start` or AppImage |
| Runs in | Any chess tab in your browser | Its own window |
| Logins | Your browser's session | Isolated persistent partition |
| Sidebar UI | Floating panel on the page | Dedicated sidebar next to the board |
| New sites | Add to manifest + reload | Add a new adapter + update `pickAdapter` in preload |

Pick whichever fits the moment. The extension is less work to launch; the local app is stronger and more configurable.

## Adding another chess site

1. Add a tab button in `renderer/index.html` with the site URL.
2. (Optional) Add a site-specific adapter in `adapters/yoursite.js` for better selectors.
3. In `preload-webview.js`'s `pickAdapter()`, add a branch that loads the new adapter when `host.includes('yoursite.com')`. Generic adapter handles the fallback.

## Troubleshooting

- **"Engine error" in the top bar** — Stockfish isn't installed or isn't on PATH. See Prerequisites above.
- **Sidebar never updates** — open DevTools on the webview host (Menu → View → Toggle DevTools), look for `[watcher]` log lines. If you see `position via pieces: ...` but no `engine-info`, check the main window console for Stockfish errors.
- **Login not persisting** — make sure you're reaching the site via a tab button (not a typed URL in some other field). The persistent partition is only applied to the managed `<webview>`.
