// Modal shown while a card-on-terminal sale is in flight.
// Opened by CashierPaymentDialog when recordPayment({method:'card'})
// returns status='pending'.
//
// Polls /api/payments/terminal/:txnId/status every 1s via RTK Query
// until the sale lands in a final state. Cashier can hit Cancel to
// abort -- the cancel race window (cardholder taps at the same time)
// is handled by the backend and surfaces as captured here.

import React, { useEffect, useState } from "react";
import { Icon } from "./Icon";
import {
  useGetTerminalPaymentStatusQuery,
  useCancelTerminalPaymentMutation,
} from "../../features/bookings/bookingApi";
import { moneyFmt } from "../../lib/money";

const FINAL_STATES = new Set([
  "captured",
  "failed",
  "cancelled",
  "refunded",
  "partially_refunded",
]);

const POLL_MS = 1000;
const MAX_SECONDS = 120; // hard cap so we never poll forever

export default function TerminalProgressModal({
  transactionId,
  amount,
  bookingId,
  instructions,
  onComplete,   // (resultData) => void
  onCancelled,  // (reason) => void
  onFailed,     // (errorMessage) => void
}) {
  const [secondsElapsed, setSecondsElapsed] = useState(0);
  const [cancelling, setCancelling] = useState(false);
  const [dots, setDots] = useState(".");

  const { data, error } = useGetTerminalPaymentStatusQuery(transactionId, {
    pollingInterval: POLL_MS,
    skip: !transactionId,
  });
  const [cancelTerminalPayment] = useCancelTerminalPaymentMutation();

  // Tick the elapsed counter + the "..." animation independently of
  // poll responses.
  useEffect(() => {
    const tick = setInterval(() => {
      setSecondsElapsed((s) => s + 1);
      setDots((d) => (d.length >= 3 ? "." : d + "."));
    }, 1000);
    return () => clearInterval(tick);
  }, []);

  // React to status changes.
  useEffect(() => {
    if (!data) return;
    const status = data.status || data?.data?.status;
    if (!status) return;
    if (!FINAL_STATES.has(status)) return;
    if (status === "captured") {
      onComplete?.(data);
    } else if (status === "cancelled") {
      onCancelled?.(data.reason || "cancelled");
    } else {
      onFailed?.(data.error || data.message || "Card payment failed");
    }
  }, [data, onComplete, onCancelled, onFailed]);

  // Hard timeout safety net.
  useEffect(() => {
    if (secondsElapsed >= MAX_SECONDS) {
      onFailed?.("Card payment timed out after " + MAX_SECONDS + " seconds.");
    }
  }, [secondsElapsed, onFailed]);

  const handleCancel = async () => {
    if (cancelling) return;
    setCancelling(true);
    try {
      const result = await cancelTerminalPayment({
        transactionId,
        bookingId,
        reason: "cashier_cancel",
      }).unwrap();
      // Handle race: backend reports status=captured if customer tapped
      // before our cancel landed (cancelRaced=true). Honour it.
      if (result?.status === "captured") {
        onComplete?.(result);
      } else {
        onCancelled?.("cashier_cancel");
      }
    } catch (err) {
      // Cancel failed -- back to polling. The cashier can try again or
      // wait for the natural final state.
      console.error("Cancel failed:", err);
      setCancelling(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="w-full max-w-md rounded-2xl bg-white p-8 text-center shadow-2xl">
        <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-orange-100">
          <Icon name="credit-card" className="h-8 w-8 text-orange-600" />
        </div>

        <h2 className="text-2xl font-semibold text-gray-900">
          {moneyFmt(amount)}
        </h2>
        <p className="mt-2 text-sm text-gray-600">
          {instructions || "Hand the pin-pad to the customer"}
        </p>

        <div className="mt-6 text-lg font-medium text-orange-600 tabular-nums">
          Waiting for card{dots}
        </div>
        <div className="mt-1 text-xs text-gray-400 tabular-nums">
          {secondsElapsed}s elapsed
        </div>

        {error && (
          <div className="mt-4 rounded-lg bg-red-50 p-3 text-xs text-red-600">
            Polling error -- retrying. The sale may still complete on the terminal.
          </div>
        )}

        <button
          type="button"
          onClick={handleCancel}
          disabled={cancelling}
          className="mt-8 w-full rounded-lg bg-gray-100 px-4 py-3 text-sm font-medium text-gray-700 hover:bg-gray-200 disabled:opacity-50"
        >
          {cancelling ? "Cancelling..." : "Cancel"}
        </button>

        <p className="mt-3 text-[10px] text-gray-400">
          Transaction #{transactionId}
        </p>
      </div>
    </div>
  );
}
