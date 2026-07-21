// Refund — find a paid booking, refund up to what was paid, with manager
// approval. The backend route (/payment/manual-refund/:id) is manager-gated
// and money-sensitive, so we always require a manager override (PIN) before
// calling it; the approving manager + reason are recorded in the refund
// remarks for the audit trail.

import React, { useCallback, useState } from "react";
import { toast } from "sonner";
import { Icon } from "./Icon";
import { StatusPill } from "./StatusPill";
import {
  useLazySearchBookingSuggestionsQuery,
  useRefundPaymentMutation,
} from "../../features/bookings/bookingApi";
import { LookupSearch } from "../../components/LookupSearch";
import {
  RefundBookingLookupOption,
  bookingCustomerNameOf,
  bookingLabelOf,
  bookingSecondaryOf,
  bookingSuggestionItems,
  bookingWhenOf,
  lookupItemKey,
  paidAmountOf,
} from "../../components/cashierLookupRenderers";
import { moneyFmt, roundMoney } from "../../lib/money";
import ManagerOverridePrompt from "../../components/ManagerOverridePrompt";

const paidOf = paidAmountOf;
const nameOf = bookingCustomerNameOf;
const numberOf = bookingLabelOf;
const whenOf = bookingWhenOf;

export function Refund() {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(null);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [managerOpen, setManagerOpen] = useState(false);
  const [done, setDone] = useState(null);
  const [searchBookingSuggestions] = useLazySearchBookingSuggestionsQuery();
  const [refundPayment, { isLoading: refunding }] = useRefundPaymentMutation();

  const runRefundSearch = useCallback(
    (search, { limit } = {}) =>
      searchBookingSuggestions({
        query: search,
        limit: limit || 12,
        paymentStatus: ["paid", "part-paid"],
      }).unwrap(),
    [searchBookingSuggestions]
  );

  const refundable = selected ? paidOf(selected) : 0;
  const amountNum = roundMoney(Number(amount) || 0);

  const pickBooking = (b) => {
    setSelected(b);
    setQuery(bookingLabelOf(b));
    setAmount(paidOf(b).toFixed(2));
    setReason("");
  };

  const reset = () => {
    setSelected(null);
    setQuery("");
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

      <LookupSearch
        autoFocus
        value={query}
        onInputChange={(next) => {
          setQuery(next);
          if (!next.trim()) setSelected(null);
        }}
        onSearch={runRefundSearch}
        onSelect={pickBooking}
        minChars={2}
        limit={12}
        placeholder="Search paid booking by name, email, phone, booking #, or ticket code"
        minCharsText="Type at least 2 characters to find a sale."
        emptyText="No bookings match this refund search."
        loadingText="Searching sales..."
        getItems={bookingSuggestionItems}
        getKey={lookupItemKey}
        getLabel={bookingLabelOf}
        getSecondary={bookingSecondaryOf}
        renderItem={(item) => <RefundBookingLookupOption item={item} />}
        className="cashier-refund-lookup"
      />
      <div style={{ color: "var(--ink-500)", fontSize: 13, padding: "14px 2px" }}>
        Select the original paid booking. Sales with no recorded payment cannot be refunded.
      </div>
    </div>
  );
}
