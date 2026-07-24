// Electron main process. Boots a small status window, starts the
// WebSocket bridge on localhost, and wires the selected USB reader
// adapter so scans flow to the Cashier browser app.
//
// Adapter selection (env): MOVIRA_WRISTBAND_ADAPTER = mock | acr122u
// Bridge port (env):        MOVIRA_WRISTBAND_PORT     default 7777
//
// The Cashier reads bridgePort + reader from the location's
// wristbandConfig.rfid blob (admin → Wristbands page) and connects
// here. Once a scan lands, we broadcast it to every connected client;
// the browser consumer dispatches the existing `cashier:scan` window
// event so the listeners already wired in Redeem.jsx Just Work.

"use strict";

const path = require("path");
const { app, BrowserWindow, Menu, Tray, nativeImage } = require("electron");
const { startBridge } = require("./bridge");
const { loadAdapter } = require("./adapters");

const PORT = Number(process.env.MOVIRA_WRISTBAND_PORT) || 7777;
const ADAPTER_KEY = (process.env.MOVIRA_WRISTBAND_ADAPTER || "mock").toLowerCase();

let win = null;
let tray = null;
let bridge = null;
let adapter = null;
let scanCount = 0;
let lastScanAt = null;
let lastUid = null;

const buildStatusHtml = () => `<!doctype html>
<html><head><meta charset="utf-8" /><title>Movira Wristband Sidecar</title>
<style>
  :root { color-scheme: light dark; font-family: -apple-system, Segoe UI, Roboto, sans-serif; }
  body { margin: 0; padding: 16px; font-size: 13px; line-height: 1.4; }
  h1 { font-size: 14px; margin: 0 0 8px; letter-spacing: 0.04em; text-transform: uppercase; color: #8A5A00; }
  .row { display: flex; justify-content: space-between; gap: 8px; padding: 4px 0; border-bottom: 1px solid #eee; }
  .row:last-child { border-bottom: none; }
  .k { color: #6B7280; }
  .v { font-weight: 700; }
  .pill { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 10px; font-weight: 800; letter-spacing: 0.06em; text-transform: uppercase; }
  .ok { background: #DCFCE7; color: #137A35; }
  .warn { background: #FFF7E5; color: #8A5A00; }
  code { font-family: ui-monospace, Menlo, monospace; background: #F3F4F6; padding: 1px 6px; border-radius: 4px; }
</style></head>
<body>
  <h1>Movira Wristband Sidecar</h1>
  <div class="row"><span class="k">Bridge</span><span class="v" id="bridge">starting…</span></div>
  <div class="row"><span class="k">Adapter</span><span class="v" id="adapter">${ADAPTER_KEY}</span></div>
  <div class="row"><span class="k">Reader status</span><span class="v" id="reader">—</span></div>
  <div class="row"><span class="k">Scans this session</span><span class="v" id="scans">0</span></div>
  <div class="row"><span class="k">Last scan</span><span class="v" id="last">—</span></div>
  <p style="margin-top: 12px; color: #6B7280; font-size: 11px;">
    Cashier connects to <code>ws://127.0.0.1:${PORT}</code>. Closing this
    window keeps the sidecar running in the tray.
  </p>
  <script>
    // The main process pushes status by invoking __pushStatus via
    // win.webContents.executeJavaScript. Each call may include any
    // subset of fields — we patch only what's present.
    window.__pushStatus = function (m) {
      if (!m) return;
      if (m.bridge != null) document.getElementById("bridge").textContent = m.bridge;
      if (m.reader != null) document.getElementById("reader").textContent = m.reader;
      if (m.scans != null)  document.getElementById("scans").textContent = m.scans;
      if (m.last != null)   document.getElementById("last").textContent = m.last;
    };
  </script>
</body></html>`;

// Push the current sidecar state into the status window. `patch` lets
// callers override individual fields (e.g. the scan handler bumps
// `scans` + `last`). Calls are no-ops when the window has been closed
// (the sidecar still runs in the tray, just nothing to render to).
const updateStatus = (patch = {}) => {
  if (!win || win.isDestroyed()) return;
  const state = {
    bridge: bridge?.url || "starting…",
    reader: adapter?.status() || "—",
    scans: scanCount,
    last: lastUid
      ? `${lastUid} · ${new Date(lastScanAt).toLocaleTimeString()}`
      : "—",
    ...patch,
  };
  // Inject by calling __pushStatus directly. dom-ready isn't fired
  // until the data: URL finishes parsing, so swallow the rejection
  // for the very first call.
  win.webContents
    .executeJavaScript(
      `(typeof __pushStatus === "function" && __pushStatus(${JSON.stringify(state)}))`
    )
    .catch(() => {});
};

const createWindow = () => {
  win = new BrowserWindow({
    width: 380,
    height: 320,
    resizable: false,
    minimizable: true,
    maximizable: false,
    title: "Movira Wristband Sidecar",
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  // Load the inline status HTML.
  const dataUrl = "data:text/html;charset=utf-8," + encodeURIComponent(buildStatusHtml());
  win.loadURL(dataUrl);
  // The first updateStatus() calls race the data:URL parse, so push
  // a fresh snapshot once the page is actually live. Subsequent
  // adapter events flow through updateStatus normally.
  win.webContents.once("did-finish-load", () => updateStatus());
  win.on("close", (e) => {
    // Keep the sidecar running in the tray when the window is closed.
    if (!app.isQuitting) {
      e.preventDefault();
      win.hide();
    }
  });
};

const createTray = () => {
  // No icon shipped yet — use a 1x1 transparent placeholder so the
  // tray exists. Replace with branded PNG before packaging.
  const blankIcon = nativeImage.createFromBuffer(
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
      "base64"
    )
  );
  tray = new Tray(blankIcon);
  tray.setToolTip("Movira Wristband Sidecar");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Show status", click: () => win?.show() },
      { type: "separator" },
      { label: "Quit", click: () => { app.isQuitting = true; app.quit(); } },
    ])
  );
};

app.whenReady().then(async () => {
  createWindow();
  createTray();

  // Wire the adapter to push scans through the bridge.
  adapter = loadAdapter(ADAPTER_KEY);
  bridge = await startBridge({
    port: PORT,
    onClient: () => updateStatus(),
  });
  updateStatus();

  adapter.on("scan", (scan) => {
    scanCount += 1;
    lastScanAt = scan.at;
    lastUid = scan.uid;
    bridge.broadcast({
      type: "rfid_scan",
      uid: scan.uid,
      reader: scan.reader,
      at: scan.at,
    });
    updateStatus({ type: "scan", count: scanCount, uid: scan.uid, at: scan.at });
  });
  adapter.on("status", () => updateStatus());

  try {
    await adapter.start();
  } catch (err) {
    console.error("[sidecar] adapter failed to start:", err.message);
    updateStatus();
  }
});

app.on("window-all-closed", () => {
  // macOS convention: keep app running even with no windows.
  // Other platforms: same — we live in the tray.
});

app.on("before-quit", async () => {
  app.isQuitting = true;
  try { await adapter?.stop?.(); } catch {}
  try { await bridge?.stop?.(); } catch {}
});
