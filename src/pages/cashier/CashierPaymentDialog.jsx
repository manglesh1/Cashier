// Self-contained Take Payment dialog used by the POS sell flow after
// createBooking succeeds. Mirrors the check-in screen's payment modal
// (same recordPayment endpoint, same payment methods, same cash-drawer
// trigger) so the cashier sees identical UX in both places.
//
// Internally manages amount/method/note/discount state and the API call.
// Caller just supplies the freshly-created booking and two callbacks.

import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import { Icon } from "./Icon";
import {
  useRecordPaymentMutation,
  useSendBookingConfirmationMutation,
} from "../../features/bookings/bookingApi";
import { useLazyValidateDiscountCodeQuery } from "../../features/discount/discountApi";
import ManagerOverridePrompt from "../../components/ManagerOverridePrompt";
import { getTerminal } from "../../lib/terminal";

const moneyFmt = (v) => `$${(Number(v) || 0).toFixed(2)}`;
const roundMoney = (v) => Number((Number(v) || 0).toFixed(2));

function triggerCashDrawer({ bookingId, terminal }) {
  const payload = {
    bookingId,
    terminalDeviceId: terminal?.deviceId || null,
    terminalName: terminal?.deviceName || terminal?.name || null,
    openedAt: new Date().toISOString(),
  };
  window.dispatchEvent(new CustomEvent("cashier:open-cash-drawer", { detail: payload }));
  try {
    localStorage.setItem("cashier:lastDrawerOpen", JSON.stringify(payload));
  } catch {
    /* best-effort */
  }
}

const PAYMENT_METHODS = [
  { value: "cash", label: "Cash", icon: "banknote", bg: "#F23B20" },
  { value: "card", label: "Credit / Debit", icon: "credit-card", bg: "#FF8A00" },
  { value: "gift_card", label: "Gift Card", icon: "gift", bg: "#1687F5" },
  { value: "check", label: "Check", icon: "receipt", bg: "#D8D8D8", fg: "#111" },
];
const QUICK_CASH = [1, 5, 10, 20, 50, 100];
const KEYPAD = ["7", "8", "9", "4", "5", "6", "1", "2", "3", "0", "00", "."];

export default function CashierPaymentDialog({
  open,
  booking,            // { bookingId, bookingNumber, totalAmount, balanceDue?, taxAmount?, subTotal?, ... }
  onClose,
  onComplete,         // () => void — fired after successful payment + close
}) {
  const [recordPayment, { isLoading: isSubmitting }] = useRecordPaymentMutation();
  const [sendBookingConfirmation, { isLoading: sendingReceipt }] = useSendBookingConfirmationMutation();
  const [validateDiscountCode] = useLazyValidateDiscountCodeQuery();

  const [method, setMethod] = useState("card");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [discount, setDiscount] = useState(null);
  const [complete, setComplete] = useState(null);
  const [couponCode, setCouponCode] = useState("");
  const [manualDiscount, setManualDiscount] = useState("");
  const [managerOpen, setManagerOpen] = useState(false);

  // Reset every time a new booking is opened.
  useEffect(() => {
    if (!open) return;
    const due = Number(booking?.balanceDue ?? booking?.totalAmount ?? 0);
    setMethod("card");
    setAmount(due.toFixed(2));
    setNote("");
    setDiscount(null);
    setComplete(null);
    setCouponCode("");
    setManualDiscount("");
  }, [open, booking?.bookingId]);

  if (!open || !booking) return null;

  const balanceDue = Number(booking.balanceDue ?? booking.totalAmount ?? 0);
  const subTotal = Number(booking.subTotal ?? booking.subtotal ?? balanceDue);
  const taxAmount = Number(booking.taxAmount ?? booking.tax ?? 0);
  const discountAmount = roundMoney(Math.min(Number(discount?.amount || 0), balanceDue));
  const payableBalance = roundMoney(Math.max(0, balanceDue - discountAmount));
  const tendered = Number(amount) || 0;
  const isCash = method === "cash";
  const recordAmount = isCash ? Math.min(payableBalance, tendered) : tendered;
  const remaining = Math.max(0, payableBalance - recordAmount);
  const changeDue = isCash ? Math.max(0, tendered - payableBalance) : 0;

  const applyAmount = (v) => setAmount(String(v));
  const addTender = (v) => setAmount(roundMoney((Number(amount) || 0) + v).toFixed(2));
  const appendDigit = (digit) => {
    const cur = String(amount || "");
    if (digit === "." && cur.includes(".")) return;
    const next = cur === "0" && digit !== "." ? digit : `${cur}${digit}`;
    setAmount(next);
  };
  const handleMethodChange = (next) => {
    setMethod(next);
    setAmount(next === "cash" ? "" : payableBalance.toFixed(2));
  };

  const applyCoupon = async () => {
    const code = couponCode.trim();
    if (!code) {
      toast.error("Enter coupon code.");
      return;
    }
    try {
      const res = await validateDiscountCode(code).unwrap();
      const promo = res?.data || {};
      const rawValue = Number(promo.value || 0);
      const calculated = Number(promo.discountType) === 1
        ? roundMoney(Math.min(payableBalance, (balanceDue * rawValue) / 100, Number(promo.maxValue || Infinity)))
        : roundMoney(Math.min(payableBalance, rawValue));
      if (calculated <= 0) {
        toast.error("Coupon has no value for this balance.");
        return;
      }
      setDiscount({
        amount: calculated,
        label: promo.name || `Coupon ${code}`,
        code: promo.code || code,
        source: "coupon",
      });
      setAmount(method === "cash" ? "" : roundMoney(Math.max(0, balanceDue - calculated)).toFixed(2));
      toast.success(`Coupon applied: ${moneyFmt(calculated)}`);
    } catch (err) {
      toast.error(err?.data?.message || err?.data?.error || "Coupon not valid.");
    }
  };

  const requestManagerDiscount = () => {
    const amt = roundMoney(Math.min(Number(manualDiscount), balanceDue));
    if (!amt || amt <= 0) {
      toast.error("Enter discount amount.");
      return;
    }
    setManagerOpen(true);
  };

  const handleSubmit = async () => {
    if (payableBalance > 0 && (!Number.isFinite(tendered) || tendered <= 0)) {
      toast.error(isCash ? "Enter cash received." : "Enter a payment amount.");
      return;
    }
    if (isCash && tendered < payableBalance) {
      toast.error(`Cash received must cover ${moneyFmt(payableBalance)}.`);
      return;
    }
    if (!isCash && tendered > payableBalance) {
      toast.error(`Amount cannot exceed ${moneyFmt(payableBalance)}.`);
      return;
    }
    const finalRecord = isCash ? payableBalance : tendered;
    const cashRemark = isCash
      ? `Cash tendered ${moneyFmt(tendered)}; change due ${moneyFmt(changeDue)}.`
      : "";
    const terminal = getTerminal();

    try {
      let res = null;
      if (discountAmount > 0) {
        res = await recordPayment({
          bookingId: booking.bookingId,
          amountPaid: discountAmount,
          paymentMethod: "complimentary",
          terminalDeviceId: terminal?.deviceId || null,
          remarks: [
            `POS discount applied: ${discount?.label || "Discount"}`,
            discount?.code ? `Code ${discount.code}.` : "",
            discount?.managerName ? `Approved by ${discount.managerName}.` : "",
          ].filter(Boolean).join(" "),
        }).unwrap();
      }
      if (finalRecord > 0) {
        res = await recordPayment({
          bookingId: booking.bookingId,
          amountPaid: finalRecord,
          paymentMethod: method,
          tenderedAmount: tendered,
          changeDue,
          terminalDeviceId: terminal?.deviceId || null,
          remarks: [note || "Payment recorded at POS sell", cashRemark].filter(Boolean).join(" "),
        }).unwrap();
      }
      if (isCash && finalRecord > 0) {
        triggerCashDrawer({ bookingId: booking.bookingId, terminal });
      }
      setComplete({
        ...(res?.data || {}),
        amountPaid: roundMoney(finalRecord + discountAmount),
        discountAmount,
        discountLabel: discount?.label || null,
        paymentAmount: finalRecord,
        paymentMethod: method,
        tenderedAmount: tendered,
        changeDue,
        drawerOpened: isCash && finalRecord > 0,
      });
      toast.success(isCash ? `${moneyFmt(finalRecord)} recorded · drawer opened` : `${moneyFmt(finalRecord)} recorded`);
    } catch (err) {
      toast.error(err?.data?.message || err?.data?.error || "Could not record payment");
    }
  };

  const handleEmailReceipt = async () => {
    if (!booking?.bookingId) return;
    const promise = sendBookingConfirmation({ bookingId: booking.bookingId }).unwrap();
    toast.promise(promise, {
      loading: "Sending receipt...",
      success: "Receipt emailed",
      error: (err) => err?.data?.message || err?.data?.error || "Could not email receipt",
    });
  };

  const handlePrint = () => window.print();

  const closeAndComplete = () => {
    onClose?.();
    if (complete) onComplete?.();
  };

  return (
    <div role="dialog" aria-modal="true" style={{
      position: "fixed", inset: 0, zIndex: 1200,
      background: "rgba(26, 24, 20, 0.62)",
      display: "flex", alignItems: "center", justifyContent: "center", padding: 18,
    }}>
      <div style={{
        width: "min(980px, 100%)", maxHeight: "calc(100vh - 24px)", background: "#F6F1E8",
        border: "2px solid var(--ink-900)", borderRadius: 14,
        boxShadow: "0 20px 70px rgba(0,0,0,0.35)", overflow: "auto",
      }}>
        {/* Header */}
        <div style={{ padding: "16px 18px", borderBottom: "1.5px solid var(--ink-200)",
          display: "flex", justifyContent: "space-between", gap: 12 }}>
          <div>
            <div style={{ fontSize: 11, color: "var(--aero-orange-600)", fontWeight: 800, fontFamily: "var(--font-mono)" }}>
              {booking.bookingNumber || "—"}
            </div>
            <div style={{ fontSize: 20, fontWeight: 900, color: "var(--ink-900)", marginTop: 2 }}>
              {complete ? "Payment complete" : "Take payment"}
            </div>
          </div>
          <button type="button" onClick={closeAndComplete}
            className="a-btn a-btn--ghost a-btn--sm">
            <Icon name="x" size={14} /> Close
          </button>
        </div>

        {complete ? (
          // ── Receipt view ────────────────────────────────────────
          <div style={{ padding: "20px 22px" }}>
            <div style={{
              padding: "20px 18px", background: "#EAF8EF",
              border: "1.5px solid #8AD5A3", borderRadius: 12, textAlign: "center",
            }}>
              <Icon name="check-circle-2" size={42} style={{ color: "#137A35" }} />
              <div style={{ fontSize: 22, fontWeight: 900, color: "#137A35", marginTop: 8 }}>
                {moneyFmt(complete.amountPaid)} received
              </div>
              <div style={{ fontSize: 13, color: "var(--ink-700)", marginTop: 4 }}>
                {complete.paymentMethod === "cash"
                  ? `Cash · change due ${moneyFmt(complete.changeDue)}`
                  : `${complete.paymentMethod} payment`}
                {complete.discountAmount > 0 ? ` · ${moneyFmt(complete.discountAmount)} discount applied` : ""}
              </div>
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 16, justifyContent: "center" }}>
              <button type="button" className="a-btn a-btn--secondary" onClick={handlePrint}>
                <Icon name="printer" size={14} /> Print
              </button>
              <button type="button" className="a-btn a-btn--secondary" onClick={handleEmailReceipt} disabled={sendingReceipt}>
                <Icon name="mail" size={14} /> {sendingReceipt ? "Sending…" : "Email receipt"}
              </button>
              <button type="button" className="a-btn a-btn--primary" onClick={closeAndComplete}>
                <Icon name="arrow-right" size={14} /> Done
              </button>
            </div>
          </div>
        ) : (
          // ── Payment entry ────────────────────────────────────────
          <div style={{ display: "grid", gridTemplateColumns: "1.1fr 1fr", gap: 0 }}>
            {/* Left — totals + discount + methods */}
            <div style={{ padding: "16px 18px", borderRight: "1.5px solid var(--ink-200)" }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: "4px 16px",
                fontSize: 13, color: "var(--ink-700)" }}>
                <span>Subtotal</span><span>{moneyFmt(subTotal)}</span>
                <span>Tax</span><span>{moneyFmt(taxAmount)}</span>
                {discountAmount > 0 && (
                  <>
                    <span style={{ color: "#137A35" }}>Discount {discount?.label ? `· ${discount.label}` : ""}</span>
                    <span style={{ color: "#137A35" }}>−{moneyFmt(discountAmount)}</span>
                  </>
                )}
                <span style={{ fontWeight: 800, fontSize: 16, marginTop: 6, color: "var(--ink-900)" }}>Balance due</span>
                <span style={{ fontWeight: 800, fontSize: 16, marginTop: 6, color: "var(--ink-900)" }}>{moneyFmt(payableBalance)}</span>
              </div>

              <div style={{ marginTop: 14, padding: "10px 12px", background: "white",
                border: "1.5px solid var(--ink-200)", borderRadius: 10 }}>
                <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: ".06em",
                  textTransform: "uppercase", color: "var(--ink-500)", marginBottom: 6 }}>Discount</div>
                <div style={{ display: "flex", gap: 6 }}>
                  <input value={couponCode} onChange={(e) => setCouponCode(e.target.value)}
                    placeholder="Coupon code"
                    style={{ flex: 1, fontSize: 13, padding: "6px 8px",
                      border: "1.5px solid var(--ink-200)", borderRadius: 6 }} />
                  <button type="button" className="a-btn a-btn--secondary a-btn--sm" onClick={applyCoupon}>Apply</button>
                </div>
                <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                  <input value={manualDiscount} onChange={(e) => setManualDiscount(e.target.value)}
                    type="number" placeholder="Amount $"
                    style={{ flex: 1, fontSize: 13, padding: "6px 8px",
                      border: "1.5px solid var(--ink-200)", borderRadius: 6 }} />
                  <button type="button" className="a-btn a-btn--secondary a-btn--sm" onClick={requestManagerDiscount}>
                    Manager
                  </button>
                </div>
                {discount && (
                  <div style={{ marginTop: 6, fontSize: 11, color: "var(--ink-700)", display: "flex", alignItems: "center", gap: 4 }}>
                    <Icon name="check-circle-2" size={11} style={{ color: "#137A35" }} />
                    {discount.label} · {moneyFmt(discount.amount)}
                    <button type="button" onClick={() => setDiscount(null)}
                      style={{ all: "unset", cursor: "pointer", marginLeft: 4, color: "var(--ink-500)" }}>
                      <Icon name="x" size={11} />
                    </button>
                  </div>
                )}
              </div>

              <div style={{ marginTop: 14 }}>
                <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: ".06em",
                  textTransform: "uppercase", color: "var(--ink-500)", marginBottom: 6 }}>Method</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  {PAYMENT_METHODS.map((m) => {
                    const active = method === m.value;
                    return (
                      <button key={m.value} type="button" onClick={() => handleMethodChange(m.value)}
                        style={{
                          all: "unset", cursor: "pointer", display: "flex", alignItems: "center", gap: 8,
                          padding: "10px 12px", borderRadius: 10,
                          background: active ? m.bg : "white",
                          color: active ? (m.fg || "white") : "var(--ink-900)",
                          border: `1.5px solid ${active ? m.bg : "var(--ink-200)"}`,
                          fontWeight: 700, fontSize: 13,
                        }}>
                        <Icon name={m.icon} size={16} />
                        {m.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div style={{ marginTop: 14 }}>
                <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: ".06em",
                  textTransform: "uppercase", color: "var(--ink-500)", marginBottom: 6 }}>Note (optional)</div>
                <input value={note} onChange={(e) => setNote(e.target.value)}
                  placeholder="Reference, customer name…"
                  style={{ width: "100%", fontSize: 13, padding: "8px 10px",
                    border: "1.5px solid var(--ink-200)", borderRadius: 6 }} />
              </div>
            </div>

            {/* Right — keypad / quick tender */}
            <div style={{ padding: "16px 18px", display: "flex", flexDirection: "column" }}>
              <div style={{ padding: "10px 12px", background: "white",
                border: "1.5px solid var(--ink-200)", borderRadius: 10,
                display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ fontSize: 11, fontWeight: 800, color: "var(--ink-500)" }}>
                  {isCash ? "Cash tendered" : "Amount"}
                </div>
                <div style={{ fontSize: 22, fontWeight: 900, color: "var(--ink-900)" }}>
                  {moneyFmt(amount || 0)}
                </div>
              </div>
              {isCash && (
                <div style={{ marginTop: 8, fontSize: 12, color: "var(--ink-700)",
                  display: "flex", justifyContent: "space-between" }}>
                  <span>Change due</span>
                  <span style={{ fontWeight: 800 }}>{moneyFmt(changeDue)}</span>
                </div>
              )}
              {isCash && (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 6, marginTop: 8 }}>
                  {QUICK_CASH.map((v) => (
                    <button key={v} type="button" onClick={() => addTender(v)}
                      style={{ minHeight: 40, border: "1px solid var(--ink-200)", background: "white",
                        borderRadius: 7, fontSize: 13, fontWeight: 800, cursor: "pointer" }}>
                      ${v}
                    </button>
                  ))}
                </div>
              )}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6, marginTop: 8 }}>
                {KEYPAD.map((k) => (
                  <button key={k} type="button" onClick={() => appendDigit(k)}
                    style={{ minHeight: 54, border: "1px solid var(--ink-200)", background: "white",
                      borderRadius: 7, fontSize: 20, fontWeight: 900, cursor: "pointer" }}>
                    {k}
                  </button>
                ))}
                <button type="button" onClick={() => applyAmount("")}
                  style={{ minHeight: 54, border: "1px solid var(--ink-200)", background: "white",
                    borderRadius: 7, fontSize: 16, fontWeight: 900, cursor: "pointer" }}>
                  Clear
                </button>
                <button type="button" onClick={() => applyAmount(String(amount || "").slice(0, -1))}
                  style={{ minHeight: 54, border: "1px solid var(--ink-200)", background: "white",
                    borderRadius: 7, fontSize: 16, fontWeight: 900, cursor: "pointer" }}>
                  <Icon name="delete" size={16} />
                </button>
                <button type="button" onClick={() => applyAmount(payableBalance.toFixed(2))}
                  style={{ minHeight: 54, border: "1px solid var(--ink-200)", background: "white",
                    borderRadius: 7, fontSize: 14, fontWeight: 900, cursor: "pointer" }}>
                  Exact
                </button>
              </div>
              <button type="button" className="a-btn a-btn--primary" onClick={handleSubmit} disabled={isSubmitting}
                style={{ width: "100%", justifyContent: "center", minHeight: 52, marginTop: 10, fontSize: 16 }}>
                <Icon name="check" size={16} />
                {isSubmitting ? "Recording…" : `Complete · ${moneyFmt(payableBalance)}`}
              </button>
            </div>
          </div>
        )}

        <ManagerOverridePrompt
          open={managerOpen}
          title="Approve manager discount"
          description={`Apply ${moneyFmt(Math.min(Number(manualDiscount), balanceDue))} discount to ${booking.bookingNumber || ""}.`}
          action="pos_manager_discount"
          targetType="booking"
          targetId={booking.bookingId}
          payload={{ amount: roundMoney(Math.min(Number(manualDiscount), balanceDue)) }}
          defaultReason="POS sell manager discount"
          onCancel={() => setManagerOpen(false)}
          onApprove={(audit) => {
            const amt = roundMoney(Math.min(Number(manualDiscount), balanceDue));
            setDiscount({ amount: amt, label: "Manager discount", source: "manager", managerName: audit?.managerName });
            setAmount(method === "cash" ? "" : roundMoney(Math.max(0, balanceDue - amt)).toFixed(2));
            setManagerOpen(false);
          }}
        />
      </div>
    </div>
  );
}
