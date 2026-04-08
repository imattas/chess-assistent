// lichess.org adapter. DOM scraping isolated here.
//
// lichess maintains stable short element names (l4x, u8t, kwdb) inside
// chessground. The primary FEN-reading strategy is the SAN move list; piece
// scrape is a fallback when no move list is available (rare in practice but
// covers fresh-tab edge cases).

const PIECE_NAMES = {
  pawn: 'p', knight: 'n', bishop: 'b', rook: 'r', queen: 'q', king: 'k'
};

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

  function getFenAttribute() {
    // Some lichess containers expose data-fen for the current position.
    const candidates = [
      rootDoc.querySelector('.cg-wrap'),
      rootDoc.querySelector('.main-board'),
      rootDoc.querySelector('cg-container')
    ];
    for (const el of candidates) {
      if (!el) continue;
      const fen = el.getAttribute('data-fen');
      if (fen && fen.includes('/') && fen.split(' ').length >= 4) return fen;
    }
    return null;
  }

  function getMoveList() {
    // Live games:    <l4x><u8t san="...">SAN</u8t>...</l4x>
    // Analysis:      .analyse__moves [san]
    // Puzzles:       .puzzle__moves [san]
    const selectorGroups = [
      'l4x u8t[san]',
      '.analyse__moves u8t[san]',
      '.puzzle__moves u8t[san]',
      'l4x [san]',
      '.analyse__moves [san]',
      '.puzzle__moves [san]',
      '.tview2 [san]'
    ];
    let nodes = [];
    for (const sel of selectorGroups) {
      const found = rootDoc.querySelectorAll(sel);
      if (found.length > nodes.length) nodes = Array.from(found);
    }
    return nodes
      .map(n => n.getAttribute('san') || (n.textContent || '').trim())
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

  let pieceSampleLogged = false;

  function readPieceGrid() {
    const board = getBoardElement();
    if (!board) return null;
    // chessground uses <piece> elements; some forks/variants use <cg-piece>
    // or div.piece. Try all of them.
    let pieces = board.querySelectorAll('piece');
    if (pieces.length === 0) pieces = board.querySelectorAll('cg-piece');
    if (pieces.length === 0) pieces = board.querySelectorAll('.piece');
    if (pieces.length === 0) return null;

    const boardRect = board.getBoundingClientRect();
    if (boardRect.width <= 0) return null;
    const sq = boardRect.width / 8;
    const orientation = getOrientation();

    // First-call diagnostic: log how many pieces were found and a sample
    // outerHTML so we can debug DOM regressions from a single console paste.
    if (!pieceSampleLogged) {
      pieceSampleLogged = true;
      try {
        const sample = pieces[0]?.outerHTML?.slice(0, 200);
        console.log(
          '[chess-assistant:lichess] readPieceGrid first call:',
          `${pieces.length} pieces found, sample:`,
          sample
        );
      } catch {}
    }

    const grid = Array.from({ length: 8 }, () => Array(8).fill(null));
    let placed = 0;
    let skippedNoColor = 0;
    let skippedNoPiece = 0;
    let skippedOutOfBounds = 0;

    for (const p of pieces) {
      // Use classList to handle both HTMLElement and SVGElement.
      const classes = Array.from(p.classList || []).map(c => c.toLowerCase());
      const classStr = classes.join(' ');

      let color = null;
      if (classStr.includes('white')) color = 'w';
      else if (classStr.includes('black')) color = 'b';
      if (!color) { skippedNoColor++; continue; }

      let pieceLetter = null;
      for (const name of Object.keys(PIECE_NAMES)) {
        if (classStr.includes(name)) { pieceLetter = PIECE_NAMES[name]; break; }
      }
      if (!pieceLetter) { skippedNoPiece++; continue; }
      const letter = color === 'w' ? pieceLetter.toUpperCase() : pieceLetter;

      // Use the actual rendered bounding rect rather than parsing inline
      // transforms. Works regardless of whether chessground uses translate,
      // translate3d, top/left, or any other positioning method.
      const r = p.getBoundingClientRect();
      if (r.width <= 0) { skippedOutOfBounds++; continue; }
      const cx = r.left + r.width / 2 - boardRect.left;
      const cy = r.top + r.height / 2 - boardRect.top;
      let file = Math.floor(cx / sq);
      let row = Math.floor(cy / sq);
      if (file < 0 || file > 7 || row < 0 || row > 7) {
        skippedOutOfBounds++;
        continue;
      }
      if (orientation === 'black') {
        file = 7 - file;
        row = 7 - row;
      }
      grid[row][file] = letter;
      placed++;
    }

    if (placed === 0) return null;

    // Validation: a legal chess position must contain both kings. Without
    // this check we hand kingless FENs to chess.js (which throws) and to
    // Stockfish (which crashes the wasm with index-out-of-bounds, ruining
    // the engine for the rest of the session).
    const flat = grid.flat();
    if (!flat.includes('K') || !flat.includes('k')) {
      console.warn(
        '[chess-assistant:lichess] piece grid missing king(s)',
        `(placed=${placed}, skippedNoColor=${skippedNoColor},`,
        `skippedNoPiece=${skippedNoPiece}, skippedOutOfBounds=${skippedOutOfBounds})`,
        '— rejecting and falling back to next strategy'
      );
      return null;
    }
    return grid;
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
      attributeFilter: ['class', 'san', 'data-fen', 'style']
    });
    return () => { mo.disconnect(); clearTimeout(timer); };
  }

  return {
    getBoardElement,
    getOrientation,
    getMoveList,
    getStartingFen,
    getFenAttribute,
    readPieceGrid,
    observe
  };
}
