// Global barcode / card-reader capture. POS scanners (USB HID) emit
// characters very rapidly — typically <50ms between keys, ending with
// Enter (CR) or Tab. Human typing is two or more orders of magnitude
// slower, so a rapid burst followed by Enter is a reliable scan signal
// even when the cashier has tapped away from the Redeem input.
//
// Usage:
//   import { attachScannerListener } from "./lib/scanner";
//   useEffect(() => attachScannerListener(), []);
//   window.addEventListener("cashier:scan", (e) => submitCode(e.detail.code));
//
// Why dispatch a custom event instead of calling a callback directly?
// • Lets multiple screens subscribe without coupling to a single owner
// • Plays well with React's lifecycle (subscribe/unsubscribe with useEffect)
// • Mirrors the hardware-bridge pattern in src/lib/hardware.js

// Tunable: max ms between keystrokes that still counts as a single scan
// burst. 80ms is conservative for cheap USB scanners; faster scanners
// stay well under 30ms. Human typing is rarely under 90ms.
const MAX_INTER_KEY_MS = 80;
// Minimum characters in a burst before we accept it as a scan. Stops
// "EnterEnter" or other stray keypresses from triggering scans.
const MIN_SCAN_LEN = 4;

let attached = false;

export function attachScannerListener({ targetEl } = {}) {
  if (typeof window === "undefined") return () => {};
  if (attached) return () => {};
  attached = true;

  const target = targetEl || window;
  let buffer = "";
  let lastKeyAt = 0;

  const onKeyDown = (e) => {
    // Skip modifier-only events and key combos (Ctrl+R, Cmd+P, etc.)
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const key = typeof e?.key === "string" ? e.key : "";
    if (!key) {
      buffer = "";
      return;
    }

    const now = Date.now();
    const gap = now - lastKeyAt;
    lastKeyAt = now;

    // Gap too big → start a fresh buffer (rules out human typing as scan)
    if (gap > MAX_INTER_KEY_MS) {
      buffer = "";
    }

    if (key === "Enter") {
      // End-of-scan terminator. Only emit if the burst is long enough
      // AND came in fast enough (the Enter itself must be part of the
      // burst — that's what the gap check above enforces).
      if (buffer.length >= MIN_SCAN_LEN) {
        const code = buffer;
        buffer = "";
        // Defer the dispatch so subscribers see a clean event loop —
        // and so we don't fight whatever element currently has focus
        // (preventing it from also receiving the Enter).
        queueMicrotask(() => {
          window.dispatchEvent(
            new CustomEvent("cashier:scan", { detail: { code, source: "barcode" } })
          );
        });
        // Stop the Enter from also submitting whatever form is focused.
        e.preventDefault();
      }
      return;
    }

    // Only buffer single printable chars. Function keys, arrows etc are
    // ignored so the cashier's keyboard nav still works.
    if (key.length === 1) {
      buffer += key;
    } else {
      // Non-printable key in the middle of a burst — reset the buffer
      // so the half-captured scan can't accidentally fire later.
      buffer = "";
    }
  };

  target.addEventListener("keydown", onKeyDown, true);
  return () => {
    target.removeEventListener("keydown", onKeyDown, true);
    attached = false;
  };
}
