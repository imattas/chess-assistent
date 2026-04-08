import { test, beforeEach } from 'node:test';
import assert from 'node:assert';
import { loadSettings, saveSettings, DEFAULT_SETTINGS, subscribe }
  from '../content/settings.js';

let store;
const listeners = [];

function installFakeBrowser() {
  store = {};
  global.browser = {
    storage: {
      sync: {
        async get(key) {
          if (key === null || key === undefined) return { ...store };
          if (typeof key === 'string') return { [key]: store[key] };
          return Object.fromEntries(
            Object.keys(key).map(k => [k, store[k] ?? key[k]])
          );
        },
        async set(obj) {
          Object.assign(store, obj);
          for (const fn of listeners) fn(obj, 'sync');
        }
      },
      onChanged: {
        addListener(fn) { listeners.push(fn); },
        removeListener(fn) {
          const i = listeners.indexOf(fn);
          if (i >= 0) listeners.splice(i, 1);
        }
      }
    }
  };
}

beforeEach(() => {
  installFakeBrowser();
});

test('loadSettings returns defaults when storage empty', async () => {
  const s = await loadSettings();
  assert.deepEqual(s, DEFAULT_SETTINGS);
});

test('saveSettings persists partial updates', async () => {
  await saveSettings({ engine: { ...DEFAULT_SETTINGS.engine, elo: 1800 } });
  const s = await loadSettings();
  assert.equal(s.engine.elo, 1800);
  assert.equal(s.engine.mode, DEFAULT_SETTINGS.engine.mode);
});

test('subscribe fires on change', async () => {
  let received = null;
  const unsub = subscribe(s => { received = s; });
  await saveSettings({ enabled: false });
  // microtask flush
  await new Promise(r => setTimeout(r, 0));
  assert.equal(received.enabled, false);
  unsub();
});

test('defaults are valid', () => {
  assert.equal(DEFAULT_SETTINGS.version, 2);
  assert.equal(DEFAULT_SETTINGS.enabled, true);
  assert.equal(DEFAULT_SETTINGS.hotkey, 'Alt+A');
  // trigger and per-site toggles were removed in v2: analysis is always
  // automatic on every move and the extension runs on every supported site.
  assert.equal(DEFAULT_SETTINGS.trigger, undefined);
  assert.equal(DEFAULT_SETTINGS.sites, undefined);
});
