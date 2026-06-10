// Mock RFID adapter. Emits a fake scan every MOVIRA_WRISTBAND_MOCK_MS
// ms (default 7000) so the Cashier UI can be developed end-to-end
// without USB hardware attached. Hot-key: press M in the sidecar
// status window to emit a scan on demand (not yet wired — see TODO).
//
// UID format mimics ACR122U output (uppercase hex, 8 chars = 4-byte
// UID, the common Mifare Classic case). Adjust if your downstream
// expects 7-byte (NFC Type 2) or 10-byte (NFC Type A).

"use strict";

const { EventEmitter } = require("events");

const TICK_MS = Number(process.env.MOVIRA_WRISTBAND_MOCK_MS) || 7000;

const randHex = (bytes = 4) =>
  Array.from({ length: bytes }, () =>
    Math.floor(Math.random() * 256).toString(16).padStart(2, "0").toUpperCase()
  ).join("");

class MockAdapter extends EventEmitter {
  constructor() {
    super();
    this._timer = null;
    this._statusText = "mock · idle";
  }

  status() {
    return this._statusText;
  }

  async start() {
    this._statusText = `mock · scanning every ${Math.round(TICK_MS / 1000)}s`;
    this.emit("status");
    this._timer = setInterval(() => {
      const uid = randHex(4);
      this.emit("scan", { uid, reader: "mock", at: Date.now() });
    }, TICK_MS);
  }

  async stop() {
    if (this._timer) clearInterval(this._timer);
    this._timer = null;
    this._statusText = "mock · stopped";
    this.emit("status");
  }
}

module.exports = new MockAdapter();
