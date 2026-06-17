// Minimal, safe bridge. The UI talks to the engine over HTTP (localhost:8765),
// so it needs almost nothing from Electron — we just expose a couple of facts
// the renderer can use without granting any Node access.
const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("stemai", {
  isDesktop: true,
  platform: process.platform,
  version: process.env.npm_package_version || "",
});
