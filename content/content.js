// Classic-script content-script entry point.
//
// MV3 content scripts registered via `content_scripts.js` are loaded as
// CLASSIC scripts — `import` statements at top level would be a syntax error.
// All real logic lives in `content/main.js`, which is an ES module loaded
// here via dynamic import (the documented MV3 escape hatch). The module file
// must be listed in `web_accessible_resources` in the manifest so the
// extension URL is reachable.
//
// `chess.js` is loaded as `vendor/chess.min.js` BEFORE this file by the
// manifest's content_scripts.js array, so by the time main.js runs,
// `globalThis.Chess` is already a function.

(async () => {
  try {
    const main = await import(browser.runtime.getURL('content/main.js'));
    await main.run();
  } catch (e) {
    console.error('[chess-assistant] failed to bootstrap:', e);
  }
})();
