// Kiosk hardware bridge. The POS web app talks to physical peripherals
// (cash drawer, receipt printer, barcode scanner) through `window` custom
// events so the same code runs in:
//
//   • Electron / WebView 2  — agent listens via preload script
//   • Bare browser dev      — no agent, fall-back behaviour kicks in
//   • Future native wrapper — same event names, native ack
//
// Every request → ack round-trip uses a `requestId` so multiple in-flight
// requests don't get mis-attributed. The ack listener is one-shot per
// request and is torn down on both success and timeout.

import { toast } from "sonner";

const ACK_TIMEOUT_MS = 2000;

function newRequestId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// Generic "fire event → wait for ack → fallback on timeout" helper.
// Returns a promise that resolves with { acked, requestId }.
function dispatchWithAck({ requestEvent, ackEvent, payload, onTimeout, label }) {
  return new Promise((resolve) => {
    let timer = null;
    const cleanup = () => {
      if (timer) window.clearTimeout(timer);
      window.removeEventListener(ackEvent, onAck);
    };
    const onAck = (e) => {
      const ackId = e?.detail?.requestId;
      // Accept an ack with our requestId, or no requestId at all (legacy
      // hardware agents may not echo it back).
      if (ackId && ackId !== payload.requestId) return;
      cleanup();
      resolve({ acked: true, requestId: payload.requestId });
    };
    window.addEventListener(ackEvent, onAck);
    timer = window.setTimeout(() => {
      cleanup();
      if (onTimeout) {
        try {
          onTimeout();
        } catch (err) {
          console.warn(`hardware ${label} fallback threw`, err);
        }
      }
      resolve({ acked: false, requestId: payload.requestId });
    }, ACK_TIMEOUT_MS);
    window.dispatchEvent(new CustomEvent(requestEvent, { detail: payload }));
  });
}

// ── Cash drawer ─────────────────────────────────────────────────────
// Agent listens for `cashier:open-cash-drawer` and acks via
// `cashier:cash-drawer-opened`. If no ack within 2s the cashier sees a
// warning toast so they verify the drawer manually.
export function openCashDrawer({ bookingId, terminal }) {
  const payload = {
    requestId: newRequestId("dr"),
    bookingId: bookingId || null,
    terminalDeviceId: terminal?.deviceId || null,
    terminalName: terminal?.deviceName || terminal?.name || null,
    openedAt: new Date().toISOString(),
  };
  try {
    localStorage.setItem("cashier:lastDrawerOpen", JSON.stringify(payload));
  } catch {
    /* best-effort */
  }
  return dispatchWithAck({
    requestEvent: "cashier:open-cash-drawer",
    ackEvent: "cashier:cash-drawer-opened",
    payload,
    label: "cash drawer",
    onTimeout: () => {
      toast.warning(
        "Cash drawer did not respond. Open it manually and verify the till before continuing."
      );
    },
  });
}

// ── Receipt printer ────────────────────────────────────────────────
// Agent listens for `cashier:print-receipt` and acks via
// `cashier:receipt-printed`. When a thermal printer agent is connected it
// acks within 2s and prints silently. With NO agent we deliberately do NOT
// fall back to the OS print dialog (window.print) — on a kiosk that pops a
// confusing "Print to PDF" sheet. Instead we tell the cashier to use the
// Email receipt option.
export function printReceipt({ bookingId, bookingNumber, terminal, kind = "receipt" }) {
  const payload = {
    requestId: newRequestId("pr"),
    kind, // "receipt" | "void" | "refund" | ...
    bookingId: bookingId || null,
    bookingNumber: bookingNumber || null,
    terminalDeviceId: terminal?.deviceId || null,
    terminalName: terminal?.deviceName || terminal?.name || null,
    requestedAt: new Date().toISOString(),
  };
  return dispatchWithAck({
    requestEvent: "cashier:print-receipt",
    ackEvent: "cashier:receipt-printed",
    payload,
    label: "printer",
    onTimeout: () => {
      toast.error("No printer connected — use Email receipt.");
    },
  });
}
