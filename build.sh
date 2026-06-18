#!/bin/bash
set -e
echo "Building UI..."
cd "$(dirname "$0")/studio"
npm run build
echo "Copying to desktop..."
rm -rf ../desktop/ui
cp -r out ../desktop/ui
echo "Done. Relaunch the Electron app."
