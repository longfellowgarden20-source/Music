#!/bin/bash
# Rebuild the UI and push it into the installed dock app (/Applications/StemAI.app)
# without a full electron-builder repackage. Re-signs so Gatekeeper allows it.
set -e
ROOT="$(cd "$(dirname "$0")" && pwd)"
APP="/Applications/StemAI.app"
ASAR="$ROOT/desktop/node_modules/.bin/asar"

echo "[1/5] Building UI..."
cd "$ROOT/studio"
npm run build

echo "[2/5] Copying build into desktop/ui..."
rm -rf "$ROOT/desktop/ui"
cp -r "$ROOT/studio/out" "$ROOT/desktop/ui"

if [ ! -d "$APP" ]; then
  echo "Dock app not found at $APP — skipping dock update."
  echo "Done (dev/ui updated only)."
  exit 0
fi

# Ensure libintl is in place (required by the engine's Python runtime)
LIBINTL_SRC="/opt/homebrew/lib/libintl.8.dylib"
LIBINTL_DST="$APP/Contents/libintl.8.dylib"
if [ -f "$LIBINTL_SRC" ] && [ ! -f "$LIBINTL_DST" ]; then
  cp "$LIBINTL_SRC" "$LIBINTL_DST"
fi

echo "[3/5] Repacking app.asar..."
pkill -f "StemAI" 2>/dev/null || true
sleep 1
rm -rf /tmp/stemai_asar
"$ASAR" extract "$APP/Contents/Resources/app.asar" /tmp/stemai_asar
rm -rf /tmp/stemai_asar/ui
cp -r "$ROOT/desktop/ui" /tmp/stemai_asar/ui
cp "$ROOT/desktop/main.js" /tmp/stemai_asar/main.js
cp "$ROOT/desktop/preload.js" /tmp/stemai_asar/preload.js
"$ASAR" pack /tmp/stemai_asar "$APP/Contents/Resources/app.asar"

echo "[4/5] Clearing quarantine..."
xattr -cr "$APP"

echo "[5/5] Re-signing (ad-hoc)..."
codesign --force --deep --sign - "$APP" 2>&1 | tail -1

echo "Done. Reopen StemAI from the dock."
