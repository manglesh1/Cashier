// AddTipModal — record a gratuity as a dedicated tip-only transaction
// (amount=0) via /tips/standalone with source='added_later', so the booking
// total/balance are untouched (design §6.7).
//
// Two entry points share this modal:
//   • BookingDetail "Add tip"  → `booking` prop is set (a specific booking).
//   • Cart "Take a tip"        → `booking` is null. The cashier can record a
//     pure walk-in tip OR search for and ATTACH the paying customer's booking
//     (so the tip can go to that booking's host). Reuses the Refund screen's
//     booking-search pattern.

import React, { useState, useRef } from "react";
import { toast } from "sonner";
import TipStep from "./TipStep";
import { useTipDefaults } from "./useTipDefaults";
import { useStandaloneTipMutation } from "./tipsApi";
import { TIP_ALLOCATIONS } from "./tipMath";
import { moneyFmt, roundMoney } from "../../lib/money.js";
import { getTerminal } from "../../lib/terminal";
import { useDebounceSearch } from "../../hooks/useDebounceSearch";
import { useGetAllBookingQuery } from "../../features/bookings/bookingApi";
import TerminalPaymentModal from "../../pages/cashier/TerminalPaymentModal";

const newKey = (bookingId) => {
  const rnd = (typeof crypto !== "undefined" && crypto.randomUUID)
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);
  return `tip-${bookingId || "walkin"}:${rnd}`;
};

const nameOf = (b) => b?.bookingName || b?.guest?.guestName || b?.guestName || "Guest";
const numberOf = (b) => b?.bookingNumber || `#${b?.bookingId}`;
const totalOf = (b) => roundMoney(Number(b?.totalAmount ?? b?.amountPaid ?? 0) || 0);

// `booking` may be null → the cart "Take a tip" flow. There the cashier can
// attach a booking (search below) or leave it as a walk-in (Me / Tip pool).
export default function AddTipModal({ booking, onClose }) {
  const defaults = useTipDefaults();
  const [standaloneTip, { isLoading }] = useStandaloneTipMutation();

  // A booking attached via search (cart flow only). The effective booking is
  // the prop (BookingDetail) or the picked one (cart search).
  const [picked, setPicked] = useState(null);
  const showSearch = !booking; // booking search only when none was passed in
  const activeBooking = booking || picked;
  const bookingId = activeBooking?.bookingId || null;
  const noBooking = !bookingId;

  const allocations = noBooking
    ? TIP_ALLOCATIONS.filter((a) => a.value !== "booking_host")
    : TIP_ALLOCATIONS;

  const [tip, setTip] = useState({
    amount: 0,
    allocation: booking ? (defaults.defaultAllocation || "booking_host") : "logged_in_staff",
    selectedPct: null,
    managerOverrideAuditId: null,
  });
  const [methodSel, setMethodSel] = useState("cash"); // 'cash' | 'check' | 'card'
  const [idemKey] = useState(() => newKey(booking?.bookingId || null));
  const [done, setDone] = useState(null);

  // Card tips charge on the reader (a tip-only terminal sale). Only offered
  // when a terminal is paired. The reader collects the money; the backend tip
  // finalizer records the gratuity on capture.
  const terminal = getTerminal();
  const canCard = !!(terminal && terminal.deviceId);
  const methods = canCard ? ["cash", "check", "card"] : ["cash", "check"];
  const [cardOpen, setCardOpen] = useState(false);
  const cardApprovedRef = useRef(false);

  // ── Booking search (cart flow) ───────────────────────────────────────
  const { inputValue, searchTerm, setDebouncedSearch } = useDebounceSearch(350);
  const trimmed = (searchTerm || "").trim();
  const { data: searchData, isFetching: searching } = useGetAllBookingQuery(
    { search: trimmed, limit: 8, page: 1 },
    { skip: !showSearch || !!picked || trimmed.length < 2 }
  );
  const results = searchData?.data || [];

  const attachBooking = (b) => {
    setPicked(b);
    // A booking gives us a host → default the tip to the configured allocation.
    setTip((t) => ({ ...t, allocation: defaults.defaultAllocation || "booking_host", managerOverrideAuditId: null }));
    setDebouncedSearch("");
  };
  const detachBooking = () => {
    setPicked(null);
    setTip((t) => ({ ...t, allocation: "logged_in_staff", managerOverrideAuditId: null }));
  };

  // % buttons compute off the attached order total (0 for a pure walk-in).
  const base = totalOf(activeBooking);
  const tipAmount = roundMoney(tip.amount || 0);

  const submit = async () => {
    if (tipAmount <= 0) { toast.error("Enter a tip amount."); return; }
    try {
      const res = await standaloneTip({
        bookingId: bookingId || undefined,
        // Walk-in tips have no booking → send the till's location.
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

  // Card tip → charge the tip amount on the reader (tip-only terminal sale).
  const openCard = () => {
    if (tipAmount <= 0) { toast.error("Enter a tip amount."); return; }
    cardApprovedRef.current = false;
    setCardOpen(true);
  };

  const inputStyle = {
    width: "100%", boxSizing: "border-box", fontSize: 14, padding: "10px 12px",
    border: "1.5px solid var(--ink-200)", borderRadius: 8, fontWeight: 600, background: "white",
  };

  return (
    <>
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
            {done ? "Tip recorded" : showSearch ? "Take a tip" : "Add tip"}
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
                : `Added to booking ${numberOf(activeBooking)}. The booking balance is unchanged.`}
            </div>
            <button type="button" className="a-btn a-btn--primary" onClick={onClose}
              style={{ marginTop: 18, width: "100%", justifyContent: "center" }}>
              Done
            </button>
          </div>
        ) : (
          <div style={{ padding: "14px 18px" }}>
            {/* Booking attach — cart flow only (optional) */}
            {showSearch && (
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: ".06em",
                  textTransform: "uppercase", color: "var(--ink-500)", marginBottom: 6 }}>
                  Booking (optional)
                </div>
                {picked ? (
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between",
                    gap: 8, padding: "10px 12px", borderRadius: 9, background: "white",
                    border: "1.5px solid var(--ink-900)" }}>
                    <span style={{ fontSize: 13, fontWeight: 800, color: "var(--ink-900)" }}>
                      {numberOf(picked)} · {nameOf(picked)}
                      {base > 0 ? <span style={{ color: "var(--ink-500)", fontWeight: 600 }}> · {moneyFmt(base)}</span> : null}
                    </span>
                    <button type="button" onClick={detachBooking}
                      style={{ all: "unset", cursor: "pointer", fontSize: 12, fontWeight: 800, color: "var(--aero-orange-600, #C2410C)" }}>
                      Walk-in instead
                    </button>
                  </div>
                ) : (
                  <>
                    <input
                      value={inputValue}
                      onChange={(e) => setDebouncedSearch(e.target.value)}
                      placeholder="Search booking # / guest name…"
                      autoComplete="off"
                      style={inputStyle}
                    />
                    {trimmed.length >= 2 && (
                      <div style={{ marginTop: 6, border: "1.5px solid var(--ink-200)", borderRadius: 8,
                        background: "white", overflow: "hidden", maxHeight: 188, overflowY: "auto" }}>
                        {searching ? (
                          <div style={{ padding: "10px 12px", fontSize: 13, color: "var(--ink-500)" }}>Searching…</div>
                        ) : results.length === 0 ? (
                          <div style={{ padding: "10px 12px", fontSize: 13, color: "var(--ink-500)" }}>No matching bookings.</div>
                        ) : (
                          results.map((b, i) => (
                            <button key={b.bookingId} type="button" onClick={() => attachBooking(b)}
                              style={{ all: "unset", cursor: "pointer", display: "flex", width: "100%",
                                boxSizing: "border-box", alignItems: "center", justifyContent: "space-between", gap: 8,
                                padding: "9px 12px", borderTop: i ? "1px solid var(--ink-100, #eee)" : "none" }}>
                              <span style={{ fontSize: 13, fontWeight: 800, color: "var(--ink-900)" }}>
                                {numberOf(b)} <span style={{ color: "var(--ink-600)", fontWeight: 600 }}>· {nameOf(b)}</span>
                              </span>
                              <span style={{ fontSize: 12, fontWeight: 700, color: "var(--ink-500)" }}>{moneyFmt(totalOf(b))}</span>
                            </button>
                          ))
                        )}
                      </div>
                    )}
                    <div style={{ fontSize: 11, color: "var(--ink-500)", marginTop: 5 }}>
                      Attach a booking to tip its host, or leave blank for a walk-in tip.
                    </div>
                  </>
                )}
              </div>
            )}

            <div style={{ fontSize: 13, color: "var(--ink-600)", marginBottom: 4 }}>
              {noBooking
                ? "Walk-in tip — no booking"
                : `Booking ${numberOf(activeBooking)}${base > 0 ? ` · order ${moneyFmt(base)}` : ""}`}
            </div>

            <div style={{ marginTop: 8 }}>
              <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: ".06em",
                textTransform: "uppercase", color: "var(--ink-500)", marginBottom: 6 }}>
                Tendered as
              </div>
              <div style={{ display: "grid", gridTemplateColumns: `repeat(${methods.length}, 1fr)`, gap: 8 }}>
                {methods.map((m) => {
                  const active = methodSel === m;
                  return (
                    <button key={m} type="button" onClick={() => setMethodSel(m)} style={{
                      all: "unset", cursor: "pointer", textAlign: "center", padding: "10px 0",
                      borderRadius: 9, fontWeight: 800, fontSize: 13,
                      border: `1.5px solid ${active ? "var(--ink-900)" : "var(--ink-200)"}`,
                      background: active ? "var(--ink-900)" : "white",
                      color: active ? "white" : "var(--ink-900)",
                    }}>
                      {m === "cash" ? "Cash" : m === "check" ? "Check" : "Card"}
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

            <button type="button" className="a-btn a-btn--primary"
              onClick={methodSel === "card" ? openCard : submit}
              disabled={isLoading || tipAmount <= 0}
              style={{ marginTop: 14, width: "100%", justifyContent: "center", minHeight: 48 }}>
              {isLoading ? "Recording…"
                : methodSel === "card" ? `Charge ${moneyFmt(tipAmount)} tip on reader`
                : `Record ${moneyFmt(tipAmount)} tip`}
            </button>
          </div>
        )}
      </div>
    </div>

    {cardOpen && (
      <TerminalPaymentModal
        open
        amount={tipAmount}
        locationId={terminal?.locationId}
        posDeviceId={terminal?.deviceId}
        sourceType="tip"
        sourceId={bookingId || null}
        tipOnly={{
          allocation: tip.allocation,
          defaultAllocation: defaults.defaultAllocation,
          bookingId: bookingId || null,
          managerOverrideAuditId: tip.managerOverrideAuditId || undefined,
        }}
        onApproved={() => { cardApprovedRef.current = true; }}
        onClose={() => {
          setCardOpen(false);
          if (cardApprovedRef.current) {
            cardApprovedRef.current = false;
            setDone({ tipAmount });
            toast.success(`${moneyFmt(tipAmount)} card tip charged`);
          }
        }}
      />
    )}
    </>
  );
}
