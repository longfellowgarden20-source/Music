#!/bin/bash
# One command to run StemAI in dev mode.
# Kills any stale processes, starts the engine, then launches Electron.

ROOT="$(cd "$(dirname "$0")" && pwd)"

echo "Cleaning up old processes..."
pkill -f "Electron" 2>/dev/null
pkill -f "stemai-engine" 2>/dev/null
pkill -f "api_server" 2>/dev/null
sleep 1

# Free ports if still held
for PORT in 8765 8766; do
  PID=$(lsof -ti tcp:$PORT 2>/dev/null)
  if [ -n "$PID" ]; then
    echo "Killing process on port $PORT (pid $PID)..."
    kill -9 $PID 2>/dev/null
  fi
done
sleep 0.5

echo "Starting engine on port 8765..."
cd "$ROOT"
music_env/bin/python -m uvicorn music_studio.api_server:app \
  --port 8765 --host 127.0.0.1 --log-level warning &
ENGINE_PID=$!

echo "Waiting for engine..."
for i in $(seq 1 30); do
  if curl -s http://127.0.0.1:8765/api/license > /dev/null 2>&1; then
    echo "Engine ready."
    break
  fi
  sleep 1
done

echo "Launching app..."
cd "$ROOT/desktop"
env -u ELECTRON_RUN_AS_NODE ELECTRON_DEV=1 UI_DEV_PORT=3001 ./node_modules/.bin/electron .

# When Electron exits, kill the engine too
kill $ENGINE_PID 2>/dev/null
echo "Done."
