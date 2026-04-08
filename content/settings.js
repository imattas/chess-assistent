// Settings module. Wraps browser.storage.sync with defaults and a subscribe API.
// In node tests, the test installs a fake `global.browser`.
// In the browser, `browser` is provided by browser-polyfill.min.js (loaded
// before this module by the manifest content_scripts entry).

export const DEFAULT_SETTINGS = Object.freeze({
  version: 2,
  enabled: true,
  engine: {
    elo: 2400,
    limitStrength: true,
    mode: 'time',     // 'time' | 'depth'
    timeMs: 1000,
    depth: 18
  },
  hotkey: 'Alt+A',
  display: {
    arrow: true,
    panel: true,
    evalBar: true,
    pvLines: true
  },
  panelPosition: { x: 24, y: 24 }
});

const STORAGE_KEY = 'chessAssistantSettings';

function deepMerge(base, overlay) {
  if (overlay === undefined || overlay === null) return base;
  if (typeof base !== 'object' || base === null) return overlay;
  const out = Array.isArray(base) ? [...base] : { ...base };
  for (const key of Object.keys(overlay)) {
    out[key] = deepMerge(base[key], overlay[key]);
  }
  return out;
}

export async function loadSettings() {
  const result = await browser.storage.sync.get(STORAGE_KEY);
  const stored = result[STORAGE_KEY];
  return deepMerge(DEFAULT_SETTINGS, stored);
}

export async function saveSettings(partial) {
  const current = await loadSettings();
  const merged = deepMerge(current, partial);
  await browser.storage.sync.set({ [STORAGE_KEY]: merged });
  return merged;
}

const subscribers = new Set();
let listenerInstalled = false;

function installListener() {
  if (listenerInstalled) return;
  listenerInstalled = true;
  browser.storage.onChanged.addListener(async (changes, area) => {
    if (area !== 'sync' || !changes[STORAGE_KEY]) return;
    const next = await loadSettings();
    for (const fn of subscribers) {
      try { fn(next); } catch (e) { console.error('settings subscriber threw', e); }
    }
  });
}

export function subscribe(fn) {
  installListener();
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}
