// SVG arrow drawn over the board element. Re-syncs on resize and scroll.

const SVG_NS = 'http://www.w3.org/2000/svg';
const ARROW_ID = 'sf-overlay-arrow-svg';

function squareToXY(square, orientation) {
  // square = "e4"
  const file = square.charCodeAt(0) - 'a'.charCodeAt(0); // 0..7
  const rank = parseInt(square[1], 10) - 1;              // 0..7
  // White at bottom: file 0 = left, rank 0 = bottom
  let col = file;
  let row = 7 - rank;
  if (orientation === 'black') {
    col = 7 - file;
    row = rank;
  }
  return { col, row };
}

export function createArrowLayer() {
  let svg = null;
  let line = null;
  let head = null;
  let boardEl = null;
  let resizeObserver = null;
  let scrollHandler = null;
  let currentMove = null;
  let currentOrientation = 'white';

  function ensureSvg() {
    if (svg) return;
    svg = document.createElementNS(SVG_NS, 'svg');
    svg.id = ARROW_ID;
    line = document.createElementNS(SVG_NS, 'line');
    line.setAttribute('stroke', 'rgba(80, 200, 120, 0.78)');
    line.setAttribute('stroke-linecap', 'round');
    head = document.createElementNS(SVG_NS, 'polygon');
    head.setAttribute('fill', 'rgba(80, 200, 120, 0.85)');
    svg.appendChild(line);
    svg.appendChild(head);
    document.body.appendChild(svg);
  }

  function position() {
    if (!boardEl || !currentMove || !svg) return;
    const r = boardEl.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return;
    svg.style.left = `${r.left + window.scrollX}px`;
    svg.style.top = `${r.top + window.scrollY}px`;
    svg.setAttribute('width', r.width);
    svg.setAttribute('height', r.height);
    svg.setAttribute('viewBox', `0 0 ${r.width} ${r.height}`);

    const sq = r.width / 8;
    const from = squareToXY(currentMove.from, currentOrientation);
    const to = squareToXY(currentMove.to, currentOrientation);
    const x1 = from.col * sq + sq / 2;
    const y1 = from.row * sq + sq / 2;
    const x2 = to.col * sq + sq / 2;
    const y2 = to.row * sq + sq / 2;

    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.hypot(dx, dy);
    const ux = dx / len;
    const uy = dy / len;
    const headLen = sq * 0.45;
    const headWid = sq * 0.32;
    // Shorten the line so the head sits flush
    const tx = x2 - ux * headLen * 0.6;
    const ty = y2 - uy * headLen * 0.6;

    line.setAttribute('x1', x1);
    line.setAttribute('y1', y1);
    line.setAttribute('x2', tx);
    line.setAttribute('y2', ty);
    line.setAttribute('stroke-width', sq * 0.18);

    // Arrowhead polygon: triangle pointing toward (x2, y2)
    const px = -uy;
    const py = ux;
    const baseX = x2 - ux * headLen;
    const baseY = y2 - uy * headLen;
    const lX = baseX + px * headWid;
    const lY = baseY + py * headWid;
    const rX = baseX - px * headWid;
    const rY = baseY - py * headWid;
    head.setAttribute('points', `${x2},${y2} ${lX},${lY} ${rX},${rY}`);
  }

  function attachObservers() {
    if (resizeObserver) resizeObserver.disconnect();
    if (scrollHandler) window.removeEventListener('scroll', scrollHandler, true);
    if (!boardEl) return;
    resizeObserver = new ResizeObserver(position);
    resizeObserver.observe(boardEl);
    scrollHandler = () => position();
    window.addEventListener('scroll', scrollHandler, { passive: true, capture: true });
    window.addEventListener('resize', scrollHandler);
  }

  function setBoard(el) {
    boardEl = el;
    attachObservers();
    position();
  }

  function setMove({ from, to }, orientation) {
    currentMove = { from, to };
    currentOrientation = orientation;
    ensureSvg();
    position();
  }

  function clear() {
    currentMove = null;
    if (svg) svg.remove();
    svg = null;
    line = null;
    head = null;
  }

  function destroy() {
    clear();
    if (resizeObserver) resizeObserver.disconnect();
    if (scrollHandler) {
      window.removeEventListener('scroll', scrollHandler, true);
      window.removeEventListener('resize', scrollHandler);
    }
  }

  return { setBoard, setMove, clear, destroy };
}
