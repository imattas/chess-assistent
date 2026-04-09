// chess.com adapter, CommonJS port of the extension adapter.

const PIECE_LETTER = {
  wp: 'P', wn: 'N', wb: 'B', wr: 'R', wq: 'Q', wk: 'K',
  bp: 'p', bn: 'n', bb: 'b', br: 'r', bq: 'q', bk: 'k'
};

function createAdapter(rootDoc) {
  rootDoc = rootDoc || document;

  function getBoardElement() {
    return (
      rootDoc.querySelector('chess-board') ||
      rootDoc.querySelector('wc-chess-board') ||
      rootDoc.querySelector('.board-component-container chess-board') ||
      null
    );
  }

  function getOrientation() {
    const board = getBoardElement();
    if (!board) return 'white';
    if (board.classList.contains('flipped')) return 'black';
    if (board.getAttribute('data-flipped') === 'true') return 'black';
    return 'white';
  }

  function getFenAttribute() {
    const board = getBoardElement();
    if (!board) return null;
    const candidates = [
      board.getAttribute('fen'),
      board.getAttribute('position'),
      board.getAttribute('data-fen')
    ];
    for (const c of candidates) {
      if (c && c.includes('/') && c.length >= 17 && c.split(' ').length >= 4) return c;
    }
    return null;
  }

  function getMoveList() {
    const selectorGroups = [
      'wc-simple-move-list .node-highlight-content',
      'wc-simple-move-list .node',
      '.move-list-wrapper .node-highlight-content',
      '.move-list-wrapper .node',
      'wc-move-list .node',
      '.vertical-move-list .move .node'
    ];
    let nodes = [];
    for (const sel of selectorGroups) {
      const found = rootDoc.querySelectorAll(sel);
      if (found.length > nodes.length) nodes = Array.from(found);
    }
    if (nodes.length === 0) return [];
    const allHavePly = nodes.every(n => n.dataset && n.dataset.ply);
    if (allHavePly) {
      nodes.sort((a, b) => parseInt(a.dataset.ply, 10) - parseInt(b.dataset.ply, 10));
    }
    return nodes
      .map(n => (n.textContent || '').trim())
      .filter(s => s && /^[a-hKQRBN0O][^\s]*$/.test(s));
  }

  function getStartingFen() {
    const board = getBoardElement();
    if (!board) return null;
    const attr = board.getAttribute('fen') || board.getAttribute('position');
    if (!attr) return null;
    if (attr.startsWith('rnbqkbnr/pppppppp')) return null;
    return attr;
  }

  function readPieceGrid() {
    const board = getBoardElement();
    if (!board) return null;
    let pieces = board.querySelectorAll('.piece');
    if (pieces.length === 0) {
      pieces = rootDoc.querySelectorAll('chess-board .piece, wc-chess-board .piece');
    }
    if (pieces.length === 0) return null;

    const grid = Array.from({ length: 8 }, () => Array(8).fill(null));
    let placed = 0;
    for (const p of pieces) {
      const cls = (p.className || '').toLowerCase();
      const colorMatch = cls.match(/\b([wb])([prnbqk])\b/);
      const sqMatch = cls.match(/\bsquare-(\d)(\d)\b/);
      if (!colorMatch || !sqMatch) continue;
      const code = colorMatch[1] + colorMatch[2];
      const letter = PIECE_LETTER[code];
      if (!letter) continue;
      const file = parseInt(sqMatch[1], 10) - 1;
      const rank = parseInt(sqMatch[2], 10) - 1;
      if (file < 0 || file > 7 || rank < 0 || rank > 7) continue;
      grid[7 - rank][file] = letter;
      placed++;
    }
    if (placed === 0) return null;
    const flat = grid.flat();
    if (!flat.includes('K') || !flat.includes('k')) {
      console.warn('[chesscom] piece grid missing king(s) — rejecting');
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
      attributeFilter: ['class', 'fen', 'position', 'data-fen', 'data-ply', 'style']
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
