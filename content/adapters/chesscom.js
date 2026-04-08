// chess.com adapter. DOM scraping is isolated to this file.

export function createAdapter(rootDoc = document) {
  function getBoardElement() {
    return rootDoc.querySelector('chess-board');
  }

  function getOrientation() {
    const board = getBoardElement();
    if (!board) return 'white';
    return board.classList.contains('flipped') ? 'black' : 'white';
  }

  function getMoveList() {
    // Live games and analysis use wc-simple-move-list with .node-highlight-content spans
    // containing SAN. Each span has data-ply ordering.
    const nodes = rootDoc.querySelectorAll(
      'wc-simple-move-list .node-highlight-content, ' +
      '.move-list-wrapper .node-highlight-content'
    );
    if (nodes.length === 0) return [];
    const sorted = Array.from(nodes).sort((a, b) => {
      const pa = parseInt(a.dataset.ply || '0', 10);
      const pb = parseInt(b.dataset.ply || '0', 10);
      return pa - pb;
    });
    return sorted.map(n => n.textContent.trim()).filter(Boolean);
  }

  function getStartingFen() {
    // chess.com puzzle / analysis pages may expose a starting FEN attribute.
    // We check the board element for an `fen` attribute that does not match
    // the standard start.
    const board = getBoardElement();
    if (!board) return null;
    const attr = board.getAttribute('fen');
    if (!attr) return null;
    if (attr.startsWith('rnbqkbnr/pppppppp')) return null;
    return attr;
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
      attributeFilter: ['class', 'fen', 'data-ply']
    });
    return () => { mo.disconnect(); clearTimeout(timer); };
  }

  return { getBoardElement, getOrientation, getMoveList, getStartingFen, observe };
}
