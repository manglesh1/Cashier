// Refund — find a paid booking, refund up to what was paid, with manager
// approval. The backend route (/payment/manual-refund/:id) is manager-gated
// and money-sensitive, so we always require a manager override (PIN) before
// calling it; the approving manager + reason are recorded in the refund
// remarks for the audit trail.

import React, { useState } from "react";
import { toast } from "sonner";
import { Icon } from "./Icon";
import { StatusPill } from "./StatusPill";
import { useGetAllBookingQuery, useRefundPaymentMutation } from "../../features/bookings/bookingApi";
import { useDebounceSearch } from "../../hooks/useDebounceSearch";
import { moneyFmt, roundMoney } from "../../lib/money";
import ManagerOverridePrompt from "../../components/ManagerOverridePrompt";

const paidOf = (b) => roundMoney(Number(b?.amountPaid ?? b?.amountPaidTotal ?? 0) || 0);
const nameOf = (b) => b?.bookingName || b?.guest?.guestName || b?.guestName || "Walk-in";
const numberOf = (b) => b?.bookingNumber || `#${b?.bookingId}`;
const whenOf = (b) => {
  const iso = b?.createdAt || b?.bookingDate || b?.date;
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
};

export function Refund() {
  const { inputValue, searchTerm, setDebouncedSearch } = useDebounceSearch(350);
  const trimmed = (searchTerm || "").trim();
  const { data, isFetching } = useGetAllBookingQuery(
    { search: trimmed, limit: 8, page: 1 },
    { skip: trimmed.length < 2 }
  );
  const results = data?.data || [];

  const [selected, setSelected] = useState(null);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [managerOpen, setManagerOpen] = useState(false);
  const [done, setDone] = useState(null);
  const [refundPayment, { isLoading: refunding }] = useRefundPaymentMutation();

  const refundable = selected ? paidOf(selected) : 0;
  const amountNum = roundMoney(Number(amount) || 0);

  const pickBooking = (b) => {
    setSelected(b);
    setAmount(paidOf(b).toFixed(2));
    setReason("");
  };

  const reset = () => {
    setSelected(null);
    setAmount("");
    setReason("");
    setDone(null);
  };

  const requestRefund = () => {
    if (!selected) return;
    if (!Number.isFinite(amountNum) || amountNum <= 0) {
      toast.error("Enter a refund amount.");
      return;
    }
    if (amountNum > refundable) {
      toast.error(`Refund cannot exceed the ${moneyFmt(refundable)} paid.`);
      return;
    }
    setManagerOpen(true);
  };

  const doRefund = async (audit) => {
    setManagerOpen(false);
    try {
      const res = await refundPayment({
        bookingId: selected.bookingId,
        amount: amountNum,
        remarks: [
          reason ? `Reason: ${reason}.` : "POS refund.",
          audit?.managerName ? `Approved by ${audit.managerName}.` : "",
        ].filter(Boolean).join(" "),
      }).unwrap();
      const result = res?.data || {};
      setDone({
        refundAmount: roundMoney(result.refundAmount ?? amountNum),
        balance: result.balance,
        paymentStatus: result.paymentStatus,
        bookingNumber: numberOf(selected),
      });
      toast.success(`Refunded ${moneyFmt(result.refundAmount ?? amountNum)}`);
    } catch (err) {
      toast.error(err?.data?.error || err?.data?.message || "Could not process refund");
    }
  };

  // ── Success ────────────────────────────────────────────────────────
  if (done) {
    return (
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", padding: 40 }}>
        <div style={{ width: 88, height: 88, borderRadius: 28, background: "var(--color-success)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", border: "2px solid var(--ink-800)" }}>
          <Icon name="check" size={48} stroke={3} />
        </div>
        <h1 style={{ fontFamily: "var(--font-display)", fontSize: 40, fontWeight: 800, margin: "18px 0 4px" }}>
          Refunded {moneyFmt(done.refundAmount)}
        </h1>
        <div style={{ fontSize: 15, color: "var(--ink-600)", marginBottom: 6 }}>
          {done.bookingNumber}
          {done.balance != null ? ` · balance ${moneyFmt(done.balance)}` : ""}
        </div>
        {done.paymentStatus && <StatusPill tone="info">{String(done.paymentStatus).replace(/_/g, " ")}</StatusPill>}
        <button onClick={reset} className="a-btn a-btn--primary" style={{ marginTop: 22 }}>
          <Icon name="arrow-right" size={18} /> New refund
        </button>
      </div>
    );
  }

  // ── Amount + approval ──────────────────────────────────────────────
  if (selected) {
    return (
      <div style={{ flex: 1, overflowY: "auto", padding: "24px 28px", maxWidth: 720, margin: "0 auto", width: "100%" }}>
        <button onClick={reset} className="a-btn a-btn--ghost a-btn--sm" style={{ marginBottom: 14 }}>
          <Icon name="arrow-left" size={14} /> Back to search
        </button>

        <div style={{ background: "#fff", border: "2px solid var(--ink-800)", borderRadius: 16, padding: 18, marginBottom: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
            <div>
              <div className="eyebrow">Original sale</div>
              <div style={{ fontFamily: "var(--font-mono)", fontSize: 14, marginTop: 2 }}>{numberOf(selected)} · {whenOf(selected)}</div>
              <div style={{ fontSize: 13, color: "var(--ink-500)", marginTop: 2 }}>{nameOf(selected)}</div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 11, color: "var(--ink-500)", fontWeight: 800, textTransform: "uppercase", letterSpacing: ".06em" }}>Paid</div>
              <div className="display-num" style={{ fontSize: 28 }}>{moneyFmt(refundable)}</div>
            </div>
          </div>
        </div>

        <div style={{ display: "grid", gap: 12 }}>
          <label style={{ display: "grid", gap: 6 }}>
            <span style={{ fontSize: 12, fontWeight: 800, color: "var(--ink-600)" }}>Refund amount (max {moneyFmt(refundable)})</span>
            <input
              type="number" min="0" step="0.01" max={refundable}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              style={{ fontSize: 20, fontWeight: 900, padding: "12px 14px", border: "1.5px solid var(--ink-300)", borderRadius: 10 }}
            />
          </label>
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" className="a-btn a-btn--secondary a-btn--sm" onClick={() => setAmount(refundable.toFixed(2))}>Full {moneyFmt(refundable)}</button>
            <button type="button" className="a-btn a-btn--secondary a-btn--sm" onClick={() => setAmount("")}>Clear</button>
          </div>
          <label style={{ display: "grid", gap: 6 }}>
            <span style={{ fontSize: 12, fontWeight: 800, color: "var(--ink-600)" }}>Reason (recorded on the refund)</span>
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. customer left early, duplicate charge"
              style={{ fontSize: 14, padding: "10px 12px", border: "1.5px solid var(--ink-300)", borderRadius: 10 }}
            />
          </label>
        </div>

        <button
          type="button"
          className="a-btn a-btn--primary"
          onClick={requestRefund}
          disabled={refunding}
          style={{ width: "100%", justifyContent: "center", minHeight: 52, marginTop: 18, fontSize: 16 }}
        >
          <Icon name="undo-2" size={18} />
          {refunding ? "Processing…" : `Refund ${moneyFmt(amountNum)} · manager approval`}
        </button>

        <ManagerOverridePrompt
          open={managerOpen}
          title="Approve refund"
          description={`Refund ${moneyFmt(amountNum)} on ${numberOf(selected)}.`}
          action="pos_refund"
          targetType="booking"
          targetId={selected.bookingId}
          payload={{ amount: amountNum }}
          defaultReason={reason || "POS refund"}
          onCancel={() => setManagerOpen(false)}
          onApprove={doRefund}
        />
      </div>
    );
  }

  // ── Find the sale ──────────────────────────────────────────────────
  return (
    <div style={{ flex: 1, overflowY: "auto", padding: "24px 28px", maxWidth: 720, margin: "0 auto", width: "100%" }}>
      <div className="eyebrow">Refund</div>
      <h1 style={{ margin: "4px 0 18px", fontFamily: "var(--font-display)", fontSize: 32, fontWeight: 800 }}>Find the original sale</h1>

      <div style={{ display: "inline-flex", alignItems: "center", gap: 10, padding: "12px 16px", background: "#fff", border: "1.5px solid var(--ink-200)", borderRadius: 14, width: "100%", boxSizing: "border-box" }}>
        <Icon name="search" size={20} stroke={2} style={{ color: "var(--ink-500)" }} />
        <input
          value={inputValue}
          onChange={(e) => setDebouncedSearch(e.target.value)}
          placeholder="Search by name, email, phone, or booking number"
          style={{ all: "unset", flex: 1, fontSize: 16 }}
        />
      </div>

      <div style={{ marginTop: 18, display: "grid", gap: 10 }}>
        {trimmed.length < 2 ? (
          <div style={{ color: "var(--ink-500)", fontSize: 14, padding: 12 }}>Type at least 2 characters to search.</div>
        ) : isFetching ? (
          <div style={{ color: "var(--ink-500)", fontSize: 14, padding: 12 }}>Searching…</div>
        ) : results.length === 0 ? (
          <div style={{ color: "var(--ink-500)", fontSize: 14, padding: 12 }}>No bookings match “{trimmed}”.</div>
        ) : (
          results.map((b) => {
            const paid = paidOf(b);
            return (
              <button
                key={b.bookingId}
                type="button"
                onClick={() => pickBooking(b)}
                disabled={paid <= 0}
                title={paid <= 0 ? "Nothing was paid on this booking" : "Refund this sale"}
                style={{
                  all: "unset", cursor: paid <= 0 ? "not-allowed" : "pointer",
                  display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12,
                  background: "#fff", border: "1.5px solid var(--ink-200)", borderRadius: 14, padding: "14px 16px",
                  opacity: paid <= 0 ? 0.55 : 1,
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 800, color: "var(--ink-900)" }}>{nameOf(b)}</div>
                  <div style={{ fontSize: 12, color: "var(--ink-500)", fontFamily: "var(--font-mono)" }}>{numberOf(b)} · {whenOf(b)}</div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div className="display-num" style={{ fontSize: 18 }}>{moneyFmt(paid)}</div>
                  <div style={{ fontSize: 11, color: "var(--ink-500)" }}>paid</div>
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
