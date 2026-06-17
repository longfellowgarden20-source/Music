"""Frozen entry point for the bundled engine.

PyInstaller needs a concrete script to start, so this stands in for
`python -m uvicorn music_studio.api_server:app`. The Electron shell launches
the resulting binary and waits for the port to answer.
"""
import os
import sys

# When frozen, the repo isn't importable by path — but PyInstaller bundles the
# music_studio package into the binary, so a plain import works.
if __name__ == "__main__":
    port = int(os.environ.get("STEMAI_PORT", "8765"))
    import uvicorn
    from music_studio.api_server import app
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="warning")
