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
  if (k === "mock" || k === "" || !k) {
    return require("./mock");
  }
  // Unknown adapter — fall back to mock so the sidecar still runs and
  // the user sees the misconfiguration in the status panel.
  console.warn(
    `[sidecar] unknown adapter "${k}", falling back to mock. Set MOVIRA_WRISTBAND_ADAPTER to one of: mock, acr122u`
  );
  return require("./mock");
};

module.exports = { loadAdapter };
