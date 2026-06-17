#!/bin/bash
# Launch the full AI Music Studio: FastAPI backend + Next.js frontend (+ DAW).
set -e
ROOT="/Users/surfs/Desktop/music-studio"
PY="$ROOT/music_env/bin/python3.12"

echo "🎵 Starting AI Music Studio…"

# 1. Backend API (port 8765) — uses the REAL library DB (no test env var)
if ! lsof -i :8765 -sTCP:LISTEN -t >/dev/null 2>&1; then
  echo "→ API backend on :8765"
  ( cd "$ROOT" && env -u MUSIC_STUDIO_TEST_DB "$PY" -m uvicorn music_studio.api_server:app \
      --port 8765 --host 0.0.0.0 > /tmp/api_server.log 2>&1 & )
else
  echo "→ API already running on :8765"
fi

# 2. Studio frontend (port 3002)
if ! lsof -i :3002 -sTCP:LISTEN -t >/dev/null 2>&1; then
  echo "→ Studio UI on :3002"
  ( cd "$ROOT/studio" && node node_modules/.bin/next dev --port 3002 > /tmp/studio_dev.log 2>&1 & )
else
  echo "→ Studio UI already running on :3002"
fi

# 3. DAW frontend (port 3000) — optional, the timeline/clip view
if ! lsof -i :3000 -sTCP:LISTEN -t >/dev/null 2>&1; then
  echo "→ DAW on :3000"
  ( cd "$ROOT/daw" && node node_modules/.bin/next dev --port 3000 > /tmp/daw_dev.log 2>&1 & )
else
  echo "→ DAW already running on :3000"
fi

sleep 3
echo ""
echo "✅ All up:"
echo "   Studio  → http://localhost:3002   (Library · Generate · Edit)"
echo "   DAW     → http://localhost:3000   (timeline / clip view)"
echo "   API     → http://localhost:8765"
