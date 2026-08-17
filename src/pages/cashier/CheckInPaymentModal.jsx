// CheckInPaymentModal — overlay shown from the Check-in screen when the
// cashier taps "Take payment" on a booking with a remaining balance.
//
// Extracted from CheckIn.jsx so the file is independently navigable and
// can be unit-tested in isolation. Behavior is unchanged:
//   • The parent owns the open/close, idempotency key, and the
//     useRecordPaymentMutation hook. This component just renders.
//   • Discount sources (coupon / employee / manager) and gift-card
//     redemption are handled in-modal because they only matter while
//     the cashier is staring at the keypad.
//   • Receipt print / email post-payment also live in-modal — they
//     share the "complete" state.

import React, { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Icon } from "./Icon";
import { useLazyValidateDiscountCodeQuery } from "../../features/discount/discountApi";
import { useLazyLookupGiftCardQuery } from "../../features/vouchers/voucherApi";
import { useEffectiveSettings } from "../../lib/useEffectiveSettings";
import { moneyFmt, roundMoney } from "../../lib/money";
import ManagerOverridePrompt from "../../components/ManagerOverridePrompt";
import TipStep from "../../features/tips/TipStep";
import { useTipDefaults } from "../../features/tips/useTipDefaults";
import { useStandaloneTipMutation } from "../../features/tips/tipsApi";
import { computeTipBase, TIP_ALLOCATIONS } from "../../features/tips/tipMath";

// Small inline helper, duplicated from CheckIn.jsx to avoid a cross-file
// circular import. It exists to coerce anything (string, number, nested
// object) into a printable label with a fallback.
const displayText = (value, fallback = "") => {
  if (value === null || value === undefined || value === "") return fallback;
  if (["string", "number", "boolean"].includes(typeof value)) return String(value);
  if (typeof value === "object") {
    return displayText(
      value.displayName ?? value.name ?? value.activityName ?? value.variationName ?? value.label,
      fallback
    );
  }
  return fallback;
};

function buildBookingPromoCartLines(booking) {
  const bookingItems = Array.isArray(booking?.bookingItems) ? booking.bookingItems : [];
  const purchasedItems = Array.isArray(booking?.purchasedItems) ? booking.purchasedItems : [];
  return [
    ...bookingItems.map((item) => ({
      activityId: Number(item.activityId || item.activity?.activityId || item.variation?.activityId || 0) || null,
      variationId: Number(item.variationId || item.variation?.variationId || 0) || null,
      activityType: item.activityTypeKey || item.productType || item.activity?.typeKey || null,
      quantity: Math.max(1, Number(item.noOfTickets || item.quantity || 1) || 1),
      subtotal: roundMoney(item.totalPrice || item.total || item.amount || 0),
      date: item.date || item.activityDate || null,
      timefrom: item.timefrom || item.fromTime || item.startTime || null,
    })),
    ...purchasedItems
      .filter((item) => !item.isBundleInclusion)
      .map((item) => ({
        activityId: Number(item.activityId || 0) || null,
        variationId: Number(item.variationId || 0) || null,
        activityType: item.activityTypeKey || item.productType || null,
        quantity: Math.max(1, Number(item.count || item.quantity || 1) || 1),
        subtotal: roundMoney(item.total || item.totalPrice || 0),
      })),
  ].filter((line) => line.subtotal > 0 && (line.activityId || line.variationId || line.activityType));
}

function CheckInPaymentModal({
  booking,
  balanceDue,
  amount,
  method,
  note,
  discount,
  isSubmitting,
  complete,
  onAmountChange,
  onMethodChange,
  onNoteChange,
  onDiscountChange,
  onSubmit,
  onGiftCardSubmit,
  gcRedeeming,
  onPrintReceipt,
  onEmailReceipt,
  isSendingReceipt,
  onClose,
  onVoid,
  // Sell flow only: the card path runs through TerminalPaymentModal, which
  // can collect an on-glass tip. When true, show the "who gets the card tip"
  // chooser here and report it via onCardTip so the reader uses it.
  cardTipEnabled = false,
  onCardTip,
}) {
  const [couponCode, setCouponCode] = useState("");
  const [manualDiscount, setManualDiscount] = useState("");
  const [managerOpen, setManagerOpen] = useState(false);
  const [receiptEmail, setReceiptEmail] = useState("");
  const [gcCode, setGcCode] = useState("");
  const [gcCard, setGcCard] = useState(null);
  const [cashTenders, setCashTenders] = useState([]);
  const [validateDiscountCode, { isFetching: validatingCoupon }] = useLazyValidateDiscountCodeQuery();
  const [lookupGiftCard, { isFetching: gcLooking }] = useLazyLookupGiftCardQuery();
  const settings = useEffectiveSettings();
  const tipDefaults = useTipDefaults();
  const [standaloneTip] = useStandaloneTipMutation();
  // Tip (gratuity), recorded as a dedicated tip-only transaction once the
  // payment lands. { amount, allocation, selectedPct, managerOverrideAuditId }
  const [tip, setTip] = useState({ amount: 0, allocation: "booking_host", selectedPct: null, managerOverrideAuditId: null });
  const [recordedTip, setRecordedTip] = useState(0);
  const tipGuardRef = useRef(null);
  // Card on-glass tip allocation.
  const [cardAllocation, setCardAllocation] = useState("booking_host");
  // Pre-fill the receipt email from any address on the booking; for a
  // walk-in with none, the cashier types one on the complete view.
  useEffect(() => {
    setReceiptEmail(booking?.guestEmail || booking?.guest?.guestEmail || "");
    setCashTenders([]);
    setTip({ amount: 0, allocation: tipDefaults.defaultAllocation || "booking_host", selectedPct: null, managerOverrideAuditId: null });
    setCardAllocation(tipDefaults.defaultAllocation || "booking_host");
    setRecordedTip(0);
    tipGuardRef.current = null;
  }, [booking?.bookingId, booking?.guestEmail, booking?.guest?.guestEmail]);
  const discountAmount = roundMoney(Math.min(Number(discount?.amount || 0), balanceDue));
  const payableBalance = roundMoney(Math.max(0, balanceDue - discountAmount));
  const tendered = Number(amount) || 0;
  const isCash = method === "cash";
  const isGiftCard = method === "gift_card";
  const gcBalance = roundMoney(Number(gcCard?.currentBalance || 0));
  const gcApply = isGiftCard && gcCard ? roundMoney(Math.min(payableBalance, gcBalance)) : 0;
  const recordAmount = isCash ? Math.min(payableBalance, tendered) : isGiftCard ? gcApply : tendered;
  const remaining = Math.max(0, payableBalance - recordAmount);
  const changeDue = isCash ? Math.max(0, tendered - payableBalance) : 0;
  const cashCoversBalance = isCash && tendered >= payableBalance;
  const isCheck = method === "check";
  const isCard = method === "card";

  // Cash/check tip is entered here. Card tip is collected on the reader, so
  // for card we only show a note + (Sell flow) the "who gets it" chooser.
  const showTip = tipDefaults.enabled && (isCash || isCheck);
  const showCardTip = tipDefaults.enabled && isCard;
  // Report the chosen card-tip allocation to the parent so the terminal uses it.
  useEffect(() => {
    if (showCardTip && cardTipEnabled && typeof onCardTip === "function") {
      onCardTip(cardAllocation);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showCardTip, cardTipEnabled, cardAllocation]);
  const tipBase = computeTipBase({
    subtotal: payableBalance,
    bookingTotal: Number(booking?.totalAmount ?? balanceDue),
    calcOnTotal: tipDefaults.calcOnBookingTotal,
  });

  // Record the tip once the parent flips `complete` (payment succeeded).
  // Self-contained so CheckIn's payment handler needs no change. The ref +
  // server idempotency (keyed on the booking + payment reference) guard
  // against React StrictMode double-invocation and accidental re-fires.
  useEffect(() => {
    if (!complete) return;
    const bid = booking?.bookingId;
    const amt = roundMoney(tip.amount || 0);
    if (!bid || amt <= 0 || !(isCash || isCheck)) return;
    const key = `tip-checkin:${bid}:${complete.referenceNumber || complete.transactionId || amt}`;
    if (tipGuardRef.current === key) return;
    tipGuardRef.current = key;
    (async () => {
      try {
        await standaloneTip({
          bookingId: bid,
          tipAmount: amt,
          method: isCheck ? "check" : "cash",
          allocation: tip.allocation,
          defaultAllocation: tipDefaults.defaultAllocation,
          managerOverrideAuditId: tip.managerOverrideAuditId || undefined,
          source: "checkout",
          idempotencyKey: key,
        }).unwrap();
        setRecordedTip(amt);
      } catch (err) {
        toast.error(
          `Payment recorded, but the tip didn't save (${err?.data?.message || err?.data?.error || "use Add tip on the booking"}).`
        );
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [complete]);

  const handleGcLookup = async () => {
    const code = gcCode.trim();
    if (!code) { toast.error("Enter gift card code."); return; }
    try {
      // Venue policy: no PIN on gift cards. Backend lookup tolerates
      // a missing pin field — the PIN check fires only when a non-empty
      // pin is supplied.
      const res = await lookupGiftCard({ code }).unwrap();
      const card = res?.data;
      if (!card) { toast.error("Card not found."); return; }
      if (String(card.status || "").toLowerCase() !== "active") { toast.error(`Card is ${card.status || "unavailable"}.`); return; }
      if (Number(card.currentBalance || 0) <= 0) { toast.error("Card has no balance."); return; }
      setGcCard(card);
      toast.success(`Gift card balance ${moneyFmt(card.currentBalance)}`);
    } catch (err) {
      toast.error(err?.data?.message || err?.data?.error || "Gift card lookup failed.");
    }
  };
  const taxAmount = Number(booking?.taxAmount ?? booking?.tax ?? 0) || 0;
  // Pre-tax subtotal. Prefer the explicit subtotal field; never fall back to
  // totalAmount (it already INCLUDES tax — doing so made the modal show the
  // tax-inclusive total as the "Order Total" and then add Plus Tax again,
  // double-counting tax). If only a total is known, back tax out of it.
  const subTotal = roundMoney(
    Math.max(
      0,
      Number(
        booking?.subtotalAmount ??
        booking?.subTotal ??
        booking?.subtotal ??
        (booking?.totalAmount != null ? Number(booking.totalAmount) - taxAmount : balanceDue)
      ) || 0
    )
  );
  const existingDiscount = Number(booking?.discountAmount || 0) || 0;
  const promoCartLines = useMemo(() => buildBookingPromoCartLines(booking), [booking]);
  const methods = [
    { value: "cash", label: "Cash", icon: "banknote", bg: "#F23B20" },
    { value: "card", label: "Credit / Debit", icon: "credit-card", bg: "#FF8A00" },
    { value: "gift_card", label: "Gift Card", icon: "gift", bg: "#1687F5" },
    { value: "check", label: "Check", icon: "receipt", bg: "#D8D8D8", fg: "#111" },
  ];
  const quickCash = [1, 5, 10, 20, 50, 100];
  const coinTender = [
    { label: "Loonie", value: 1 },
    { label: "Toonie", value: 2 },
    { label: "Dime", value: 0.1 },
    { label: "Qtt", value: 0.25 },
  ];
  const keypad = ["7", "8", "9", "4", "5", "6", "1", "2", "3", "0", "00", "."];
  const applyAmount = (next) => onAmountChange(String(next));
  const addTender = (value) => {
    const wasCash = method === "cash";
    if (method !== "cash") {
      onMethodChange("cash");
    }
    const next = roundMoney((wasCash ? (Number(amount) || 0) : 0) + value);
    onAmountChange(next.toFixed(2));
    setCashTenders((prev) => {
      const idx = prev.findIndex((entry) => Number(entry.value) === Number(value));
      if (idx < 0) return [...prev, { value, count: 1 }];
      const updated = [...prev];
      updated[idx] = { ...updated[idx], count: updated[idx].count + 1 };
      return updated;
    });
  };
  const handleMethodChange = (nextMethod) => {
    onMethodChange(nextMethod);
    onAmountChange(nextMethod === "cash" || nextMethod === "gift_card" ? "" : payableBalance.toFixed(2));
    setCashTenders([]);
    if (nextMethod !== "gift_card") setGcCard(null);
  };
  const appendDigit = (digit) => {
    if (isCash && cashTenders.length > 0) setCashTenders([]);
    const current = String(amount || "");
    if (digit === "." && current.includes(".")) return;
    const next = current === "0" && digit !== "." ? digit : `${current}${digit}`;
    onAmountChange(next);
  };
  const applyCoupon = async () => {
    const code = couponCode.trim();
    if (!code) {
      toast.error("Enter coupon code.");
      return;
    }
    try {
      const res = await validateDiscountCode({
        code,
        subtotalAmount: subTotal || balanceDue,
        cartLines: promoCartLines,
        guestId: booking?.guestId || null,
      }).unwrap();
      const promo = res?.data || {};
      const rawValue = Number(promo.value || 0);
      const calculated = promo.amount !== undefined && promo.amount !== null
        ? roundMoney(Math.min(payableBalance, Number(promo.amount) || 0))
        : Number(promo.discountType) === 1
          ? roundMoney(Math.min(payableBalance, (balanceDue * rawValue) / 100, Number(promo.maxValue || Infinity)))
          : roundMoney(Math.min(payableBalance, rawValue));
      if (calculated <= 0) {
        toast.error("Coupon has no value for this balance.");
        return;
      }
      onDiscountChange({
        amount: calculated,
        label: promo.name || `Coupon ${code}`,
        code: promo.code || code,
        source: "coupon",
      });
      onAmountChange(method === "cash" ? "" : roundMoney(Math.max(0, balanceDue - calculated)).toFixed(2));
      toast.success(`Coupon applied: ${moneyFmt(calculated)}`);
    } catch (err) {
      toast.error(err?.data?.message || err?.data?.error || "Coupon not valid.");
    }
  };
  const requestManagerDiscount = () => {
    const amt = roundMoney(Math.min(Number(manualDiscount), balanceDue));
    if (!amt || amt <= 0) {
      toast.error("Enter promo amount.");
      return;
    }
    setManagerOpen(true);
  };
  const handleVoid = () => {
    if (isSubmitting || gcRedeeming || complete) return;
    const ok = window.confirm("Void this transaction? No payment will be recorded.");
    if (!ok) return;
    if (typeof onVoid === "function") {
      onVoid();
    } else {
      onClose?.();
    }
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
        <div style={{ padding: "16px 18px", borderBottom: "1.5px solid var(--ink-200)", display: "flex", justifyContent: "space-between", gap: 12 }}>
          <div>
            <div style={{ fontSize: 11, color: "var(--aero-orange-600)", fontWeight: 800, fontFamily: "var(--font-mono)" }}>
              {displayText(booking.bookingNumber, "Booking")}
            </div>
            <div style={{ fontSize: 20, fontWeight: 900, color: "var(--ink-900)", marginTop: 2 }}>
              {complete ? "Payment complete" : "Take payment"}
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
            {!complete && (
              <button
                type="button"
                className="a-btn a-btn--ghost a-btn--sm"
                onClick={handleVoid}
                disabled={isSubmitting || gcRedeeming}
                style={{ color: "#B83210", borderColor: "#F2B8A6" }}
              >
                <Icon name="ban" size={14} /> Void Transaction
              </button>
            )}
            <button type="button" className="a-btn a-btn--ghost a-btn--sm" onClick={onClose}>
              <Icon name="x" size={14} /> Close
            </button>
          </div>
        </div>

        {complete ? (
          <div style={{ padding: 18 }}>
            <div style={{
              border: "1.5px solid #8AD5A3", background: "#EAF8EF",
              borderRadius: 12, padding: 16, color: "#137A35",
              fontWeight: 900, display: "flex", alignItems: "center", gap: 10,
            }}>
              <Icon name="check-circle-2" size={20} />
              {moneyFmt(complete.amountPaid)} paid
            </div>
            {recordedTip > 0 && (
              <div style={{ marginTop: 12, border: "1.5px solid #8AD5A3", background: "#EAF8EF",
                borderRadius: 10, padding: 10, fontSize: 13, fontWeight: 800, color: "#137A35" }}>
                + {moneyFmt(recordedTip)} tip · {moneyFmt(roundMoney(complete.amountPaid + recordedTip))} charged
              </div>
            )}
            {complete.discountAmount > 0 && (
              <div style={{ marginTop: 12, border: "1.5px solid var(--ink-200)", borderRadius: 10, padding: 10, fontSize: 13, fontWeight: 800, color: "var(--ink-700)" }}>
                Discount applied: {moneyFmt(complete.discountAmount)} {complete.discountLabel ? `(${complete.discountLabel})` : ""}
              </div>
            )}
            {complete.paymentMethod === "cash" && (
              <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <div style={{ border: "1.5px solid var(--ink-200)", borderRadius: 10, padding: 12 }}>
                  <div style={{ fontSize: 10, fontWeight: 900, color: "var(--ink-500)", textTransform: "uppercase", letterSpacing: "0.08em" }}>Cash received</div>
                  <div style={{ fontSize: 22, fontWeight: 900, color: "var(--ink-900)", marginTop: 4 }}>{moneyFmt(complete.tenderedAmount)}</div>
                </div>
                <div style={{ border: "2px solid #B83210", background: "#FFF3EE", borderRadius: 10, padding: 12 }}>
                  <div style={{ fontSize: 10, fontWeight: 900, color: "#B83210", textTransform: "uppercase", letterSpacing: "0.08em" }}>Return change</div>
                  <div style={{ fontSize: 22, fontWeight: 900, color: "#B83210", marginTop: 4 }}>{moneyFmt(complete.changeDue)}</div>
                </div>
              </div>
            )}
            {complete.drawerOpened && (
              <div style={{ marginTop: 12, border: "1.5px solid var(--ink-200)", borderRadius: 10, padding: 10, display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 800, color: "var(--ink-700)" }}>
                <Icon name="archive" size={16} />
                Cash drawer signal sent.
              </div>
            )}
            <div style={{ marginTop: 14, fontSize: 13, color: "var(--ink-600)", lineHeight: 1.5 }}>
              Booking is checked in and payment is recorded.
            </div>
            {/* Email receipt — type any address (walk-ins have none on file). */}
            <div style={{ marginTop: 14 }}>
              <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--ink-500)", marginBottom: 6 }}>
                Email receipt
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  value={receiptEmail}
                  onChange={(e) => setReceiptEmail(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") onEmailReceipt(receiptEmail); }}
                  placeholder="customer@email.com"
                  style={{ flex: 1, fontSize: 14, padding: "10px 12px", border: "1.5px solid var(--ink-300)", borderRadius: 8 }}
                />
                <button type="button" className="a-btn a-btn--secondary" onClick={() => onEmailReceipt(receiptEmail)} disabled={isSendingReceipt} style={{ justifyContent: "center" }}>
                  <Icon name="mail" size={15} /> {isSendingReceipt ? "Sending..." : "Send"}
                </button>
              </div>
            </div>
            <div style={{ marginTop: 12 }}>
              <button type="button" className="a-btn a-btn--secondary" onClick={onPrintReceipt} style={{ width: "100%", justifyContent: "center" }}>
                <Icon name="printer" size={15} /> Print
              </button>
            </div>
            <button type="button" className="a-btn a-btn--primary" onClick={onClose} style={{ width: "100%", justifyContent: "center", marginTop: 18 }}>
              Done
            </button>
          </div>
        ) : (
          <div style={{ padding: 8, display: "grid", gridTemplateColumns: "130px minmax(260px, 1fr) minmax(280px, 340px)", gap: 12 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {methods.map((m) => {
                const active = method === m.value;
                return (
                  <button key={m.value} type="button" onClick={() => handleMethodChange(m.value)} style={{
                    border: active ? "3px solid var(--ink-900)" : "1.5px solid var(--ink-400)",
                    background: m.bg,
                    borderRadius: 6, padding: "14px 8px", fontWeight: 900,
                    color: m.fg || "white", minHeight: 58,
                    cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 7,
                  }}>
                    <Icon name={m.icon} size={16} />
                    {m.label}
                  </button>
                );
              })}
              {/* Customer Coupon / Manager Discount / Employee Discount
                  buttons removed — benefits are applied in the cart's
                  "Apply benefit" flyout now. Payment screen is purely
                  for tendering. */}
              <button type="button" className="a-btn a-btn--secondary" onClick={onClose} style={{ marginTop: "auto", justifyContent: "center", minHeight: 46 }}>
                Continue Ordering
              </button>
            </div>

            <div>
              <textarea
                value={note}
                onChange={(e) => onNoteChange(e.target.value)}
                placeholder="Payment note"
                style={{ width: "100%", height: 76, resize: "vertical", border: "1.5px solid var(--ink-400)", background: "white", borderRadius: 4, padding: 10, outline: 0, boxSizing: "border-box", marginBottom: 8 }}
              />
              <div style={{ background: "#FFFDD1", border: "1.5px solid var(--ink-400)", padding: 12, fontSize: 14, fontWeight: 800 }}>
                <TotalLine label="Order Total" value={moneyFmt(subTotal)} />
                <TotalLine label="Existing Promos" value={moneyFmt(existingDiscount)} />
                <TotalLine label="POS Discount" value={moneyFmt(discountAmount)} tone={discountAmount > 0 ? "#F45B0A" : undefined} />
                <div style={{ borderTop: "3px solid var(--ink-900)", margin: "8px 0" }} />
                <TotalLine label="Sub Total" value={moneyFmt(Math.max(0, subTotal - existingDiscount - discountAmount))} />
                <TotalLine label="Plus Tax" value={moneyFmt(taxAmount)} />
                <div style={{ borderTop: "3px solid var(--ink-900)", margin: "8px 0" }} />
                <TotalLine label="Grand Total" value={moneyFmt(balanceDue)} tone="#08A5E8" />
                <TotalLine label="Tender Due" value={moneyFmt(payableBalance)} tone="#F45B0A" />
                <TotalLine label="Tendered" value={moneyFmt(tendered)} />
                <TotalLine
                  label={cashCoversBalance ? "Change" : "Balance Remaining"}
                  value={moneyFmt(cashCoversBalance ? changeDue : remaining)}
                  tone={cashCoversBalance && changeDue > 0 ? "#B83210" : "#08A5E8"}
                />
                {discount?.label && (
                  <div style={{ marginTop: 8, display: "flex", gap: 8, alignItems: "center", justifyContent: "space-between", fontSize: 12 }}>
                    <span>{discount.label}</span>
                    <button type="button" className="a-btn a-btn--ghost a-btn--sm" onClick={() => onDiscountChange(null)}>
                      Clear
                    </button>
                  </div>
                )}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 8 }}>
                <button type="button" className="a-btn a-btn--secondary" onClick={() => {
                  applyAmount(payableBalance.toFixed(2));
                  setCashTenders([]);
                }} style={{ justifyContent: "center" }}>
                  Exact Change
                </button>
                <button type="button" className="a-btn a-btn--secondary" onClick={() => { onAmountChange(""); setCashTenders([]); onDiscountChange(null); setCouponCode(""); setManualDiscount(""); }} style={{ justifyContent: "center" }}>
                  Clear Payments
                </button>
              </div>
              {showTip && (
                <TipStep
                  base={tipBase}
                  bookingId={booking?.bookingId || null}
                  defaults={tipDefaults}
                  value={tip}
                  onChange={setTip}
                />
              )}
              {showCardTip && (
                <div style={{ marginTop: 8, padding: "10px 12px", background: "#EEF6FF", border: "1.5px solid #9DC8F5", borderRadius: 8 }}>
                  <div style={{ fontSize: 12, fontWeight: 800, color: "#0A5FB4", display: "flex", alignItems: "center", gap: 6 }}>
                    <Icon name="credit-card" size={14} /> Tip is added on the card reader
                  </div>
                  <div style={{ fontSize: 11, color: "var(--ink-600)", marginTop: 2 }}>
                    The guest enters the tip on the device after you tap Complete.
                  </div>
                  {cardTipEnabled && (
                    <div style={{ marginTop: 8 }}>
                      <div style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: ".06em", color: "var(--ink-500)", marginBottom: 4 }}>
                        Tip goes to
                      </div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
                        {TIP_ALLOCATIONS.map((opt) => (
                          <label key={opt.value} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, cursor: "pointer" }}>
                            <input type="radio" name="cardTipAlloc" checked={cardAllocation === opt.value} onChange={() => setCardAllocation(opt.value)} />
                            {opt.label}
                          </label>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
              {/* Coupon / discount inputs removed — applied via cart's
                  Apply-benefit flyout. */}
            </div>

            <div style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
              {isGiftCard ? (
                <div style={{ flex: 1, display: "grid", gap: 10, alignContent: "start" }}>
                  <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--ink-500)" }}>Gift card</div>
                  {!gcCard ? (
                    <>
                      <input value={gcCode} onChange={(e) => setGcCode(e.target.value.toUpperCase())} onKeyDown={(e) => { if (e.key === "Enter") handleGcLookup(); }} placeholder="Card code" autoComplete="off" style={{ fontSize: 15, padding: "12px 14px", border: "1.5px solid var(--ink-300)", borderRadius: 8, fontFamily: "var(--font-mono)", fontWeight: 800 }} />
                      <button type="button" className="a-btn a-btn--secondary" onClick={handleGcLookup} disabled={gcLooking || !gcCode.trim()} style={{ justifyContent: "center", minHeight: 48 }}>
                        <Icon name="search" size={16} /> {gcLooking ? "Looking…" : "Look up card"}
                      </button>
                    </>
                  ) : (
                    <div style={{ border: "1.5px solid var(--ink-300)", borderRadius: 10, padding: 12, background: "white", display: "grid", gap: 6 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontFamily: "var(--font-mono)", fontWeight: 900 }}>
                        <span>{gcCard.code}</span>
                        <button type="button" onClick={() => setGcCard(null)} title="Use a different card" style={{ all: "unset", cursor: "pointer", color: "var(--ink-500)" }}><Icon name="x" size={14} /></button>
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}><span>Card balance</span><span style={{ fontWeight: 800 }}>{moneyFmt(gcBalance)}</span></div>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}><span>Applies to order</span><span style={{ fontWeight: 900, color: "#137A35" }}>{moneyFmt(gcApply)}</span></div>
                      {remaining > 0 && <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "#B83210" }}><span>Balance remaining</span><span style={{ fontWeight: 800 }}>{moneyFmt(remaining)}</span></div>}
                    </div>
                  )}
                </div>
              ) : (
              <>
              <div style={{ flex: 1, minHeight: 138, background: "#E9F3F6", border: "1.5px solid var(--ink-300)", marginBottom: 8, padding: 8, fontSize: 13, fontWeight: 800 }}>
                <div style={{ display: "flex", justifyContent: "space-between", color: "#0A75D9" }}>
                  <span>{method === "cash" ? "Cash" : methods.find((m) => m.value === method)?.label || method}</span>
                  <span>{moneyFmt(tendered)}</span>
                </div>
                {isCash && cashTenders.length > 0 && (
                  <div style={{ marginTop: 8, display: "grid", gap: 4 }}>
                    {cashTenders.map((entry) => (
                      <div key={entry.value} style={{ display: "flex", justifyContent: "space-between", color: "var(--ink-800)", fontWeight: 900 }}>
                        <span>{entry.count} x {entry.value >= 1 ? `$${entry.value}` : entry.value === 0.25 ? "Qtt" : entry.value === 0.1 ? "Dime" : moneyFmt(entry.value)}</span>
                        <span>{moneyFmt(entry.count * entry.value)}</span>
                      </div>
                    ))}
                  </div>
                )}
                {discountAmount > 0 && (
                  <div style={{ display: "flex", justifyContent: "space-between", color: "#F45B0A", marginTop: 6 }}>
                    <span>{discount?.label || "Promo"}</span>
                    <span>-{moneyFmt(discountAmount)}</span>
                  </div>
                )}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr) 1fr 1fr", gap: 4 }}>
                {keypad.map((key) => (
                  <button key={key} type="button" onClick={() => appendDigit(key)} style={{ minHeight: 54, border: "1px solid var(--ink-200)", background: "white", borderRadius: 7, fontSize: 22, fontWeight: 900, cursor: "pointer" }}>
                    {key}
                  </button>
                ))}
                {quickCash.map((cash) => (
                  <button key={cash} type="button" onClick={() => addTender(cash)} style={{ minHeight: 54, border: "1.5px solid #51B800", background: "#65E600", borderRadius: 7, fontSize: 20, fontWeight: 900, cursor: "pointer" }}>
                    ${cash}
                  </button>
                ))}
                {coinTender.map((coin) => (
                  <button key={coin.label} type="button" onClick={() => addTender(coin.value)} style={{ minHeight: 54, border: "1.5px solid #A96D00", background: "#D99316", color: "#111", borderRadius: 7, fontSize: 15, fontWeight: 900, cursor: "pointer" }}>
                    {coin.label}
                  </button>
                ))}
                <button type="button" onClick={() => { onAmountChange(""); setCashTenders([]); }} style={{ minHeight: 54, border: "1px solid var(--ink-200)", background: "white", borderRadius: 7, fontSize: 20, fontWeight: 900, cursor: "pointer" }}>
                  Clear
                </button>
                <button type="button" onClick={() => { onAmountChange(String(amount || "").slice(0, -1)); setCashTenders([]); }} style={{ minHeight: 54, border: "1px solid var(--ink-200)", background: "white", borderRadius: 7, fontSize: 18, fontWeight: 900, cursor: "pointer" }}>
                  <Icon name="delete" size={18} />
                </button>
              </div>
              </>
              )}
              <button type="button" className="a-btn a-btn--primary"
                onClick={isGiftCard ? () => onGiftCardSubmit?.({ code: gcCode, amount: gcApply }) : onSubmit}
                disabled={isSubmitting || gcRedeeming || (isGiftCard && !gcCard)}
                style={{ width: "100%", justifyContent: "center", minHeight: 52, marginTop: 8, fontSize: 16 }}>
                <Icon name="check" size={16} />
                {(isSubmitting || gcRedeeming)
                  ? "Recording..."
                  : isGiftCard
                    ? `Pay ${moneyFmt(gcApply)} by gift card`
                    : remaining > 0 && recordAmount > 0
                      ? `Record ${moneyFmt(recordAmount)}`
                      : "Complete The Order"}
              </button>
            </div>
          </div>
        )}
      </div>
      <ManagerOverridePrompt
        open={managerOpen}
        title="Approve manager promo"
        description={`Apply ${moneyFmt(Math.min(Number(manualDiscount), balanceDue))} discount to ${displayText(booking.bookingNumber, "booking")}.`}
        action="pos_manager_discount"
        targetType="booking"
        targetId={booking.bookingId}
        payload={{ amount: roundMoney(Math.min(Number(manualDiscount), balanceDue)) }}
        defaultReason="POS check-in manager promo"
        onCancel={() => setManagerOpen(false)}
        onApprove={(audit) => {
          const amt = roundMoney(Math.min(Number(manualDiscount), balanceDue));
          onDiscountChange({ amount: amt, label: "Manager promo", source: "manager", managerName: audit?.managerName });
          onAmountChange(method === "cash" ? "" : roundMoney(Math.max(0, balanceDue - amt)).toFixed(2));
          setManagerOpen(false);
        }}
      />
    </div>
  );
}

function TotalLine({ label, value, tone }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, color: tone || "var(--ink-900)", margin: "3px 0" }}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}

export default CheckInPaymentModal;
export { TotalLine, buildBookingPromoCartLines };
