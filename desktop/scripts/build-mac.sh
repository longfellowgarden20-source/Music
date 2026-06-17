#!/usr/bin/env bash
# One-command Mac build: bundle the Python engine, build the UI, stage both,
# and package the .dmg. Run from the desktop/ folder:
#   bash scripts/build-mac.sh
set -euo pipefail

DESKTOP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
REPO_ROOT="$(cd "$DESKTOP_DIR/.." && pwd)"
PY="$REPO_ROOT/music_env/bin/python"

echo "▸ 1/4  Bundling the engine (PyInstaller)…"
cd "$REPO_ROOT"
"$PY" -m PyInstaller desktop/engine.spec --noconfirm \
  --distpath desktop/engine_build --workpath desktop/build_work

echo "▸ 2/4  Staging engine binary into desktop/engine…"
rm -rf "$DESKTOP_DIR/engine"
mkdir -p "$DESKTOP_DIR/engine"
cp -R "$DESKTOP_DIR/engine_build/stemai-engine/." "$DESKTOP_DIR/engine/"

echo "▸ 3/4  Building the UI (static export)…"
cd "$REPO_ROOT/studio"
npm run build

echo "▸ 4/4  Packaging the .dmg…"
cd "$DESKTOP_DIR"
npm run pack:mac

echo ""
echo "✓ Done. Installer is in desktop/dist/"
ls -1 "$DESKTOP_DIR/dist/"*.dmg 2>/dev/null || true
