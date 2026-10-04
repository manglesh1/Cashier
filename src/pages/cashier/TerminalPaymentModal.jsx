// Card-terminal payment modal (Nuvei or Stripe, server-driven).
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
// New attempts use the Admin default or an explicit one-sale override. Recovery reuses its saved
// reader and request. Currency must match the sale; unsupported
// account currencies are rejected rather than silently converted.

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
import TerminalReaderPicker from "./TerminalReaderPicker";
import { attemptStorageKey, readAttempt, terminalOutcome } from "../../features/payments/terminalAttempt";

const POLL_MS = 2500;
const TIMEOUT_MS = 90000; // request cancellation, then reconcile until confirmed

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
  readerId, // explicit one-sale override; otherwise fetch the Admin default
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
  // reader | tip | starting | waiting | approved | declined | error | cancelled
  const [phase, setPhase] = useState("reader");
  const [selectedReader, setSelectedReader] = useState(null);
  const [autoUseDefault, setAutoUseDefault] = useState(true);
  const [transactionId, setTransactionId] = useState(null);
  const [message, setMessage] = useState("");
  const startedRef = useRef(false);
  const pollRef = useRef(null);
  const timeoutRef = useRef(null);
  // Guards against two async paths (a late poll + the timeout handler) both
  // resolving the payment and firing onApproved twice.
  const doneRef = useRef(false);
  const attemptRef = useRef(null);
  const activeRef = useRef(true);
  const [cancelling, setCancelling] = useState(false);
  const storageKey = attemptStorageKey({ locationId, sourceType, sourceId });
  useEffect(() => { activeRef.current = true; return () => { activeRef.current = false; }; }, []);

  const forgetAttempt = () => { sessionStorage.removeItem(storageKey); attemptRef.current = null; };
  const acceptResult = (result) => {
    const outcome = terminalOutcome(result);
    if (outcome === "waiting") return false;
    if (doneRef.current) return true;
    doneRef.current = true;
    clearTimers();
    if (outcome !== "review") forgetAttempt();
    setPhase(outcome === "review" ? "error" : outcome);
    setMessage(outcome === "approved" ? "Payment approved." : outcome === "declined"
      ? "Payment was declined. The order is saved; you can retry payment."
      : outcome === "review" ? "This payment has been refunded. Review the order before taking payment." : "Cancellation confirmed. You can retry payment.");
    if (outcome === "approved") onApproved?.(result);
    return true;
  };

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
    if (pollRef.current) clearTimeout(pollRef.current);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    pollRef.current = null;
    timeoutRef.current = null;
  }

  // Start the terminal sale. `tipContext` is the on-glass tip allocation
  // (no amount — the guest enters it on the reader), or null for no tip.
  const beginStart = async (tipContext, terminalId = selectedReader?.terminalId, readerName = selectedReader?.displayName) => {
    if (startedRef.current) return;
    startedRef.current = true;
    setPhase("starting");
    try {
      const saved = attemptRef.current || readAttempt(sessionStorage, storageKey);
      const request = saved?.request || {
        locationId,
        amount: Number(amount),
        currency: currency || undefined,
        posDeviceId: posDeviceId || undefined,
        terminalId,
        sourceType,
        sourceId,
        // On-glass tip: forwarded only when an allocation was chosen
        // (either passed by the caller or collected in the tip step).
        ...(tipContext && tipContext.allocation ? { tip: tipContext } : {}),
        // Tip-only card charge: the whole amount is the gratuity. Carries the
        // recipient on metadata.tip; the backend tip finalizer records it.
        ...(tipOnly ? { metadata: { tip: tipOnly } } : {}),
        idempotencyKey: newIdempotencyKey(sourceType, sourceId),
      };
      attemptRef.current = saved || { request, readerName };
      sessionStorage.setItem(storageKey, JSON.stringify(attemptRef.current));
      const res = saved?.transactionId
        ? await triggerStatus(saved.transactionId).unwrap()
        : await startPayment(request).unwrap();
      const id = res.transaction?.transactionId || res.transactionId;
      attemptRef.current = { ...attemptRef.current, request, transactionId: id };
      sessionStorage.setItem(storageKey, JSON.stringify(attemptRef.current));
      if (!activeRef.current) return;
      setTransactionId(id);
      if (acceptResult(res)) return;
      setPhase("waiting");
      setMessage(res.instructions || "Ask the customer to tap their card on the reader.");
    } catch (err) {
      if (!activeRef.current) return;
      const detail = err?.data?.detail;
      if (detail?.status === "failed") {
        forgetAttempt();
      } else if (["terminal_busy", "terminal_unavailable", "terminal_not_found", "terminal_not_assigned", "terminal_provider_mismatch", "invalid_terminal_mid"].includes(err?.data?.error)) {
        // These server preflight failures occur before a payment is dispatched.
        forgetAttempt();
      } else if (err?.data?.error === "terminal_payment_pending" && detail?.transactionId) {
        attemptRef.current = { ...attemptRef.current, transactionId: detail.transactionId };
        sessionStorage.setItem(storageKey, JSON.stringify(attemptRef.current));
        setTransactionId(detail.transactionId);
        setPhase("waiting");
        setMessage("Checking the previous card payment. No new charge was started.");
        return;
      }
      setPhase("error");
      setMessage(err?.data?.message || "Could not confirm the payment result. Check again to recover this attempt without sending a duplicate charge.");
    }
  };

  // Recover an existing attempt before offering any new reader selection.
  useEffect(() => {
    if (!open) {
      // reset for next open
      startedRef.current = false;
      doneRef.current = false;
      clearTimers();
      setPhase("reader");
      setSelectedReader(null);
      setAutoUseDefault(true);
      setTransactionId(null);
      setMessage("");
      setTipAllocation(tipDefaults.defaultAllocation || "booking_host");
      setTipManagerAuditId(null);
      return;
    }
    if (startedRef.current) return;
    if (readAttempt(sessionStorage, storageKey)) {
      beginStart(tip && tip.allocation ? tip : null);
    } else {
      setPhase("reader");
    }
    return () => clearTimers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const chooseReader = (reader) => {
    setSelectedReader(reader);
    if (collectTip) setPhase("tip");
    else beginStart(tip && tip.allocation ? tip : null, reader.terminalId, reader.displayName);
  };

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

    const readStatus = async () => {
      const r = await triggerStatus(transactionId).unwrap();
      return { status: r.transaction?.status || r.status, r };
    };

    let stopped = false;
    let slowPolling = false;
    const poll = async () => {
      try {
        const { r } = await readStatus();
        if (stopped || !activeRef.current) return;
        errorStreak = 0;
        if (acceptResult(r)) return;
        if (r.reviewRequired) {
          slowPolling = true;
          setMessage(r.message || "Payment outcome is unknown. Review this attempt before starting another payment.");
        }
        // else still processing — keep polling
      } catch {
        if (stopped || !activeRef.current) return;
        errorStreak += 1;
        // Don't kill the payment on a transient blip, but stop pretending all
        // is well after several consecutive failures.
        if (errorStreak >= 5 && !doneRef.current) {
          slowPolling = true;
          setMessage("Trouble reaching the reader — still trying…");
        }
      } finally {
        if (!stopped && !doneRef.current) pollRef.current = setTimeout(poll, slowPolling ? 10000 : POLL_MS);
      }
    };

    // Timeout: STOP the reader so a late tap can't orphan-charge, then do a
    // FINAL status check — if the customer tapped just before we gave up, the
    // payment may already be captured and we must honor it (money moved).
    const onTimeout = async () => {
      if (doneRef.current || stopped || !activeRef.current) return;
      slowPolling = true;
      try {
        const result = await cancelPayment({ transactionId, reason: "timed out waiting for card" }).unwrap();
        if (stopped || !activeRef.current) return;
        if (acceptResult(result)) return;
      } catch {
        /* may already be captured/cancelled — the final check below decides */
      }
      try {
        const { r } = await readStatus();
        if (stopped || !activeRef.current) return;
        if (acceptResult(r)) return;
      } catch {
        /* fall through to the error state */
      }
      if (doneRef.current || stopped || !activeRef.current) return;
      setMessage("Cancellation is not confirmed. Still checking the previous payment; do not charge again yet.");
    };

    timeoutRef.current = setTimeout(onTimeout, TIMEOUT_MS);
    poll(); // immediate first check

    return () => { stopped = true; clearTimers(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, transactionId]);

  async function handleCancel() {
    if (phase === "starting" || cancelling) return;
    setCancelling(true);
    if (transactionId && (phase === "waiting" || phase === "error")) {
      try {
        const result = await cancelPayment({ transactionId, reason: "cashier cancelled" }).unwrap();
        if (!activeRef.current) return;
        if (!acceptResult(result)) {
          setMessage("Cancellation is not confirmed. Checking the previous payment before retrying.");
          setCancelling(false);
          return;
        }
        if (terminalOutcome(result) === "approved") return;
      } catch {
        setMessage("Could not confirm cancellation. The payment may still complete; check again before retrying.");
        setCancelling(false);
        return;
      }
    }
    clearTimers();
    onClose?.();
  }

  if (!open) return null;

  const tone =
    phase === "approved" ? "#16A34A" :
    phase === "declined" || phase === "error" ? "#DC2626" :
    "#FF8A00";
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
      <div style={{ width: 380, maxWidth: "100%", maxHeight: "calc(100dvh - 32px)", overflowY: "auto", boxSizing: "border-box", background: "white", borderRadius: 16, padding: 24, textAlign: "center", boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}>
        <div style={{ fontSize: 13, color: "var(--ink-500, #64748B)", fontWeight: 700, textTransform: "uppercase", letterSpacing: ".04em" }}>
          Card terminal
        </div>
        <div style={{ fontSize: 30, fontWeight: 900, margin: "4px 0 16px", fontFamily: "var(--font-display)" }}>
          {moneyFmt(attemptRef.current?.request?.amount ?? amount)}{currency ? ` ${String(currency).toUpperCase()}` : ""}
        </div>

        {phase !== "reader" && (selectedReader?.displayName || attemptRef.current?.readerName) &&
          <div style={{ marginBottom: 12, fontSize: 13, overflowWrap: "anywhere" }}>{attemptRef.current?.readerName || selectedReader?.displayName}</div>}
        {phase === "reader" ? (
          <TerminalReaderPicker posDeviceId={posDeviceId} locationId={locationId} currency={currency}
            preferredId={readerId} autoUseDefault={autoUseDefault} onSelect={chooseReader} onClose={onClose} />
        ) : phase === "tip" ? (
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

        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {phase === "waiting" && <button type="button" className="a-btn" disabled={cancelling}
            onClick={() => { clearTimers(); onClose?.(); }}>Leave pending</button>}
          {["error", "declined", "cancelled"].includes(phase) && (
            <button type="button" className="a-btn a-btn--primary" onClick={() => {
              startedRef.current = false; doneRef.current = false; setCancelling(false);
              if (readAttempt(sessionStorage, storageKey)) beginStart(tip && tip.allocation ? tip : null);
              else { setTransactionId(null); setAutoUseDefault(true); setPhase("reader"); }
            }}> {phase === "error" ? "Check / retry payment" : "Retry payment"} </button>
          )}
          {["error", "declined", "cancelled"].includes(phase) && !attemptRef.current && (
            <button type="button" className="a-btn" onClick={() => {
              startedRef.current = false; doneRef.current = false; setCancelling(false);
              setTransactionId(null); setAutoUseDefault(false); setPhase("reader");
            }}><Icon name="credit-card" size={16} /> Change reader</button>
          )}
          {phase === "approved" ? (
            <button type="button" className="a-btn a-btn--primary" onClick={() => onClose?.()}
              style={{ flex: 1, justifyContent: "center", minHeight: 48 }}>
              <Icon name="check" size={16} /> Done
            </button>
          ) : (
            <button type="button" className="a-btn"
              onClick={handleCancel}
              disabled={phase === "starting" || cancelling}
              style={{ flex: 1, justifyContent: "center", minHeight: 48, border: "1px solid var(--ink-200,#e2e8f0)", background: "white" }}>
              {cancelling ? "Checking cancellation..." : phase === "waiting" || phase === "starting" ? "Cancel payment" : "Close"}
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
        {/* Card-present approval happens on the physical reader; the cashier
            waits for the provider result. */}
      </div>
      <style>{`@keyframes terminalspin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
