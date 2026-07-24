// Refund — find a paid booking and refund up to what was paid. Backend policy
// decides whether direct cashier permission is enough or a location-bound
// manager approval is required.

import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import { Icon } from "./Icon";
import { StatusPill } from "./StatusPill";
import {
  useGetAllBookingQuery,
  useGetRefundPreviewQuery,
  useGetRefundRequestQuery,
  useRefundPaymentMutation,
} from "../../features/bookings/bookingApi";
import { useDebounceSearch } from "../../hooks/useDebounceSearch";
import { moneyFmt, roundMoney } from "../../lib/money";
import ManagerOverridePrompt from "../../components/ManagerOverridePrompt";
import { useLazyLookupGiftCardQuery } from "../../features/vouchers/voucherApi";
import { validateRefundDestination } from "./refundValidation";

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
  const [resolutionMethod, setResolutionMethod] = useState("original_tender");
  const [giftCardCode, setGiftCardCode] = useState("");
  const [destinationGiftCard, setDestinationGiftCard] = useState(null);
  const [cashConfirmed, setCashConfirmed] = useState(false);
  const [lookupGiftCard, { isFetching: giftCardLoading }] = useLazyLookupGiftCardQuery();
  const [done, setDone] = useState(null);
  const [amountInitializedFor, setAmountInitializedFor] = useState(null);
  const [refundPayment, { isLoading: refunding }] = useRefundPaymentMutation();

  const {
    data: previewResponse,
    isFetching: previewLoading,
    isError: previewFailed,
    error: previewError,
    refetch: refetchPreview,
  } = useGetRefundPreviewQuery(
    { bookingId: selected?.bookingId, resolutionMethod },
    { skip: !selected?.bookingId }
  );
  const preview = previewResponse?.data;
  const { data: requestResponse } = useGetRefundRequestQuery(done?.refundRequestId, {
    skip: !done?.refundRequestId || done?.status !== "processing",
    pollingInterval: done?.status === "processing" ? 3000 : 0,
  });

  const refundable = Number(preview?.refundableAmount) || 0;
  const amountNum = roundMoney(Number(amount) || 0);
  const approvalRequired = Boolean(preview?.authorization?.managerApprovalRequired);
  const selectedDestination = preview?.destinations?.find(
    (destination) => destination.method === resolutionMethod
  );
  const cashConfirmationRequired = selectedDestination?.requiresCashConfirmation === true;

  useEffect(() => {
    const initializationKey = `${selected?.bookingId || ""}:${resolutionMethod}`;
    if (
      selected?.bookingId &&
      preview?.previewVersion &&
      amountInitializedFor !== initializationKey
    ) {
      setAmount(refundable.toFixed(2));
      setAmountInitializedFor(initializationKey);
    }
  }, [amountInitializedFor, preview?.previewVersion, refundable, resolutionMethod, selected?.bookingId]);

  useEffect(() => {
    const request = requestResponse?.data;
    if (!request?.refundRequestId || !done || done.status === request.status) return;
    setDone({ ...done, status: request.status });
    if (request.status === "completed") {
      toast.success(`Refund completed for ${done.bookingNumber}`);
    } else if (["manual_review", "partial"].includes(request.status)) {
      toast.warning("Refund needs staff review. Do not issue another refund.");
    }
  }, [done, requestResponse]);

  const pickBooking = (b) => {
    setSelected(b);
    setAmount("");
    setAmountInitializedFor(null);
    setReason("");
    setResolutionMethod("original_tender");
    setGiftCardCode("");
    setDestinationGiftCard(null);
    setCashConfirmed(false);
  };

  const reset = () => {
    setResolutionMethod("original_tender");
    setGiftCardCode("");
    setDestinationGiftCard(null);
    setCashConfirmed(false);
    setSelected(null);
    setAmount("");
    setReason("");
    setDone(null);
    setAmountInitializedFor(null);
  };

  const selectResolutionMethod = (method) => {
    setResolutionMethod(method);
    setDestinationGiftCard(null);
    setGiftCardCode("");
    setCashConfirmed(false);
    setAmountInitializedFor(null);
  };

  const lookupDestinationGiftCard = async () => {
    const code = giftCardCode.trim();
    if (!code) { toast.error("Enter a gift card code."); return; }
    try {
      const response = await lookupGiftCard({ code }).unwrap();
      const card = response?.data;
      if (!card?.giftCardId) throw new Error("Gift card was not found.");
      if (["cancelled", "expired"].includes(String(card.status || "").toLowerCase())) {
        throw new Error(`Gift card is ${card.status}.`);
      }
      setDestinationGiftCard(card);
      toast.success(`Gift card ${card.code} selected.`);
    } catch (error) {
      toast.error(error?.data?.message || error?.message || "Gift card lookup failed.");
    }
  };

  const requestRefund = () => {
    if (!selected) return;
    if (previewLoading || !preview) {
      toast.error("Refundable amount is still loading.");
      return;
    }
    if (!preview.authorization?.eligible) {
      toast.error(preview.authorization?.message || "You cannot refund this booking.");
      return;
    }
    if (!Number.isFinite(amountNum) || amountNum <= 0) {
      toast.error("Enter a refund amount.");
      return;
    }
    if (amountNum > refundable) {
      toast.error(`Refund cannot exceed the authoritative ${moneyFmt(refundable)} available.`);
      return;
    }
    const destinationError = validateRefundDestination({
      resolutionMethod,
      destinationGiftCard,
      cashConfirmationRequired,
      cashConfirmed,
    });
    if (destinationError) {
      toast.error(destinationError);
      return;
    }
    if (approvalRequired) {
      setManagerOpen(true);
      return;
    }
    doRefund(null);
  };

  const doRefund = async (audit) => {
    setManagerOpen(false);
    try {
      const res = await refundPayment({
        bookingId: selected.bookingId,
        amount: amountNum,
        resolutionMethod,
        destinationGiftCardId: resolutionMethod === "gift_card" ? destinationGiftCard?.giftCardId : undefined,
        cashConfirmed: cashConfirmationRequired ? cashConfirmed : undefined,
        managerOverrideAuditId: audit?.auditId,
        remarks: [
          reason ? `Reason: ${reason}.` : "POS refund.",
          `Destination: ${resolutionMethod}.`,
          audit?.managerName ? `Approved by ${audit.managerName}.` : "",
        ].filter(Boolean).join(" "),
        previewVersion: preview.previewVersion,
      }).unwrap();
      const result = res?.data || {};
      const request = result.refundRequest || {};
      const status = request.status || "processing";
      setDone({
        refundAmount: roundMoney(result.refundAmount ?? amountNum),
        resolutionMethod,
        balance: result.balance,
        paymentStatus: result.paymentStatus,
        bookingNumber: numberOf(selected),
        refundRequestId: request.refundRequestId,
        status,
      });
      if (status === "completed") {
        toast.success(`Refunded ${moneyFmt(result.refundAmount ?? amountNum)}`);
      } else if (["manual_review", "partial"].includes(status)) {
        toast.warning("Refund recorded for staff review. Do not issue another refund.");
      } else {
        toast.info("Refund submitted. Payment confirmation is still pending.");
      }
    } catch (err) {
      if (!audit && err?.data?.error === "manager_approval_required") {
        setManagerOpen(true);
        return;
      }
      if (err?.data?.error === "refund_preview_stale") {
        toast.warning("Refundable amount changed. Review the refreshed amount and try again.");
        refetchPreview();
        setAmountInitializedFor(null);
        return;
      }
      toast.error(err?.data?.error || err?.data?.message || "Could not process refund");
    }
  };

  // ── Success ────────────────────────────────────────────────────────
  if (done) {
    const completed = done.status === "completed";
    const needsReview = ["manual_review", "partial"].includes(done.status);
    return (
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", padding: 40 }}>
        <div style={{ width: 88, height: 88, borderRadius: 28, background: completed ? "var(--color-success)" : needsReview ? "#b45309" : "var(--color-info, #2563eb)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", border: "2px solid var(--ink-800)" }}>
          <Icon name={completed ? "check" : needsReview ? "triangle-alert" : "clock-3"} size={48} stroke={3} />
        </div>
        <h1 style={{ fontFamily: "var(--font-display)", fontSize: 40, fontWeight: 800, margin: "18px 0 4px" }}>
          {completed
            ? `Refunded ${moneyFmt(done.refundAmount)}`
            : needsReview
              ? "Refund needs review"
              : "Refund submitted"}
        </h1>
        {!completed && (
          <div style={{ maxWidth: 520, textAlign: "center", fontSize: 14, color: "var(--ink-600)", marginBottom: 10 }}>
            {needsReview
              ? "The request is recorded and its refundable headroom is reserved. Do not submit a second refund."
              : "The payment provider has not confirmed the refund yet. This screen will update automatically."}
          </div>
        )}
        <div style={{ fontSize: 15, color: "var(--ink-600)", marginBottom: 6 }}>
          {done.bookingNumber}
          {done.balance != null ? ` · balance ${moneyFmt(done.balance)}` : ""}
        </div>
        <StatusPill tone={completed ? "success" : needsReview ? "warning" : "info"}>
          {String(done.status).replace(/_/g, " ")}
        </StatusPill>
        {done.refundRequestId && (
          <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--ink-500)", marginTop: 8 }}>
            Request #{done.refundRequestId}
          </div>
        )}
        <button onClick={reset} className="a-btn a-btn--primary" style={{ marginTop: 22 }}>
          <Icon name="arrow-right" size={18} /> New refund
        </button>
      </div>
    );
  }

  // ── Amount + approval ──────────────────────────────────────────────
  if (selected) {
    const destinationLabels = {
      original_tender: "Original card / tender",
      gift_card: "Gift card",
      cash: "Cash",
    };
    const destinationOptions = preview?.destinations || [];
    const destinationReady = resolutionMethod !== "gift_card" || Boolean(destinationGiftCard?.giftCardId);
    const cashReady = !cashConfirmationRequired || cashConfirmed;
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
              <div style={{ fontSize: 11, color: "var(--ink-500)", fontWeight: 800, textTransform: "uppercase", letterSpacing: ".06em" }}>Refundable now</div>
              <div className="display-num" style={{ fontSize: 28 }}>{previewLoading ? "…" : moneyFmt(refundable)}</div>
            </div>
          </div>
          {preview && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 18, marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--ink-200)", fontSize: 12, color: "var(--ink-600)" }}>
              <span>Captured {moneyFmt(preview.capturedAmount)}</span>
              <span>Refunded or reserved {moneyFmt(preview.reservedAmount)}</span>
              <span>{preview.tenders?.length || 0} tender{preview.tenders?.length === 1 ? "" : "s"}</span>
            </div>
          )}
        </div>

        {previewFailed && (
          <div style={{ border: "1px solid #fca5a5", background: "#fef2f2", color: "#991b1b", borderRadius: 10, padding: 12, marginBottom: 14, fontSize: 13 }}>
            {previewError?.data?.message || "Could not load the refundable amount."}{" "}
            <button type="button" className="a-btn a-btn--ghost a-btn--sm" onClick={refetchPreview}>Retry</button>
          </div>
        )}

        <div style={{ display: "grid", gap: 10, marginBottom: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 900, color: "var(--ink-600)" }}>Return money as</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8 }}>
            {destinationOptions.map((destination) => (
              <button
                key={destination.method}
                type="button"
                disabled={!destination.enabled}
                onClick={() => selectResolutionMethod(destination.method)}
                style={{
                  textAlign: "left",
                  padding: 12,
                  borderRadius: 10,
                  border: resolutionMethod === destination.method ? "2px solid #2563eb" : "1.5px solid var(--ink-300)",
                  background: resolutionMethod === destination.method ? "#eff6ff" : "#fff",
                  opacity: destination.enabled ? 1 : 0.45,
                  cursor: destination.enabled ? "pointer" : "not-allowed",
                }}
              >
                <strong style={{ display: "block", fontSize: 13 }}>{destinationLabels[destination.method]}</strong>
                <span style={{ display: "block", marginTop: 3, fontSize: 11, color: "var(--ink-500)" }}>
                  {destination.enabled ? `Up to ${moneyFmt(destination.refundableAmount)}` : String(destination.reason || "Unavailable").replace(/_/g, " ")}
                </span>
              </button>
            ))}
          </div>

          {resolutionMethod === "gift_card" && (
            <div style={{ border: "1.5px solid #93c5fd", background: "#eff6ff", borderRadius: 10, padding: 12 }}>
              <div style={{ fontSize: 12, fontWeight: 900, marginBottom: 6 }}>Destination gift card</div>
              <div style={{ display: "flex", gap: 8 }}>
                <input value={giftCardCode} onChange={(event) => setGiftCardCode(event.target.value)} placeholder="XXXX-XXXX-XXXX" style={{ flex: 1, minWidth: 0, padding: "10px 12px", border: "1.5px solid #93c5fd", borderRadius: 8 }} />
                <button type="button" className="a-btn a-btn--secondary a-btn--sm" onClick={lookupDestinationGiftCard} disabled={giftCardLoading}>
                  {giftCardLoading ? "Checking..." : "Look up"}
                </button>
              </div>
              {destinationGiftCard && <div style={{ marginTop: 7, color: "#166534", fontSize: 12, fontWeight: 800 }}>Selected {destinationGiftCard.code} ? balance {moneyFmt(destinationGiftCard.currentBalance)}</div>}
            </div>
          )}

          {cashConfirmationRequired && (
            <label style={{ display: "flex", gap: 10, padding: 12, border: "1.5px solid #f59e0b", background: "#fffbeb", borderRadius: 10, fontSize: 12 }}>
              <input type="checkbox" checked={cashConfirmed} onChange={(event) => setCashConfirmed(event.target.checked)} />
              <span><strong style={{ display: "block" }}>Confirm cash payout</strong>Submit first, then hand the exact completed amount to the customer and retain the receipt.</span>
            </label>
          )}
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
          disabled={refunding || previewLoading || previewFailed || refundable <= 0 || !destinationReady || !cashReady || preview?.verdict?.canSubmit === false}
          style={{ width: "100%", justifyContent: "center", minHeight: 52, marginTop: 18, fontSize: 16 }}
        >
          <Icon name="undo-2" size={18} />
          {refunding
            ? "Processing…"
            : previewLoading
              ? "Checking refundable amount…"
            : approvalRequired
              ? `Refund ${moneyFmt(amountNum)} · manager approval`
              : `Refund ${moneyFmt(amountNum)}`}
        </button>

        <ManagerOverridePrompt
          open={managerOpen}
          title="Approve refund"
          description={`Refund ${moneyFmt(amountNum)} on ${numberOf(selected)}.`}
          action="pos_refund"
          targetType="booking"
          targetId={selected.bookingId}
          payload={{
            amount: amountNum,
            currency: preview?.currency,
            resolutionMethod,
            destinationGiftCardId: destinationGiftCard?.giftCardId || undefined,
          }}
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
