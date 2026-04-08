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

  function readPieceGrid() {
    const board = getBoardElement();
    if (!board) return null;
    const pieces = board.querySelectorAll('piece');
    if (pieces.length === 0) return null;
    const rect = board.getBoundingClientRect();
    if (rect.width <= 0) return null;
    const sq = rect.width / 8;

    const grid = Array.from({ length: 8 }, () => Array(8).fill(null));
    let placed = 0;
    for (const p of pieces) {
      const cls = (p.className || '').toLowerCase();
      let color = null;
      if (cls.includes('white')) color = 'w';
      else if (cls.includes('black')) color = 'b';
      if (!color) continue;
      let pieceLetter = null;
      for (const name of Object.keys(PIECE_NAMES)) {
        if (cls.includes(name)) { pieceLetter = PIECE_NAMES[name]; break; }
      }
      if (!pieceLetter) continue;
      const letter = color === 'w' ? pieceLetter.toUpperCase() : pieceLetter;

      // Position via inline transform: translate(Xpx, Ypx)
      const style = p.getAttribute('style') || '';
      const m = style.match(/translate\(\s*(-?[\d.]+)px\s*,\s*(-?[\d.]+)px\s*\)/);
      if (!m) continue;
      const x = parseFloat(m[1]);
      const y = parseFloat(m[2]);
      // Lichess places (0,0) at the orientation-relative top-left corner.
      // For white-at-bottom: file 0 (a) at x=0, rank 8 at y=0.
      let file = Math.round(x / sq);
      let row = Math.round(y / sq); // 0 = top
      if (file < 0 || file > 7 || row < 0 || row > 7) continue;
      const orientation = getOrientation();
      if (orientation === 'black') {
        file = 7 - file;
        row = 7 - row;
      }
      grid[row][file] = letter;
      placed++;
    }
    if (placed === 0) return null;
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
