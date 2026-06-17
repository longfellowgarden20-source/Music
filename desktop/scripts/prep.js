// Copies the latest static UI export into desktop/ui/ so electron-builder
// bundles it. Run automatically before every pack. Fails loudly if the UI
// hasn't been built yet — better than shipping a stale or empty window.
const fs = require("fs");
const path = require("path");

const here = __dirname;
const desktop = path.join(here, "..");
const uiSrc = path.join(desktop, "..", "studio", "out");
const uiDest = path.join(desktop, "ui");

if (!fs.existsSync(path.join(uiSrc, "index.html"))) {
  console.error("\n✗ studio/out is missing. Build the UI first:\n    (cd ../studio && npm run build)\n");
  process.exit(1);
}

fs.rmSync(uiDest, { recursive: true, force: true });
fs.cpSync(uiSrc, uiDest, { recursive: true });
console.log("✓ UI copied into desktop/ui");

// Sanity-check the engine binary is present for a real pack (not dev).
const engineDir = path.join(desktop, "engine");
const hasEngine =
  fs.existsSync(path.join(engineDir, "stemai-engine")) ||
  fs.existsSync(path.join(engineDir, "stemai-engine.exe"));
if (!hasEngine) {
  console.warn("⚠ desktop/engine has no built engine binary yet.");
  console.warn("  Build it with the PyInstaller spec before a real package.");
}
