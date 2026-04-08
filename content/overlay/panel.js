// Floating draggable side panel. Renders eval, depth, best move, and PV lines.

const PANEL_ID = 'sf-overlay-panel';

export function createPanel({ initialPosition, onPositionChange }) {
  let panel = null;
  let header = null;
  let body = null;
  let dragOffset = null;

  function ensurePanel() {
    if (panel) return;
    panel = document.createElement('div');
    panel.id = PANEL_ID;
    panel.style.left = `${initialPosition?.x ?? 24}px`;
    panel.style.top = `${initialPosition?.y ?? 24}px`;

    header = document.createElement('div');
    header.id = 'sf-overlay-panel-header';
    header.textContent = 'Stockfish';
    panel.appendChild(header);

    body = document.createElement('div');
    body.id = 'sf-overlay-panel-body';
    body.innerHTML = `
      <div class="sf-overlay-evalbar"><div class="sf-overlay-evalbar-fill"></div></div>
      <div class="sf-overlay-bestmove">—</div>
      <div class="sf-overlay-meta">depth — · — kn/s</div>
      <div class="sf-overlay-pvlist"></div>
      <div class="sf-overlay-footer"></div>
    `;
    panel.appendChild(body);
    document.body.appendChild(panel);

    header.addEventListener('mousedown', startDrag);
  }

  function startDrag(e) {
    const r = panel.getBoundingClientRect();
    dragOffset = { x: e.clientX - r.left, y: e.clientY - r.top };
    window.addEventListener('mousemove', onDrag);
    window.addEventListener('mouseup', endDrag);
    e.preventDefault();
  }
  function onDrag(e) {
    if (!dragOffset) return;
    const x = Math.max(0, e.clientX - dragOffset.x);
    const y = Math.max(0, e.clientY - dragOffset.y);
    panel.style.left = `${x}px`;
    panel.style.top = `${y}px`;
  }
  function endDrag() {
    if (!dragOffset) return;
    dragOffset = null;
    window.removeEventListener('mousemove', onDrag);
    window.removeEventListener('mouseup', endDrag);
    const r = panel.getBoundingClientRect();
    if (onPositionChange) onPositionChange({ x: Math.round(r.left), y: Math.round(r.top) });
  }

  function update({ scoreCp, scoreMate, depth, nodes, nps, bestMoveSan, pvSans, footer }) {
    ensurePanel();

    // Eval bar
    const fill = panel.querySelector('.sf-overlay-evalbar-fill');
    let displayCp;
    if (scoreMate != null) displayCp = scoreMate > 0 ? 1500 : -1500;
    else displayCp = scoreCp ?? 0;
    const clamped = Math.max(-500, Math.min(500, displayCp));
    const pct = (clamped + 500) / 1000;  // 0..1
    if (clamped >= 0) {
      fill.style.left = '50%';
      fill.style.width = `${(pct - 0.5) * 100}%`;
      fill.style.background = '#4caf50';
    } else {
      fill.style.left = `${pct * 100}%`;
      fill.style.width = `${(0.5 - pct) * 100}%`;
      fill.style.background = '#e57373';
    }

    // Best move
    const bm = panel.querySelector('.sf-overlay-bestmove');
    if (scoreMate != null) {
      bm.textContent = `${bestMoveSan || '—'}  (M${Math.abs(scoreMate)})`;
    } else if (scoreCp != null) {
      const pawns = (scoreCp / 100).toFixed(2);
      const sign = scoreCp >= 0 ? '+' : '';
      bm.textContent = `${bestMoveSan || '—'}  (${sign}${pawns})`;
    } else {
      bm.textContent = bestMoveSan || '—';
    }

    // Meta
    const meta = panel.querySelector('.sf-overlay-meta');
    const knps = nps != null ? `${Math.round(nps / 1000)} kn/s` : '— kn/s';
    meta.textContent = `depth ${depth ?? '—'} · ${knps}`;

    // PV list
    const pvList = panel.querySelector('.sf-overlay-pvlist');
    pvList.innerHTML = '';
    (pvSans || []).slice(0, 3).forEach(line => {
      const div = document.createElement('div');
      div.className = 'sf-overlay-pvline';
      div.textContent = line;
      div.addEventListener('click', () => navigator.clipboard?.writeText(line).catch(() => {}));
      pvList.appendChild(div);
    });

    // Footer
    const f = panel.querySelector('.sf-overlay-footer');
    f.textContent = footer || '';
  }

  function show() { ensurePanel(); panel.style.display = ''; }
  function hide() { if (panel) panel.style.display = 'none'; }
  function destroy() {
    if (panel) { panel.remove(); panel = null; }
  }

  return { update, show, hide, destroy };
}
