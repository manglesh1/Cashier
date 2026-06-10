// PC/SC adapter via a Python child process.
//
// Why: @pokusew/pcsclite needs the Visual Studio C++ Build Tools to
// compile on Windows. pyscard ships prebuilt wheels — `pip install
// pyscard` is a 30-second install with zero compiler dependencies.
// This adapter spawns ../pcsc_reader.py and parses its JSON-line
// stdout, then emits the same `scan` events the native adapter would.
//
// Tradeoff: needs Python 3.7+ on the host machine. On a production
// till, that's a one-time install — easier than the C++ workload.
// We could also bundle Python with electron-builder; see the README
// for the production-packaging plan.

"use strict";

const { EventEmitter } = require("events");
const { spawn } = require("child_process");
const path = require("path");

class PcscPythonAdapter extends EventEmitter {
  constructor() {
    super();
    this._proc = null;
    this._statusText = "PC/SC (Python) · idle";
    this._buf = "";
  }

  status() {
    return this._statusText;
  }

  async start() {
    const scriptPath = path.join(__dirname, "..", "..", "pcsc_reader.py");
    // Pick the python binary — try `py -3` first on Windows (Python
    // launcher), then `python3`, then plain `python`. Stops at the
    // first one that exists.
    const candidates =
      process.platform === "win32"
        ? [{ cmd: "py", args: ["-3", scriptPath] }, { cmd: "python", args: [scriptPath] }, { cmd: "python3", args: [scriptPath] }]
        : [{ cmd: "python3", args: [scriptPath] }, { cmd: "python", args: [scriptPath] }];

    let spawned = false;
    for (const { cmd, args } of candidates) {
      try {
        this._proc = spawn(cmd, args, { windowsHide: true });
      } catch {
        continue;
      }
      // Defer the existence check until we get a stdout/stderr event
      // or the process emits 'error'. spawn() doesn't throw for
      // missing binaries; we listen for the error event below.
      spawned = true;
      break;
    }

    if (!spawned || !this._proc) {
      this._statusText = "PC/SC · Python not found (install python.org)";
      this.emit("status");
      return;
    }

    this._statusText = "PC/SC (Python) · starting";
    this.emit("status");

    this._proc.on("error", (err) => {
      this._statusText = `PC/SC · spawn failed: ${err.message}`;
      this.emit("status");
    });

    this._proc.stdout.on("data", (chunk) => {
      this._buf += chunk.toString("utf8");
      // Process complete lines; keep any partial line in the buffer.
      let nl;
      while ((nl = this._buf.indexOf("\n")) >= 0) {
        const line = this._buf.slice(0, nl).trim();
        this._buf = this._buf.slice(nl + 1);
        if (!line) continue;
        let msg;
        try { msg = JSON.parse(line); } catch { continue; }
        if (msg.type === "scan" && typeof msg.uid === "string") {
          this.emit("scan", {
            uid: msg.uid.toUpperCase(),
            reader: "PC/SC (Python)",
            at: Date.now(),
          });
        } else if (msg.type === "status") {
          if (msg.state === "ready") {
            this._statusText = `PC/SC (Python) · listening (${msg.reader || "reader"})`;
          } else if (msg.state === "no_readers") {
            this._statusText = "PC/SC (Python) · waiting for reader";
          } else if (msg.state === "stopping") {
            this._statusText = "PC/SC (Python) · stopping";
          }
          this.emit("status");
        } else if (msg.type === "error") {
          this._statusText = `PC/SC (Python) · ${msg.msg}`;
          this.emit("status");
        }
      }
    });

    this._proc.stderr.on("data", (chunk) => {
      // Don't surface every Python warning to the UI, but log it for
      // the dev to see.
      console.warn("[pcsc-python]", chunk.toString("utf8").trim());
    });

    this._proc.on("exit", (code) => {
      this._statusText = `PC/SC (Python) · exited (code ${code})`;
      this.emit("status");
      this._proc = null;
    });
  }

  async stop() {
    if (this._proc) {
      try { this._proc.kill(); } catch {}
      this._proc = null;
    }
    this._statusText = "PC/SC (Python) · stopped";
    this.emit("status");
  }
}

module.exports = new PcscPythonAdapter();
