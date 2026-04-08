// UCI bridge over a Worker. The Worker is injected so this module is
// trivially testable with a FakeWorker.
//
// Race-safe analyze flow: only one search is active at a time. If the caller
// requests a new analyze() while one is in flight, we send `stop` and queue
// the new search. The previous search's `bestmove` line still arrives (UCI
// guarantees one bestmove per `go`); when it arrives we resolve the active
// promise and immediately start the queued search. Info lines for the
// previous search are silently dropped via a per-search id check.

export function createEngineBridge(worker) {
  let readyResolve;
  const readyPromise = new Promise(r => { readyResolve = r; });

  let nextSearchId = 1;
  let activeSearch = null;   // { id, fen, opts, onInfo, resolve, reject }
  let pendingSearch = null;  // { id, fen, opts, onInfo, resolve, reject }

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

  function startSearch(search) {
    send(`position fen ${search.fen}`);
    if (search.opts.mode === 'depth') {
      send(`go depth ${search.opts.value}`);
    } else {
      send(`go movetime ${search.opts.value}`);
    }
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
        if (activeSearch) {
          activeSearch.onInfo(parseInfoLine(trimmed));
        }
      } else if (trimmed.startsWith('bestmove ')) {
        const parts = trimmed.split(' ');
        const result = { bestmove: parts[1], ponder: parts[3] };
        const finished = activeSearch;
        activeSearch = null;
        if (finished) finished.resolve(result);
        if (pendingSearch) {
          activeSearch = pendingSearch;
          pendingSearch = null;
          startSearch(activeSearch);
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
    return new Promise((resolve, reject) => {
      const search = {
        id: nextSearchId++,
        fen,
        opts: { mode, value },
        onInfo: onInfo || (() => {}),
        resolve,
        reject
      };
      if (activeSearch) {
        // Bump any earlier pending — the latest call wins.
        if (pendingSearch) pendingSearch.reject(new Error('superseded'));
        pendingSearch = search;
        send('stop');
      } else {
        activeSearch = search;
        startSearch(search);
      }
    });
  }

  function stop() {
    // Drop any pending and ask the engine to stop. Always sending `stop` is
    // harmless to Stockfish when nothing is searching.
    if (pendingSearch) {
      pendingSearch.reject(new Error('stopped'));
      pendingSearch = null;
    }
    send('stop');
  }

  function destroy() {
    if (pendingSearch) { pendingSearch.reject(new Error('destroyed')); pendingSearch = null; }
    if (activeSearch) { activeSearch.reject(new Error('destroyed')); activeSearch = null; }
    try { worker.terminate(); } catch {}
  }

  return { ready, setOptions, analyze, stop, destroy };
}
