// lichess.org adapter, CommonJS port.

const PIECE_NAMES = {
  pawn: 'p', knight: 'n', bishop: 'b', rook: 'r', queen: 'q', king: 'k'
};

function classListOf(el) {
  if (el.classList && el.classList.length !== undefined) {
    return Array.from(el.classList).map(c => c.toLowerCase());
  }
  const cn = el.className;
  if (typeof cn === 'string') return cn.toLowerCase().split(/\s+/).filter(Boolean);
  if (cn && typeof cn.baseVal === 'string') return cn.baseVal.toLowerCase().split(/\s+/).filter(Boolean);
  return [];
}

function createAdapter(rootDoc) {
  rootDoc = rootDoc || document;
  let pieceSampleLogged = false;

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
    const wrap = rootDoc.querySelector('.cg-wrap, .main-board');
    const fen = wrap && wrap.getAttribute('data-fen');
    if (fen && !fen.startsWith('rnbqkbnr/pppppppp')) return fen;
    return null;
  }

  function readPieceGrid() {
    const board = getBoardElement();
    if (!board) return null;
    let pieces = board.querySelectorAll('piece');
    if (pieces.length === 0) pieces = board.querySelectorAll('cg-piece');
    if (pieces.length === 0) pieces = board.querySelectorAll('.piece');
    if (pieces.length === 0) return null;

    const boardRect = board.getBoundingClientRect();
    if (boardRect.width <= 0) return null;
    const sq = boardRect.width / 8;
    const orientation = getOrientation();

    if (!pieceSampleLogged) {
      pieceSampleLogged = true;
      try {
        const sample = pieces[0] && pieces[0].outerHTML && pieces[0].outerHTML.slice(0, 200);
        console.log('[lichess] readPieceGrid first call:', pieces.length, 'pieces, sample:', sample);
      } catch {}
    }

    const grid = Array.from({ length: 8 }, () => Array(8).fill(null));
    let placed = 0;
    for (const p of pieces) {
      const classes = classListOf(p);
      const classStr = classes.join(' ');

      let color = null;
      if (classStr.includes('white')) color = 'w';
      else if (classStr.includes('black')) color = 'b';
      if (!color) continue;

      let pieceLetter = null;
      for (const name of Object.keys(PIECE_NAMES)) {
        if (classStr.includes(name)) { pieceLetter = PIECE_NAMES[name]; break; }
      }
      if (!pieceLetter) continue;
      const letter = color === 'w' ? pieceLetter.toUpperCase() : pieceLetter;

      const r = p.getBoundingClientRect();
      if (r.width <= 0) continue;
      const cx = r.left + r.width / 2 - boardRect.left;
      const cy = r.top + r.height / 2 - boardRect.top;
      let file = Math.floor(cx / sq);
      let row = Math.floor(cy / sq);
      if (file < 0 || file > 7 || row < 0 || row > 7) continue;
      if (orientation === 'black') {
        file = 7 - file;
        row = 7 - row;
      }
      grid[row][file] = letter;
      placed++;
    }
    if (placed === 0) return null;

    const flat = grid.flat();
    if (!flat.includes('K') || !flat.includes('k')) {
      console.warn('[lichess] piece grid missing king(s) — rejecting');
      return null;
    }
    return grid;
  }

  function observe(callback) {
    let timer = null;
    const fire = () => { clearTimeout(timer); timer = setTimeout(callback, 50); };
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

module.exports = { createAdapter };
