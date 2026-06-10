// ACR122U adapter — PCSC-Lite based. The ACR122U enumerates as a
// PC/SC smartcard reader; node-pcsclite handles the connection,
// transmits the "GET DATA UID" APDU (FF CA 00 00 00) to the tag,
// and we hand the UID up as a scan event.
//
// node-pcsclite is an optional dep — listed under optionalDependencies
// in package.json so a CI run without USB libraries still installs.
// At runtime, if the lib is unavailable, we degrade to status
// "ACR122U · driver not installed" and emit no scans. The sidecar
// stays alive so the Cashier sees a clear "reader missing" signal.
//
// Production prerequisites (Windows):
//   • Install the ACS unified driver:
//     https://www.acs.com.hk/en/driver/3/acr122u-usb-nfc-reader/
//   • Plug in the reader — Windows surfaces it as a "Smart Card Reader"
//   • Run the sidecar; status should switch to "ACR122U · listening"
//
// macOS: PC/SC is built-in (CryptoTokenKit). Plug + run.
// Linux: install pcscd and libccid, then plug + run.

"use strict";

const { EventEmitter } = require("events");

const GET_DATA_UID = Buffer.from([0xff, 0xca, 0x00, 0x00, 0x00]);

class Acr122uAdapter extends EventEmitter {
  constructor() {
    super();
    this._pcsc = null;
    this._reader = null;
    this._statusText = "ACR122U · idle";
  }

  status() {
    return this._statusText;
  }

  async start() {
    let pcsclite;
    try {
      pcsclite = require("@pokusew/pcsclite");
    } catch (err) {
      this._statusText = "ACR122U · driver not installed (see README)";
      this.emit("status");
      console.warn(
        "[acr122u] @pokusew/pcsclite not loadable. Mock adapter is the fallback for dev; install the lib + ACS driver for real hardware.",
        err.message
      );
      return;
    }

    this._statusText = "ACR122U · waiting for reader";
    this.emit("status");

    this._pcsc = pcsclite();
    this._pcsc.on("reader", (reader) => {
      // The ACR122U exposes more than one reader endpoint; we want the
      // one with "PICC" in the name (the contactless one).
      const name = String(reader.name || "");
      if (!/picc|acr122/i.test(name)) {
        return;
      }
      this._reader = reader;
      this._statusText = `ACR122U · listening (${name})`;
      this.emit("status");

      reader.on("status", (status) => {
        const cardPresent =
          (status.state & reader.SCARD_STATE_PRESENT) > 0 &&
          (status.state & reader.SCARD_STATE_MUTE) === 0;

        if (cardPresent) {
          reader.connect(
            { share_mode: reader.SCARD_SHARE_SHARED },
            (err, protocol) => {
              if (err) return; // tag pulled before connect — ignore
              reader.transmit(GET_DATA_UID, 16, protocol, (txErr, data) => {
                if (txErr || !data || data.length < 2) {
                  reader.disconnect(() => {});
                  return;
                }
                // Last two bytes are the status word (90 00 = OK). UID
                // is the prefix.
                const sw = (data[data.length - 2] << 8) | data[data.length - 1];
                if (sw !== 0x9000) {
                  reader.disconnect(() => {});
                  return;
                }
                const uid = data
                  .slice(0, data.length - 2)
                  .toString("hex")
                  .toUpperCase();
                this.emit("scan", {
                  uid,
                  reader: name,
                  at: Date.now(),
                });
                reader.disconnect(() => {});
              });
            }
          );
        }
      });

      reader.on("end", () => {
        if (this._reader === reader) {
          this._reader = null;
          this._statusText = "ACR122U · reader removed";
          this.emit("status");
        }
      });

      reader.on("error", (err) => {
        console.warn("[acr122u] reader error:", err.message);
      });
    });

    this._pcsc.on("error", (err) => {
      this._statusText = `ACR122U · pcsc error: ${err.message}`;
      this.emit("status");
    });
  }

  async stop() {
    try { this._reader?.close?.(); } catch {}
    try { this._pcsc?.close?.(); } catch {}
    this._reader = null;
    this._pcsc = null;
    this._statusText = "ACR122U · stopped";
    this.emit("status");
  }
}

module.exports = new Acr122uAdapter();
