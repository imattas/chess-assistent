import { loadSettings, saveSettings, DEFAULT_SETTINGS } from '../content/settings.js';
import { captureCombo } from '../content/hotkeys.js';

const $ = (id) => document.getElementById(id);

function bindCheckbox(id, getter, setter) {
  const el = $(id);
  el.checked = getter();
  el.addEventListener('change', () => setter(el.checked));
}

function bindRange(id, valueId, getter, setter, formatter = (v) => v) {
  const el = $(id);
  const valEl = $(valueId);
  el.value = String(getter());
  if (valEl) valEl.textContent = String(formatter(el.value));
  el.addEventListener('input', () => {
    if (valEl) valEl.textContent = String(formatter(el.value));
    setter(parseInt(el.value, 10));
  });
}

function bindRadio(name, getter, setter) {
  const radios = document.querySelectorAll(`input[name="${name}"]`);
  for (const r of radios) {
    r.checked = r.value === getter();
    r.addEventListener('change', () => { if (r.checked) setter(r.value); });
  }
}

async function render() {
  const s = await loadSettings();

  bindCheckbox('enabled', () => s.enabled, async v => { await saveSettings({ enabled: v }); });

  bindRange('elo', 'elo-value', () => s.engine.elo, async v =>
    saveSettings({ engine: { ...s.engine, elo: v } }));

  bindCheckbox('unlimited', () => !s.engine.limitStrength, async v =>
    saveSettings({ engine: { ...s.engine, limitStrength: !v } }));

  bindRadio('mode', () => s.engine.mode, async v =>
    saveSettings({ engine: { ...s.engine, mode: v } }));

  bindRange('time', 'time-value', () => s.engine.timeMs, async v =>
    saveSettings({ engine: { ...s.engine, timeMs: v } }));

  bindRange('depth', 'depth-value', () => s.engine.depth, async v =>
    saveSettings({ engine: { ...s.engine, depth: v } }));

  const hotkeyBtn = $('hotkey-btn');
  hotkeyBtn.textContent = s.hotkey;
  hotkeyBtn.addEventListener('click', () => {
    hotkeyBtn.textContent = 'Press a key…';
    hotkeyBtn.classList.add('capturing');
    captureCombo(combo => {
      hotkeyBtn.textContent = combo;
      hotkeyBtn.classList.remove('capturing');
      saveSettings({ hotkey: combo });
    });
  });

  bindCheckbox('show-arrow', () => s.display.arrow, async v =>
    saveSettings({ display: { ...s.display, arrow: v } }));
  bindCheckbox('show-panel', () => s.display.panel, async v =>
    saveSettings({ display: { ...s.display, panel: v } }));
  bindCheckbox('show-evalbar', () => s.display.evalBar, async v =>
    saveSettings({ display: { ...s.display, evalBar: v } }));
  bindCheckbox('show-pvlines', () => s.display.pvLines, async v =>
    saveSettings({ display: { ...s.display, pvLines: v } }));

  $('reset').addEventListener('click', async () => {
    await browser.storage.sync.set({ chessAssistantSettings: DEFAULT_SETTINGS });
    window.location.reload();
  });
}

render().catch(e => console.error('[popup]', e));
