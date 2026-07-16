// Localhost WebSocket bridge between the sidecar process and the
// Cashier browser tab.
//
// Binds to 127.0.0.1 only — never expose this port on the LAN. RFID
// UIDs are physical credentials; a permissive bridge would let any
// device on the location's wifi inject scans. Loopback is the trust
// boundary.
//
// Wire protocol — JSON messages, one per ws frame:
//
//   server → client   { type: "hello", reader: "ACR122U", at }
//                     { type: "rfid_scan", uid, reader, at }
//
//   client → server   { type: "ping", at }
//                     (optional, lets the Cashier confirm liveness)
//
// One server, N clients. A scan goes to every connected client so the
// Cashier UI can also surface scan toasts in screens that aren't the
// active "bind" target (handy for diagnostics).

"use strict";

const http = require("http");
const { WebSocketServer } = require("ws");

const startBridge = async ({ port, onClient }) => {
  const httpServer = http.createServer((req, res) => {
    // Tiny health endpoint so the Cashier can probe whether the
    // sidecar is up without opening a WebSocket. Returns the same
    // shape as the WebSocket hello message.
    if (req.url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, version: 1 }));
      return;
    }
    res.writeHead(404).end();
  });

  // Bind explicitly to 127.0.0.1 — leaving the host arg out would bind
  // to all interfaces on some Node builds, leaking the port to the LAN.
  await new Promise((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(port, "127.0.0.1", resolve);
  });

  const wss = new WebSocketServer({ server: httpServer, path: "/" });
  wss.on("connection", (ws) => {
    ws.send(
      JSON.stringify({
        type: "hello",
        version: 1,
        at: Date.now(),
      })
    );
    ws.on("message", (raw) => {
      try {
        const msg = JSON.parse(String(raw));
        if (msg.type === "ping") {
          ws.send(JSON.stringify({ type: "pong", at: Date.now() }));
        }
      } catch {
        // Ignore garbage; protocol is strict-JSON.
      }
    });
    onClient?.(ws);
  });

  const broadcast = (msg) => {
    const payload = JSON.stringify(msg);
    for (const ws of wss.clients) {
      if (ws.readyState === ws.OPEN) {
        try { ws.send(payload); } catch { /* drop */ }
      }
    }
  };

  const stop = async () => {
    await new Promise((r) => wss.close(() => r()));
    await new Promise((r) => httpServer.close(() => r()));
  };

  return {
    broadcast,
    stop,
    url: `ws://127.0.0.1:${port}`,
    clientCount: () => wss.clients.size,
  };
};

module.exports = { startBridge };
