// SVG arrow overlay, CommonJS port of content/overlay/arrow.js.
// Draws two arrows (primary green, opponent red) on the embedded site's
// chess board. Used by preload-webview.js to render analysis results.

const SVG_NS = 'http://www.w3.org/2000/svg';
const ARROW_ID = 'sf-local-arrow-svg';

const PRIMARY_STROKE = 'rgba(80, 200, 120, 0.78)';
const PRIMARY_FILL   = 'rgba(80, 200, 120, 0.88)';
const OPPONENT_STROKE = 'rgba(229, 90, 90, 0.62)';
const OPPONENT_FILL   = 'rgba(229, 90, 90, 0.78)';

function squareToXY(square, orientation) {
  const file = square.charCodeAt(0) - 'a'.charCodeAt(0);
  const rank = parseInt(square[1], 10) - 1;
  let col = file;
  let row = 7 - rank;
  if (orientation === 'black') {
    col = 7 - file;
    row = rank;
  }
  return { col, row };
}

function createArrowLayer() {
  let svg = null;
  let primaryLine = null, primaryHead = null;
  let opponentLine = null, opponentHead = null;
  let boardEl = null;
  let resizeObserver = null;
  let scrollHandler = null;
  let currentMoves = null;
  let currentOrientation = 'white';

  function makeArrow(stroke, fill) {
    const line = document.createElementNS(SVG_NS, 'line');
    line.setAttribute('stroke', stroke);
    line.setAttribute('stroke-linecap', 'round');
    const head = document.createElementNS(SVG_NS, 'polygon');
    head.setAttribute('fill', fill);
    return { line, head };
  }

  function ensureSvg() {
    if (svg) return;
    svg = document.createElementNS(SVG_NS, 'svg');
    svg.id = ARROW_ID;
    svg.style.position = 'absolute';
    svg.style.top = '0';
    svg.style.left = '0';
    svg.style.pointerEvents = 'none';
    svg.style.zIndex = '99998';
    svg.style.overflow = 'visible';

    const opp = makeArrow(OPPONENT_STROKE, OPPONENT_FILL);
    opponentLine = opp.line;
    opponentHead = opp.head;
    const prim = makeArrow(PRIMARY_STROKE, PRIMARY_FILL);
    primaryLine = prim.line;
    primaryHead = prim.head;

    svg.appendChild(opponentLine);
    svg.appendChild(opponentHead);
    svg.appendChild(primaryLine);
    svg.appendChild(primaryHead);
    document.body.appendChild(svg);
  }

  function hideArrow(line, head) {
    line.setAttribute('x1', 0);
    line.setAttribute('y1', 0);
    line.setAttribute('x2', 0);
    line.setAttribute('y2', 0);
    line.setAttribute('stroke-width', 0);
    head.setAttribute('points', '0,0 0,0 0,0');
  }

  function drawArrow(line, head, move, sq, widthScale) {
    if (!move || !move.from || !move.to) {
      hideArrow(line, head);
      return;
    }
    const from = squareToXY(move.from, currentOrientation);
    const to = squareToXY(move.to, currentOrientation);
    const x1 = from.col * sq + sq / 2;
    const y1 = from.row * sq + sq / 2;
    const x2 = to.col * sq + sq / 2;
    const y2 = to.row * sq + sq / 2;
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.hypot(dx, dy);
    if (len === 0) { hideArrow(line, head); return; }
    const ux = dx / len;
    const uy = dy / len;
    const headLen = sq * 0.45 * widthScale;
    const headWid = sq * 0.32 * widthScale;
    const tx = x2 - ux * headLen * 0.6;
    const ty = y2 - uy * headLen * 0.6;

    line.setAttribute('x1', x1);
    line.setAttribute('y1', y1);
    line.setAttribute('x2', tx);
    line.setAttribute('y2', ty);
    line.setAttribute('stroke-width', sq * 0.18 * widthScale);

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

  function position() {
    if (!boardEl || !currentMoves || !svg) return;
    const r = boardEl.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return;
    svg.style.left = `${r.left + window.scrollX}px`;
    svg.style.top = `${r.top + window.scrollY}px`;
    svg.setAttribute('width', r.width);
    svg.setAttribute('height', r.height);
    svg.setAttribute('viewBox', `0 0 ${r.width} ${r.height}`);
    const sq = r.width / 8;
    drawArrow(primaryLine, primaryHead, currentMoves.primary, sq, 1.0);
    drawArrow(opponentLine, opponentHead, currentMoves.opponent, sq, 0.85);
  }

  function attachObservers() {
    if (resizeObserver) resizeObserver.disconnect();
    if (scrollHandler) {
      window.removeEventListener('scroll', scrollHandler, true);
      window.removeEventListener('resize', scrollHandler);
    }
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

  function setMoves({ primary, opponent }, orientation) {
    currentMoves = { primary: primary || null, opponent: opponent || null };
    currentOrientation = orientation;
    ensureSvg();
    position();
  }

  function clear() {
    currentMoves = null;
    if (svg) svg.remove();
    svg = null;
    primaryLine = null;
    primaryHead = null;
    opponentLine = null;
    opponentHead = null;
  }

  function destroy() {
    clear();
    if (resizeObserver) resizeObserver.disconnect();
    if (scrollHandler) {
      window.removeEventListener('scroll', scrollHandler, true);
      window.removeEventListener('resize', scrollHandler);
    }
  }

  return { setBoard, setMoves, clear, destroy };
}

module.exports = { createArrowLayer };
