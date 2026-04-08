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
