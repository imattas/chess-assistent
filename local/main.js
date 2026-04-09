// Electron main process. Creates a single window containing:
//   - a top tab bar (site picker)
//   - a <webview> embedding the chosen chess site (cookies persist via a
//     named session partition, so logins survive app restarts)
//   - a right sidebar showing Stockfish analysis
//
// A native Stockfish subprocess is spawned once at startup and shared across
// all webview sessions. IPC shape:
//
//   renderer → main : 'analyze' (fen, options, id)          → invokes engine
//   renderer → main : 'stop-analysis'                       → stops search
//   renderer → main : 'set-engine-options' (opts)           → UCI setoption
//   main → renderer : 'engine-ready'                        → once at startup
//   main → renderer : 'engine-error' (message)              → on failure
//   main → renderer : 'engine-info' (id, info)              → streamed from SF

const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const path = require('path');
const { createEngineHost } = require('./engine-host');

let mainWindow = null;
let engine = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1500,
    height: 950,
    minWidth: 900,
    minHeight: 600,
    title: 'Chess Assistant — Local',
    backgroundColor: '#14161c',
    webPreferences: {
      // Local personal tool — skip the context-isolation dance.
      nodeIntegration: true,
      contextIsolation: false,
      webviewTag: true
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  // Uncomment to debug the renderer DOM:
  // mainWindow.webContents.openDevTools({ mode: 'detach' });
}

app.whenReady().then(async () => {
  createWindow();

  // Spawn Stockfish. Do not block the window opening on this — report
  // the result asynchronously once the renderer has loaded.
  mainWindow.webContents.once('did-finish-load', async () => {
    try {
      engine = createEngineHost();
      await engine.awaitReady();
      console.log('[main] stockfish ready:', engine.binaryPath);
      mainWindow.webContents.send('engine-ready', { binaryPath: engine.binaryPath });
    } catch (e) {
      console.error('[main] stockfish failed to start:', e);
      mainWindow.webContents.send('engine-error', {
        message: e.message,
        hint: 'Install Stockfish: sudo pacman -S stockfish  (or apt/brew install stockfish)'
      });
    }
  });
});

// --- IPC handlers ---

ipcMain.handle('analyze', async (event, { fen, options, id }) => {
  if (!engine) throw new Error('engine not ready');
  await engine.awaitReady();
  return engine.analyze(fen, options, (info) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('engine-info', { id, info });
    }
  });
});

ipcMain.handle('stop-analysis', () => {
  if (engine) engine.stop();
});

ipcMain.handle('set-engine-options', async (event, opts) => {
  if (engine) await engine.setOptions(opts);
});

ipcMain.handle('open-external', (event, url) => {
  shell.openExternal(url);
});

app.on('window-all-closed', () => {
  if (engine) engine.destroy();
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
