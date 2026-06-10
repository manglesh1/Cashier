// Adapter registry. Each adapter is a small EventEmitter that emits:
//   • "scan"   → { uid: string, reader: string, at: number }
//   • "status" → opaque; UI re-renders the status text via adapter.status()
//
// Adapters MUST be runnable on a dev workstation that has no USB reader
// attached. The mock adapter satisfies that contract by emitting fake
// scans on a timer. The real-hardware adapters (acr122u, etc.) should
// degrade to status='waiting for device' when their underlying lib
// fails to find a reader, NOT throw.

"use strict";

const loadAdapter = (key) => {
  const k = String(key || "mock").toLowerCase();
  if (k === "acr122u") {
    return require("./acr122u");
  }
  // PC/SC reader via a Python child process (pyscard). Easier than
  // the native node-pcsclite path on Windows — no C++ build tools
  // needed. Works for the ACR122U + any other PC/SC reader.
  if (k === "pcsc-python" || k === "python" || k === "pyscard") {
    return require("./pcsc-python");
  }
  if (k === "mock" || k === "" || !k) {
    return require("./mock");
  }
  console.warn(
    `[sidecar] unknown adapter "${k}", falling back to mock. Set MOVIRA_WRISTBAND_ADAPTER to one of: mock, pcsc-python, acr122u`
  );
  return require("./mock");
};

module.exports = { loadAdapter };
