// Card-terminal payment modal (Stripe Terminal, server-driven).
//
// Drives the backend terminal flow and shows live status:
//   start  → "Waiting for card…"   (reader prompts the customer)
//   poll   → every 2.5s on /payments/terminal/:id/status
//   done   → "Approved ✅" / "Declined ❌"
//
// On approval the backend has already created + captured the
// PaymentTransaction and the booking finalizer recomputed the balance —
// so the caller's onApproved just refreshes/closes; it must NOT also
// record a payment (that would double-charge).
//
// Reader: not passed — the backend resolves the location's configured reader
// (Payments → Card terminals). Currency optional: pass the location's Stripe
// account currency (a US account needs USD even for a CAD location).

import React, { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Icon } from "./Icon";
import { moneyFmt } from "../../lib/money";
import {
  useStartTerminalPaymentMutation,
  useLazyGetTerminalStatusQuery,
  useCancelTerminalPaymentMutation,
} from "../../features/payments/terminalApi";
import { useTipDefaults } from "../../features/tips/useTipDefaults";
import { useCheckTipOverrideMutation } from "../../features/tips/tipsApi";
import { TIP_ALLOCATIONS } from "../../features/tips/tipMath";
import ManagerOverridePrompt from "../../components/ManagerOverridePrompt";

const POLL_MS = 2500;
const TIMEOUT_MS = 90000; // give up waiting for the tap after 90s

function newIdempotencyKey(sourceType, sourceId) {
  const rnd = Math.random().toString(36).slice(2, 10);
  return `cashier-terminal:${sourceType || "cart"}:${sourceId || "x"}:${Date.now()}:${rnd}`;
}

export default function TerminalPaymentModal({
  open,
  onClose,
  amount,
  locationId,
  currency, // optional — Stripe account currency
  posDeviceId, // this till — backend resolves its DEFAULT card reader
  readerId, // optional legacy override; backend prefers the till's default reader
  sourceType = "booking",
  sourceId = null,
  // Optional on-glass tip context. When present (e.g. { allocation,
  // defaultAllocation, recordedByUserId, managerOverrideAuditId }), the
  // backend creates a 'held' tip placeholder and the pin-pad prompts the
  // guest; the capture write-back records the tip against the chosen
  // recipient. The guest enters the amount on the device, so we don't
  // send one here.
  tip = null,
  // Optional TIP-ONLY card charge (a standalone gratuity, no sale). When set
  // (e.g. { allocation, defaultAllocation, bookingId?, managerOverrideAuditId? }),
  // the whole `amount` IS the tip: we skip the on-glass step and send
  // sourceType:'tip' + metadata.tip so the backend tip finalizer records it on
  // capture. Never affects a booking balance.
  tipOnly = null,
  onApproved,
}) {
  // tip | starting | waiting | approved | declined | error | cancelled
  const [phase, setPhase] = useState("starting");
  const [transactionId, setTransactionId] = useState(null);
  const [message, setMessage] = useState("");
  const startedRef = useRef(false);
  const pollRef = useRef(null);
  const timeoutRef = useRef(null);
  // Guards against two async paths (a late poll + the timeout handler) both
  // resolving the payment and firing onApproved twice.
  const doneRef = useRef(false);

  const [startPayment] = useStartTerminalPaymentMutation();
  const [triggerStatus] = useLazyGetTerminalStatusQuery();
  const [cancelPayment] = useCancelTerminalPaymentMutation();

  // On-glass tip. When the location enables tipping AND the caller didn't
  // already pass a fixed `tip`, we show a quick "who gets the tip" step
  // before starting the sale; the guest enters the AMOUNT on the reader.
  const tipDefaults = useTipDefaults();
  const [checkTipOverride] = useCheckTipOverrideMutation();
  const [tipAllocation, setTipAllocation] = useState(tipDefaults.defaultAllocation || "booking_host");
  const [tipManagerAuditId, setTipManagerAuditId] = useState(null);
  const [tipManagerOpen, setTipManagerOpen] = useState(false);
  const [pendingAlloc, setPendingAlloc] = useState(null);
  // A tip-only charge never shows the on-glass "who gets it" step (the cashier
  // already chose the recipient + amount in the Take-a-tip modal).
  const collectTip = !tipOnly && !!tipDefaults.enabled && !(tip && tip.allocation);

  function clearTimers() {
    if (pollRef.current) clearInterval(pollRef.current);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    pollRef.current = null;
    timeoutRef.current = null;
  }

  // Start the terminal sale. `tipContext` is the on-glass tip allocation
  // (no amount — the guest enters it on the reader), or null for no tip.
  const beginStart = async (tipContext) => {
    if (startedRef.current) return;
    startedRef.current = true;
    setPhase("starting");
    try {
      const res = await startPayment({
        locationId,
        amount: Number(amount),
        currency: currency || undefined,
        posDeviceId: posDeviceId || undefined,
        readerId: readerId || undefined,
        sourceType,
        sourceId,
        // On-glass tip: forwarded only when an allocation was chosen
        // (either passed by the caller or collected in the tip step).
        ...(tipContext && tipContext.allocation ? { tip: tipContext } : {}),
        // Tip-only card charge: the whole amount is the gratuity. Carries the
        // recipient on metadata.tip; the backend tip finalizer records it.
        ...(tipOnly ? { metadata: { tip: tipOnly } } : {}),
        idempotencyKey: newIdempotencyKey(sourceType, sourceId),
      }).unwrap();
      setTransactionId(res.transaction?.transactionId || res.transactionId);
      setPhase("waiting");
      setMessage(res.instructions || "Ask the customer to tap their card on the reader.");
    } catch (err) {
      setPhase("error");
      setMessage(err?.data?.message || err?.data?.error || err?.error || "Could not start the terminal payment.");
    }
  };

  // When the modal opens: collect the tip allocation first if tipping is
  // on (and the caller didn't pre-set one); otherwise start immediately.
  useEffect(() => {
    if (!open) {
      // reset for next open
      startedRef.current = false;
      doneRef.current = false;
      clearTimers();
      setPhase("starting");
      setTransactionId(null);
      setMessage("");
      setTipAllocation(tipDefaults.defaultAllocation || "booking_host");
      setTipManagerAuditId(null);
      return;
    }
    if (startedRef.current || phase === "tip") return;
    if (collectTip) {
      setPhase("tip");
    } else {
      beginStart(tip && tip.allocation ? tip : null);
    }
    return () => clearTimers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Tip-step allocation change — manager-PIN gate for self-assigning a
  // host tip (§5.1), mirroring TipStep.
  const selectTipAllocation = async (next) => {
    if (next === tipAllocation) return;
    try {
      const r = await checkTipOverride({
        defaultAllocation: tipDefaults.defaultAllocation,
        toAllocation: next,
        bookingId: sourceType === "booking" ? sourceId : null,
      }).unwrap();
      if (r?.data?.requiresManagerCode) {
        setPendingAlloc(next);
        setTipManagerOpen(true);
        return;
      }
      setTipAllocation(next);
      setTipManagerAuditId(null);
    } catch (err) {
      toast.error(err?.data?.message || "Could not validate tip allocation.");
    }
  };

  const startWithTip = () =>
    beginStart({
      allocation: tipAllocation,
      defaultAllocation: tipDefaults.defaultAllocation,
      managerOverrideAuditId: tipManagerAuditId || undefined,
    });
  const startWithoutTip = () => beginStart(null);

  // Poll for status while waiting.
  useEffect(() => {
    if (phase !== "waiting" || !transactionId) return;
    clearTimers();
    let errorStreak = 0;

    // Resolve the modal exactly once. Both a late poll and the timeout handler
    // can race; doneRef makes the first one win and onApproved fire only once.
    const resolve = (next, msg, payload) => {
      if (doneRef.current) return;
      doneRef.current = true;
      clearTimers();
      setPhase(next);
      if (msg) setMessage(msg);
      if (next === "approved") onApproved?.(payload);
    };

    const readStatus = async () => {
      const r = await triggerStatus(transactionId).unwrap();
      return { status: r.transaction?.status || r.status, r };
    };

    const poll = async () => {
      try {
        const { status, r } = await readStatus();
        errorStreak = 0;
        if (status === "captured") {
          resolve("approved", "Payment approved.", r);
        } else if (status === "cancelled") {
          resolve("cancelled", r.reason || "Payment was cancelled.", r);
        } else if (["failed", "voided"].includes(status)) {
          resolve("declined", r.error?.message || "The card was declined.");
        }
        // else still processing — keep polling
      } catch {
        errorStreak += 1;
        // Don't kill the payment on a transient blip, but stop pretending all
        // is well after several consecutive failures.
        if (errorStreak >= 5 && !doneRef.current) {
          setMessage("Trouble reaching the reader — still trying…");
        }
      }
    };

    // Timeout: STOP the reader so a late tap can't orphan-charge, then do a
    // FINAL status check — if the customer tapped just before we gave up, the
    // payment may already be captured and we must honor it (money moved).
    const onTimeout = async () => {
      clearTimers();
      if (doneRef.current) return;
      try {
        await cancelPayment({ transactionId, reason: "timed out waiting for card" }).unwrap();
      } catch {
        /* may already be captured/cancelled — the final check below decides */
      }
      try {
        const { status, r } = await readStatus();
        if (status === "captured") return resolve("approved", "Payment approved.", r);
        if (status === "cancelled") {
          return resolve("cancelled", r.reason || "Payment was cancelled.", r);
        }
        if (["failed", "voided"].includes(status)) {
          return resolve("declined", r.error?.message || "The card was declined.");
        }
      } catch {
        /* fall through to the error state */
      }
      if (doneRef.current) return;
      doneRef.current = true;
      setPhase("error");
      setMessage("Timed out waiting for the card — the payment was cancelled. You can start it again.");
    };

    pollRef.current = setInterval(poll, POLL_MS);
    timeoutRef.current = setTimeout(onTimeout, TIMEOUT_MS);
    poll(); // immediate first check

    return () => clearTimers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, transactionId]);

  async function handleCancel() {
    clearTimers();
    doneRef.current = true; // stop any in-flight poll from also resolving
    if (transactionId && (phase === "waiting" || phase === "error")) {
      try {
        await cancelPayment({ transactionId, reason: "cashier cancelled" }).unwrap();
      } catch {
        /* best-effort */
      }
    }
    setPhase("cancelled");
    onClose?.();
  }

  if (!open) return null;

  const tone =
    phase === "approved" ? "#16A34A" :
    phase === "declined" || phase === "error" ? "#DC2626" :
    "var(--aero-yellow-300, #FF8A00)";
  const heading =
    phase === "starting" ? "Starting…" :
    phase === "waiting" ? "Waiting for card" :
    phase === "approved" ? "Approved" :
    phase === "declined" ? "Declined" :
    phase === "cancelled" ? "Cancelled" :
    "Couldn't complete";
  const icon =
    phase === "approved" ? "check" :
    phase === "declined" || phase === "error" ? "x" :
    "credit-card";

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: "fixed", inset: 0, zIndex: 1300,
        background: "rgba(8,12,20,0.55)", display: "flex",
        alignItems: "center", justifyContent: "center", padding: 16,
      }}
      onClick={(e) => { if (e.target === e.currentTarget && phase !== "waiting" && phase !== "starting") onClose?.(); }}
    >
      <div style={{ width: 380, maxWidth: "100%", background: "white", borderRadius: 16, padding: 24, textAlign: "center", boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}>
        <div style={{ fontSize: 13, color: "var(--ink-500, #64748B)", fontWeight: 700, textTransform: "uppercase", letterSpacing: ".04em" }}>
          Card terminal
        </div>
        <div style={{ fontSize: 30, fontWeight: 900, margin: "4px 0 16px", fontFamily: "var(--font-display)" }}>
          {moneyFmt(amount)}{currency ? ` ${String(currency).toUpperCase()}` : ""}
        </div>

        {phase === "tip" ? (
          // ── Tip allocation step (the guest enters the amount on the reader) ──
          <div style={{ textAlign: "left" }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: "var(--ink-700,#334155)", marginBottom: 8, textAlign: "center" }}>
              Add a tip on the card reader?
            </div>
            <div style={{ fontSize: 12, color: "var(--ink-500,#64748B)", marginBottom: 12, textAlign: "center" }}>
              The guest enters the tip amount on the device. Choose who it goes to:
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 16 }}>
              {TIP_ALLOCATIONS.map((opt) => (
                <label key={opt.value} style={{
                  display: "flex", alignItems: "center", gap: 8, fontSize: 14,
                  cursor: "pointer", padding: "8px 10px", borderRadius: 10,
                  border: `1.5px solid ${tipAllocation === opt.value ? "#16A34A" : "var(--ink-200,#e2e8f0)"}`,
                  background: tipAllocation === opt.value ? "#16A34A14" : "white",
                }}>
                  <input type="radio" name="terminalTipAllocation"
                    checked={tipAllocation === opt.value}
                    onChange={() => selectTipAllocation(opt.value)} />
                  {opt.label}
                </label>
              ))}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button type="button" className="a-btn"
                onClick={startWithoutTip}
                style={{ flex: 1, justifyContent: "center", minHeight: 48, border: "1px solid var(--ink-200,#e2e8f0)", background: "white" }}>
                No tip
              </button>
              <button type="button" className="a-btn a-btn--primary"
                onClick={startWithTip}
                style={{ flex: 1, justifyContent: "center", minHeight: 48 }}>
                <Icon name="credit-card" size={16} /> Start
              </button>
            </div>
          </div>
        ) : (
        <>
        <div style={{
          width: 76, height: 76, borderRadius: "50%", margin: "0 auto 14px",
          display: "flex", alignItems: "center", justifyContent: "center",
          background: `${tone}1f`, color: tone,
        }}>
          {(phase === "starting" || phase === "waiting") ? (
            <span className="terminal-spin" style={{
              width: 34, height: 34, borderRadius: "50%",
              border: `3px solid ${tone}40`, borderTopColor: tone,
              display: "inline-block", animation: "terminalspin 0.9s linear infinite",
            }} />
          ) : (
            <Icon name={icon} size={36} />
          )}
        </div>

        <h2 style={{ margin: "0 0 6px", fontSize: 20, fontWeight: 800, color: tone, fontFamily: "var(--font-display)" }}>
          {heading}
        </h2>
        <p style={{ margin: "0 0 18px", fontSize: 14, color: "var(--ink-600, #475569)", minHeight: 40 }}>
          {message}
        </p>

        <div style={{ display: "flex", gap: 8 }}>
          {phase === "approved" ? (
            <button type="button" className="a-btn a-btn--primary" onClick={() => onClose?.()}
              style={{ flex: 1, justifyContent: "center", minHeight: 48 }}>
              <Icon name="check" size={16} /> Done
            </button>
          ) : (
            <button type="button" className="a-btn"
              onClick={handleCancel}
              style={{ flex: 1, justifyContent: "center", minHeight: 48, border: "1px solid var(--ink-200,#e2e8f0)", background: "white" }}>
              {phase === "waiting" || phase === "starting" ? "Cancel" : "Close"}
            </button>
          )}
        </div>
        </>
        )}

        <ManagerOverridePrompt
          open={tipManagerOpen}
          title="Manager approval — reassign host tip"
          description="Sending the booking host's tip to yourself needs a manager PIN."
          action="tip_allocation_override"
          targetType="booking"
          targetId={sourceId || "sale"}
          payload={{ from: tipDefaults.defaultAllocation, to: pendingAlloc }}
          defaultReason="Cashier self-assigned a host tip (card)"
          onCancel={() => { setTipManagerOpen(false); setPendingAlloc(null); }}
          onApprove={(audit) => {
            setTipAllocation(pendingAlloc);
            setTipManagerAuditId(audit?.auditId || null);
            setTipManagerOpen(false);
            setPendingAlloc(null);
          }}
        />
        {/* Card-present approval happens ON THE DEVICE (the Terminal Simulator
            app or a real reader) — the cashier just waits for the result. No
            in-cashier "simulate tap" shortcut. */}
      </div>
      <style>{`@keyframes terminalspin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
