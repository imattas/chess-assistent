// lichess.org adapter. DOM scraping isolated here.

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

  function getMoveList() {
    // Live games:    <l4x><u8t san="...">SAN</u8t>...</l4x>
    // Analysis:      .analyse__moves with similar nodes
    // Puzzles:       .puzzle__moves with similar nodes
    const nodes = rootDoc.querySelectorAll(
      'l4x u8t[san], .analyse__moves u8t[san], .puzzle__moves u8t[san]'
    );
    if (nodes.length === 0) {
      // Fallback: look for any [san] element inside a moves container
      const fallback = rootDoc.querySelectorAll(
        'l4x [san], .analyse__moves [san], .puzzle__moves [san]'
      );
      return Array.from(fallback)
        .map(n => n.getAttribute('san'))
        .filter(Boolean);
    }
    return Array.from(nodes)
      .map(n => n.getAttribute('san'))
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
      attributeFilter: ['class', 'san', 'data-fen']
    });
    return () => { mo.disconnect(); clearTimeout(timer); };
  }

  return { getBoardElement, getOrientation, getMoveList, getStartingFen, observe };
}
