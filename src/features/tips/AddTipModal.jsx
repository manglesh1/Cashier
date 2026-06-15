// AddTipModal — "guest came back to leave (more) gratuity" on an existing
// booking (design §6.7). Records a dedicated tip-only transaction
// (amount=0) via /tips/standalone with source='added_later', so the
// booking total/balance are untouched.
//
// Self-contained: parent renders <AddTipModal booking onClose /> when the
// cashier taps "Add tip". Reuses TipStep for amount + allocation + the
// manager-PIN gate.

import React, { useState } from "react";
import { toast } from "sonner";
import TipStep from "./TipStep";
import { useTipDefaults } from "./useTipDefaults";
import { useStandaloneTipMutation } from "./tipsApi";
import { TIP_ALLOCATIONS } from "./tipMath";
import { moneyFmt, roundMoney } from "../../lib/money.js";
import { getTerminal } from "../../lib/terminal";

const newKey = (bookingId) => {
  const rnd = (typeof crypto !== "undefined" && crypto.randomUUID)
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);
  return `tip-${bookingId || "walkin"}:${rnd}`;
};

// `booking` may be null → a walk-in tip with no sale. With no booking, the
// tip can only go to Me / Tip pool (there's no host), so booking_host is
// hidden and the venue comes from the paired terminal.
export default function AddTipModal({ booking, onClose }) {
  const defaults = useTipDefaults();
  const [standaloneTip, { isLoading }] = useStandaloneTipMutation();
  const bookingId = booking?.bookingId || null;
  const noBooking = !bookingId;
  const allocations = noBooking
    ? TIP_ALLOCATIONS.filter((a) => a.value !== "booking_host")
    : TIP_ALLOCATIONS;
  const initialAllocation = noBooking
    ? "logged_in_staff"
    : (defaults.defaultAllocation || "booking_host");

  const [tip, setTip] = useState({
    amount: 0,
    allocation: initialAllocation,
    selectedPct: null,
    managerOverrideAuditId: null,
  });
  const [methodSel, setMethodSel] = useState("cash"); // 'cash' | 'check'
  // One idempotency key per opened modal so a double-tap can't double-record.
  const [idemKey] = useState(() => newKey(bookingId));
  const [done, setDone] = useState(null);

  // % buttons compute off the order total (or 0 for a walk-in → use Custom).
  const base = roundMoney(Number(booking?.totalAmount ?? booking?.amountPaid ?? 0));
  const tipAmount = roundMoney(tip.amount || 0);

  const submit = async () => {
    if (tipAmount <= 0) { toast.error("Enter a tip amount."); return; }
    try {
      const res = await standaloneTip({
        bookingId: bookingId || undefined,
        // Walk-in tips have no booking → send the till's venue.
        locationId: noBooking ? (getTerminal()?.locationId || undefined) : undefined,
        tipAmount,
        method: methodSel,
        allocation: tip.allocation,
        defaultAllocation: defaults.defaultAllocation,
        managerOverrideAuditId: tip.managerOverrideAuditId || undefined,
        source: "added_later",
        idempotencyKey: idemKey,
      }).unwrap();
      setDone(res?.data || { tipAmount });
      toast.success(`${moneyFmt(tipAmount)} tip recorded`);
    } catch (err) {
      toast.error(err?.data?.message || err?.data?.error || "Could not record tip.");
    }
  };

  return (
    <div role="dialog" aria-modal="true" style={{
      position: "fixed", inset: 0, zIndex: 1200, background: "rgba(26,24,20,0.62)",
      display: "flex", alignItems: "center", justifyContent: "center", padding: 18,
    }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{
        width: "min(440px, 100%)", background: "#F6F1E8",
        border: "2px solid var(--ink-900)", borderRadius: 14,
        boxShadow: "0 20px 70px rgba(0,0,0,0.35)", overflow: "auto", maxHeight: "calc(100vh - 24px)",
      }}>
        <div style={{ padding: "14px 18px", borderBottom: "1.5px solid var(--ink-200)",
          display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontSize: 18, fontWeight: 900, color: "var(--ink-900)" }}>
            {done ? "Tip recorded" : noBooking ? "Take a tip" : "Add tip"}
          </div>
          <button type="button" className="a-btn a-btn--ghost a-btn--sm" onClick={onClose}>Close</button>
        </div>

        {done ? (
          <div style={{ padding: 20, textAlign: "center" }}>
            <div style={{ fontSize: 22, fontWeight: 900, color: "#137A35" }}>
              {moneyFmt(done.tipAmount ?? tipAmount)} tip recorded
            </div>
            <div style={{ fontSize: 13, color: "var(--ink-600)", marginTop: 6 }}>
              {noBooking
                ? "Recorded as a walk-in tip (no booking)."
                : `Added to booking #${booking?.bookingNumber || bookingId}. The booking balance is unchanged.`}
            </div>
            <button type="button" className="a-btn a-btn--primary" onClick={onClose}
              style={{ marginTop: 18, width: "100%", justifyContent: "center" }}>
              Done
            </button>
          </div>
        ) : (
          <div style={{ padding: "14px 18px" }}>
            <div style={{ fontSize: 13, color: "var(--ink-600)", marginBottom: 4 }}>
              {noBooking
                ? "Walk-in tip — no booking"
                : `Booking #${booking?.bookingNumber || bookingId}${base > 0 ? ` · order ${moneyFmt(base)}` : ""}`}
            </div>

            <div style={{ marginTop: 8 }}>
              <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: ".06em",
                textTransform: "uppercase", color: "var(--ink-500)", marginBottom: 6 }}>
                Tendered as
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                {["cash", "check"].map((m) => {
                  const active = methodSel === m;
                  return (
                    <button key={m} type="button" onClick={() => setMethodSel(m)} style={{
                      all: "unset", cursor: "pointer", textAlign: "center", padding: "10px 0",
                      borderRadius: 9, fontWeight: 800, fontSize: 13,
                      border: `1.5px solid ${active ? "var(--ink-900)" : "var(--ink-200)"}`,
                      background: active ? "var(--ink-900)" : "white",
                      color: active ? "white" : "var(--ink-900)",
                    }}>
                      {m === "cash" ? "Cash" : "Check"}
                    </button>
                  );
                })}
              </div>
            </div>

            <TipStep
              base={base}
              bookingId={bookingId}
              defaults={defaults}
              value={tip}
              onChange={setTip}
              allocations={allocations}
            />

            <button type="button" className="a-btn a-btn--primary" onClick={submit}
              disabled={isLoading || tipAmount <= 0}
              style={{ marginTop: 14, width: "100%", justifyContent: "center", minHeight: 48 }}>
              {isLoading ? "Recording…" : `Record ${moneyFmt(tipAmount)} tip`}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
