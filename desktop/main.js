// StemAI desktop shell.
//
// Responsibilities:
//   1. Launch the bundled Python engine (the FastAPI server) as a child process.
//   2. Wait until it answers on its port, then load the static Next.js UI.
//   3. Tear the engine down cleanly when the window closes.
//
// In dev (ELECTRON_DEV=1) it assumes you already run `npm run dev` for the UI
// and the engine yourself; it just opens the window pointed at localhost.

const { app, BrowserWindow, shell, dialog, systemPreferences } = require("electron");
const path = require("path");
const http = require("http");
const fs = require("fs");
const { spawn } = require("child_process");

const ENGINE_PORT = 8765;
const ENGINE_URL = `http://127.0.0.1:${ENGINE_PORT}`;
const UI_PORT = 8766;      // local static server for the exported UI
const IS_DEV = process.env.ELECTRON_DEV === "1";

let engine = null;        // child process handle
let uiServer = null;      // local http server for the static UI
let mainWindow = null;

// ── serve the static Next.js export over localhost ──────────────────────────
// Loading the export via file:// breaks Next's client-side routing (clean URLs
// like /generate/ resolve to directories and the page goes blank). Serving the
// same files over http makes routing behave exactly as it does in a browser.
const MIME = {
  ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".txt": "text/plain", ".svg": "image/svg+xml",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".ico": "image/x-icon", ".woff": "font/woff", ".woff2": "font/woff2",
  ".map": "application/json", ".wav": "audio/wav", ".mp3": "audio/mpeg",
};

function startUiServer(root) {
  return new Promise((resolve, reject) => {
    const send = (res, status, body, type) => {
      res.writeHead(status, { "Content-Type": type || "text/plain" });
      res.end(body);
    };
    uiServer = http.createServer((req, res) => {
      try {
        let rel = decodeURIComponent((req.url || "/").split("?")[0]);
        if (rel.endsWith("/")) rel += "index.html";
        let file = path.join(root, rel);
        // Prevent path traversal outside the UI root.
        if (!file.startsWith(root)) return send(res, 403, "Forbidden");
        // trailingSlash export: /generate -> /generate/index.html
        if (!fs.existsSync(file) && fs.existsSync(file + ".html")) file += ".html";
        else if (!fs.existsSync(file) && fs.existsSync(path.join(file, "index.html"))) {
          file = path.join(file, "index.html");
        }
        if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
          // SPA fallback for unknown routes -> the export's 404 or root.
          const fallback = path.join(root, "index.html");
          return send(res, 200, fs.readFileSync(fallback), "text/html");
        }
        send(res, 200, fs.readFileSync(file), MIME[path.extname(file)] || "application/octet-stream");
      } catch (e) {
        send(res, 500, String(e));
      }
    });
    uiServer.on("error", reject);
    uiServer.listen(UI_PORT, "127.0.0.1", () => resolve());
  });
}

// ── locate the bundled engine binary ────────────────────────────────────────
// In a packaged build, PyInstaller produces a `stemai-engine` executable that
// we place in resources/engine/. In dev we run the Python module directly.
function engineCommand() {
  if (IS_DEV) {
    const repoRoot = path.join(__dirname, "..");
    const py = path.join(repoRoot, "music_env", "bin", "python");
    return { cmd: py, args: ["-m", "uvicorn", "music_studio.api_server:app",
      "--port", String(ENGINE_PORT), "--log-level", "warning"], cwd: repoRoot };
  }
  const exeName = process.platform === "win32" ? "stemai-engine.exe" : "stemai-engine";
  const exe = path.join(process.resourcesPath, "engine", exeName);
  return { cmd: exe, args: [], cwd: path.dirname(exe) };
}

function startEngine() {
  const { cmd, args, cwd } = engineCommand();
  engine = spawn(cmd, args, {
    cwd,
    env: {
      ...process.env,
      STEMAI_REQUIRE_LICENSE: "1",          // packaged build always enforces the license
      STEMAI_GUMROAD_PRODUCT: process.env.STEMAI_GUMROAD_PRODUCT || "stemai",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  engine.stdout.on("data", (d) => console.log(`[engine] ${d}`));
  engine.stderr.on("data", (d) => console.error(`[engine] ${d}`));
  engine.on("exit", (code) => {
    console.log(`[engine] exited with ${code}`);
    engine = null;
  });
}

// Poll the engine's port until it responds (the model lazy-loads, but the
// HTTP server itself comes up fast — we only wait for the socket to answer).
function waitForEngine(timeoutMs = 60000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const ping = () => {
      const req = http.get(`${ENGINE_URL}/api/license`, (res) => {
        res.resume();
        resolve();
      });
      req.on("error", () => {
        if (Date.now() - start > timeoutMs) reject(new Error("Engine did not start in time."));
        else setTimeout(ping, 400);
      });
    };
    ping();
  });
}

// Grant mic + audio capture permissions to our own origin automatically.
// On macOS, also trigger the system-level mic permission prompt if not yet granted.
function setupPermissions(session) {
  session.setPermissionRequestHandler((webContents, permission, callback) => {
    const allowed = ["media", "audioCapture", "microphone"].includes(permission);
    callback(allowed);
  });
  // macOS: ask the system for mic access so the OS prompt appears the first time.
  if (process.platform === "darwin") {
    systemPreferences.askForMediaAccess("microphone").catch(() => {});
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 940,
    minHeight: 620,
    backgroundColor: "#0a0a0a",
    title: "StemAI",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      // Required for getUserMedia (mic + webcam) inside the embedded web view.
      // Without this, Chromium silently blocks all media device access.
      audioCapture: true,
    },
    show: false,
  });

  // Open external links in the real browser, not inside the app.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  if (IS_DEV) {
    const devPort = process.env.UI_DEV_PORT || "3000";
    mainWindow.loadURL(`http://localhost:${devPort}`);
  } else {
    mainWindow.loadURL(`http://127.0.0.1:${UI_PORT}/`);
  }
  // Show as soon as the window is ready *or* the page finishes loading —
  // whichever comes first — so a missed ready-to-show never leaves it hidden.
  const reveal = () => { if (mainWindow && !mainWindow.isVisible()) { mainWindow.show(); mainWindow.focus(); } };
  mainWindow.once("ready-to-show", reveal);
  mainWindow.webContents.once("did-finish-load", reveal);
  // Hard fallback: never leave the user staring at nothing.
  setTimeout(reveal, 4000);
}

app.whenReady().then(async () => {
  // Set up mic/media permissions before the window opens.
  const { session } = require("electron");
  setupPermissions(session.defaultSession);

  if (!IS_DEV) {
    startEngine();
    try {
      await startUiServer(path.join(__dirname, "ui"));
    } catch (e) {
      dialog.showErrorBox("StemAI couldn’t start", "Failed to start the UI server.\n\n" + e.message);
      app.quit();
      return;
    }
  }
  try {
    await waitForEngine();
  } catch (e) {
    dialog.showErrorBox(
      "StemAI couldn’t start",
      "The audio engine failed to launch. Please reinstall, or contact support if this keeps happening.\n\n" + e.message
    );
    app.quit();
    return;
  }
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

function stopEngine() {
  if (engine && !engine.killed) {
    engine.kill();
    engine = null;
  }
  if (uiServer) {
    try { uiServer.close(); } catch {}
    uiServer = null;
  }
}

app.on("window-all-closed", () => {
  stopEngine();
  if (process.platform !== "darwin") app.quit();
});
app.on("before-quit", stopEngine);
app.on("quit", stopEngine);
