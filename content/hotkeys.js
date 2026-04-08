// Hotkey listener. Parses combo strings like "Alt+A" or "Ctrl+Shift+P"
// and fires a callback when matched. Designed for use in a content script
// where we deliberately avoid the manifest `commands` key (so users can rebind
// at runtime via the popup).

function normalizeCombo(combo) {
  // "Alt+A" → { alt: true, ctrl: false, shift: false, meta: false, key: 'a' }
  const parts = combo.split('+').map(s => s.trim().toLowerCase());
  const out = { alt: false, ctrl: false, shift: false, meta: false, key: '' };
  for (const p of parts) {
    if (p === 'alt') out.alt = true;
    else if (p === 'ctrl' || p === 'control') out.ctrl = true;
    else if (p === 'shift') out.shift = true;
    else if (p === 'meta' || p === 'cmd' || p === 'command') out.meta = true;
    else out.key = p;
  }
  return out;
}

export function installHotkey(getCombo, onTrigger) {
  function handler(e) {
    const combo = getCombo();
    if (!combo) return;
    const want = normalizeCombo(combo);
    if (e.altKey !== want.alt) return;
    if (e.ctrlKey !== want.ctrl) return;
    if (e.shiftKey !== want.shift) return;
    if (e.metaKey !== want.meta) return;
    if (e.key.toLowerCase() !== want.key) return;
    e.preventDefault();
    onTrigger();
  }
  window.addEventListener('keydown', handler, true);
  return () => window.removeEventListener('keydown', handler, true);
}

export function captureCombo(onCaptured) {
  // Used by the popup UI: returns the next pressed key combo.
  function handler(e) {
    e.preventDefault();
    e.stopPropagation();
    const parts = [];
    if (e.ctrlKey) parts.push('Ctrl');
    if (e.altKey) parts.push('Alt');
    if (e.shiftKey) parts.push('Shift');
    if (e.metaKey) parts.push('Meta');
    if (e.key.length === 1) parts.push(e.key.toUpperCase());
    else if (!['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) parts.push(e.key);
    if (parts.length === 0 || parts.every(p => ['Ctrl','Alt','Shift','Meta'].includes(p))) {
      return; // wait for a real key
    }
    window.removeEventListener('keydown', handler, true);
    onCaptured(parts.join('+'));
  }
  window.addEventListener('keydown', handler, true);
  return () => window.removeEventListener('keydown', handler, true);
}
