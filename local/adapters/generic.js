// Generic chess-board adapter for chess24, chesstempo, and anything else.
// CommonJS port of the extension's generic adapter.

const BOARD_SELECTORS = [
  'cg-board', 'cg-container',
  'chess-board', 'wc-chess-board',
  'cm-chessboard', '.cm-chessboard', '.cm-chessboard-board',
  'cb-board', '.cb-board', 'chessboard-element',
  '#board', '.board', '#chessboard', '.chessboard',
  '[id*="chessboard" i]', '[class*="chessboard" i]',
  '[id*="ChessBoard"]', '[class*="ChessBoard"]',
  '#tempoBoard', '.tempo_board', '#problemBoard',
  'svg.board', 'svg[class*="board" i]'
];

const PIECE_SELECTORS = [
  'piece', 'cg-piece',
  '.piece', '.cg-piece', '.chess-piece', '.chess_piece',
  '[class*="piece" i]',
  '[data-piece]',
  'img.piece', 'img[src*="piece" i]'
];

const PIECE_TYPE_KEYWORDS = [
  ['king', 'k'], ['queen', 'q'], ['rook', 'r'],
  ['bishop', 'b'], ['knight', 'n'], ['pawn', 'p']
];

function classListOf(el) {
  if (el.classList && el.classList.length !== undefined) {
    return Array.from(el.classList).map(c => c.toLowerCase());
  }
  const cn = el.className;
  if (typeof cn === 'string') return cn.toLowerCase().split(/\s+/).filter(Boolean);
  if (cn && typeof cn.baseVal === 'string') return cn.baseVal.toLowerCase().split(/\s+/).filter(Boolean);
  return [];
}

function identifyPiece(el) {
  const classes = classListOf(el);
  const classStr = classes.join(' ');

  let color = null;
  if (classStr.includes('white') || classes.includes('w')) color = 'w';
  else if (classStr.includes('black') || classes.includes('b')) color = 'b';

  let type = null;
  for (const [name, letter] of PIECE_TYPE_KEYWORDS) {
    if (classStr.includes(name)) { type = letter; break; }
  }

  if (!type || !color) {
    const dp = el.getAttribute && el.getAttribute('data-piece');
    if (dp) {
      const lower = dp.toLowerCase();
      if (!color) {
        if (lower.startsWith('w') || lower.includes('white')) color = 'w';
        else if (lower.startsWith('b') || lower.includes('black')) color = 'b';
      }
      if (!type) {
        for (const [name, letter] of PIECE_TYPE_KEYWORDS) {
          if (lower.includes(name) || lower.includes(letter)) { type = letter; break; }
        }
      }
    }
  }

  if (!type || !color) {
    const img = el.tagName === 'IMG' ? el : (el.querySelector && el.querySelector('img'));
    if (img) {
      const src = (img.getAttribute && img.getAttribute('src')) || '';
      const filename = src.toLowerCase().split('/').pop() || '';
      if (!color) {
        if (filename.startsWith('w') || filename.includes('white')) color = 'w';
        else if (filename.startsWith('b') || filename.includes('black')) color = 'b';
      }
      if (!type) {
        for (const [name, letter] of PIECE_TYPE_KEYWORDS) {
          if (filename.includes(name)) { type = letter; break; }
        }
        if (!type) {
          const m = filename.match(/^[wb]([prnbqk])\b/i);
          if (m) type = m[1].toLowerCase();
        }
      }
    }
  }

  if (!type || !color) {
    const useEl = el.tagName === 'USE' ? el : (el.querySelector && el.querySelector('use'));
    if (useEl) {
      const href = (useEl.getAttribute && (useEl.getAttribute('href') || useEl.getAttribute('xlink:href'))) || '';
      const sym = href.replace(/^#/, '').toLowerCase();
      if (sym) {
        if (!color) {
          if (sym.startsWith('w')) color = 'w';
          else if (sym.startsWith('b')) color = 'b';
        }
        if (!type) {
          const m = sym.match(/^[wb]([prnbqk])$/);
          if (m) type = m[1];
        }
      }
    }
  }

  if (!color || !type) return null;
  return color === 'w' ? type.toUpperCase() : type;
}

function createAdapter(rootDoc) {
  rootDoc = rootDoc || document;
  let pieceSampleLogged = false;

  function getBoardElement() {
    for (const sel of BOARD_SELECTORS) {
      try {
        const el = rootDoc.querySelector(sel);
        if (el) {
          const r = el.getBoundingClientRect();
          if (r.width >= 100 && r.height >= 100) return el;
        }
      } catch { /* skip */ }
    }
    return null;
  }

  function getOrientation() {
    const board = getBoardElement();
    if (!board) return 'white';
    let p = board;
    while (p) {
      const classes = classListOf(p);
      if (classes.some(c => c.includes('flipped') || c.includes('orientation-black'))) return 'black';
      p = p.parentElement;
    }
    return 'white';
  }

  function getFenAttribute() {
    const board = getBoardElement();
    if (!board) return null;
    let p = board;
    let depth = 0;
    while (p && depth < 5) {
      const fen = p.getAttribute && (p.getAttribute('data-fen') || p.getAttribute('fen') || p.getAttribute('position'));
      if (fen && fen.includes('/') && fen.split(' ').length >= 4) return fen;
      p = p.parentElement;
      depth++;
    }
    return null;
  }

  function getMoveList() {
    const candidates = rootDoc.querySelectorAll(
      '[class*="movelist" i] [data-san], [class*="movelist" i] .move, .notation .move, .pgn .move'
    );
    return Array.from(candidates)
      .map(n => (n.getAttribute('data-san') || n.textContent || '').trim())
      .filter(Boolean);
  }

  function getStartingFen() { return null; }

  function readPieceGrid() {
    const board = getBoardElement();
    if (!board) return null;

    let pieces = [];
    for (const sel of PIECE_SELECTORS) {
      try {
        const found = board.querySelectorAll(sel);
        if (found.length > pieces.length) pieces = Array.from(found);
      } catch {}
    }
    if (pieces.length === 0) return null;

    const boardRect = board.getBoundingClientRect();
    if (boardRect.width <= 0) return null;
    const sq = boardRect.width / 8;
    const orientation = getOrientation();

    if (!pieceSampleLogged) {
      pieceSampleLogged = true;
      try {
        const sample = pieces[0] && pieces[0].outerHTML && pieces[0].outerHTML.slice(0, 200);
        console.log('[generic] readPieceGrid first call:', pieces.length, 'pieces, board=', board.tagName.toLowerCase(), 'sample:', sample);
      } catch {}
    }

    const grid = Array.from({ length: 8 }, () => Array(8).fill(null));
    let placed = 0;
    for (const p of pieces) {
      const letter = identifyPiece(p);
      if (!letter) continue;
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
      console.warn('[generic] piece grid missing king(s) — rejecting');
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
      attributeFilter: ['class', 'style', 'transform', 'data-fen', 'data-piece', 'href', 'src']
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
