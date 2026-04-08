#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIST="$ROOT/dist"
rm -rf "$DIST"
mkdir -p "$DIST"

STAGE_CHROME="$DIST/stage-chrome"
STAGE_FIREFOX="$DIST/stage-firefox"

copy_sources() {
  local target="$1"
  mkdir -p "$target"
  cp -r manifest.json background.js popup content engine vendor icons "$target/"
}

copy_sources "$STAGE_CHROME"
copy_sources "$STAGE_FIREFOX"

# Chrome doesn't accept browser_specific_settings — strip it.
node -e "
const fs = require('fs');
const path = '$STAGE_CHROME/manifest.json';
const m = JSON.parse(fs.readFileSync(path, 'utf8'));
delete m.browser_specific_settings;
delete m.background.scripts;  // Chrome MV3 uses service_worker only
fs.writeFileSync(path, JSON.stringify(m, null, 2));
"

# Firefox MV3 uses background.scripts (no service worker).
node -e "
const fs = require('fs');
const path = '$STAGE_FIREFOX/manifest.json';
const m = JSON.parse(fs.readFileSync(path, 'utf8'));
delete m.background.service_worker;
fs.writeFileSync(path, JSON.stringify(m, null, 2));
"

(cd "$STAGE_CHROME" && zip -r -q "../chrome.zip" .)
(cd "$STAGE_FIREFOX" && zip -r -q "../firefox.zip" .)

rm -rf "$STAGE_CHROME" "$STAGE_FIREFOX"

echo "Built:"
ls -lh "$DIST"/*.zip
