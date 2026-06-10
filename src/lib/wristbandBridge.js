// Cashier-side bridge to the Movira Wristband Sidecar (Electron app
// running on the same machine as the till). Connects over localhost
// WebSocket, normalises RFID scans into the same `cashier:scan`
// CustomEvent shape that USB-HID barcode scans use, and exposes a tiny
// status API so a header indicator can show "🟢 reader connected" vs
// "🔴 sidecar offline".
//
// One connection per browser tab. Auto-reconnects with backoff if the
// sidecar restarts or the user wakes the tablet from sleep.
//
// Consumers:
//   • Existing window event listeners (e.g. Redeem.jsx's
//     handleTokenInput) react to the dispatched scans with no code
//     change.
//   • A future "Bind wristband to participant" flow listens to the
//     SAME event but with detail.source === "rfid" to distinguish
//     wristband UIDs from barcode tokens.
//
// Wire shape sent by the sidecar (bridge.js):
//   { type: "rfid_scan", uid: "04A53C1F", reader: "ACR122U", at: 1781050000000 }

"use strict";

const DEFAULT_PORT = 7777;
const RECONNECT_MIN_MS = 1000;
const RECONNECT_MAX_MS = 30000;

let ws = null;
let stopRequested = false;
let reconnectMs = RECONNECT_MIN_MS;
let reconnectTimer = null;
let currentPort = DEFAULT_PORT;
let lastConnectedAt = null;
let lastScanAt = null;
let scanCount = 0;
const statusListeners = new Set();

const fireStatus = (state, detail = {}) => {
  for (const fn of statusListeners) {
    try { fn({ state, ...detail }); } catch {}
  }
  try {
    window.dispatchEvent(
      new CustomEvent("cashier:wristband-bridge-status", {
        detail: { state, port: currentPort, ...detail },
      })
    );
  } catch {}
};

const handleMessage = (raw) => {
  let msg;
  try { msg = JSON.parse(raw); } catch { return; }

  if (msg.type === "hello") {
    fireStatus("connected", { at: msg.at });
    return;
  }

  if (msg.type === "rfid_scan" && typeof msg.uid === "string") {
    lastScanAt = msg.at || Date.now();
    scanCount += 1;
    // Mirror the USB-HID scanner pipe so existing handlers Just Work.
    // detail.source === "rfid" lets new consumers distinguish.
    try {
      window.dispatchEvent(
        new CustomEvent("cashier:scan", {
          detail: {
            code: msg.uid,
            source: "rfid",
            reader: msg.reader || null,
            at: lastScanAt,
          },
        })
      );
    } catch {}
    fireStatus("connected", { scanCount, lastScanAt, lastUid: msg.uid });
  }
};

const scheduleReconnect = () => {
  if (stopRequested) return;
  clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(() => {
    connectOnce();
  }, reconnectMs);
  reconnectMs = Math.min(reconnectMs * 2, RECONNECT_MAX_MS);
};

const connectOnce = () => {
  if (stopRequested) return;
  const url = `ws://127.0.0.1:${currentPort}/`;
  try {
    ws = new WebSocket(url);
  } catch (err) {
    fireStatus("error", { message: err?.message || String(err) });
    scheduleReconnect();
    return;
  }
  ws.addEventListener("open", () => {
    lastConnectedAt = Date.now();
    reconnectMs = RECONNECT_MIN_MS; // reset backoff on success
    fireStatus("open", { at: lastConnectedAt });
  });
  ws.addEventListener("message", (e) => handleMessage(String(e.data)));
  ws.addEventListener("close", () => {
    ws = null;
    fireStatus("closed");
    scheduleReconnect();
  });
  ws.addEventListener("error", () => {
    // Browser fires "error" right before "close" when the socket can't
    // open — we'll reconnect from the close handler.
  });
};

/**
 * Start (or restart) the bridge. Idempotent — safe to call multiple
 * times. Pass a port to point at a non-default sidecar.
 */
export function startWristbandBridge({ port } = {}) {
  if (typeof window === "undefined") return;
  stopRequested = false;
  currentPort = Number(port) || DEFAULT_PORT;
  clearTimeout(reconnectTimer);
  try { ws?.close(); } catch {}
  ws = null;
  reconnectMs = RECONNECT_MIN_MS;
  connectOnce();
}

/**
 * Tear down the bridge. Use on logout / app teardown so we don't
 * leave a zombie WebSocket trying to reconnect forever.
 */
export function stopWristbandBridge() {
  stopRequested = true;
  clearTimeout(reconnectTimer);
  try { ws?.close(); } catch {}
  ws = null;
  fireStatus("stopped");
}

/**
 * Subscribe to status updates. Returns an unsubscribe function. The
 * sidebar / header can use this to render a connection indicator
 * without polling.
 */
export function onWristbandBridgeStatus(fn) {
  statusListeners.add(fn);
  return () => statusListeners.delete(fn);
}

/**
 * Snapshot of the current bridge state for diagnostics tooltips.
 */
export function getWristbandBridgeStatus() {
  return {
    connected: ws?.readyState === 1, // WebSocket.OPEN
    port: currentPort,
    lastConnectedAt,
    lastScanAt,
    scanCount,
  };
}
