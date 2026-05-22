// Self-contained Take Payment dialog used by the POS sell flow after
// createBooking succeeds. Mirrors the check-in screen's payment modal
// (same recordPayment endpoint, same payment methods, same cash-drawer
// trigger) so the cashier sees identical UX in both places.
//
// Internally manages amount/method/note/discount state and the API call.
// Caller just supplies the freshly-created booking and two callbacks.

import React, { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Icon } from "./Icon";
import {
  useRecordPaymentMutation,
  useSendBookingConfirmationMutation,
} from "../../features/bookings/bookingApi";
import { useLazyValidateDiscountCodeQuery } from "../../features/discount/discountApi";
import {
  useLazyLookupGiftCardQuery,
  useRedeemGiftCardMutation,
} from "../../features/vouchers/voucherApi";
import ManagerOverridePrompt from "../../components/ManagerOverridePrompt";
import { getTerminal } from "../../lib/terminal";
import { openCashDrawer, printReceipt } from "../../lib/hardware";
import { moneyFmt, roundMoney } from "../../lib/money";

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

// Cash-drawer + receipt-print logic lives in src/lib/hardware.js so the
// CheckIn screen and any future payment surface share the same ack +
// fallback semantics.

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
  onCompleteDraft,    // (payment) => Promise<booking summary> — POS draft sale
}) {
  const [recordPayment, { isLoading: isSubmitting }] = useRecordPaymentMutation();
  const [sendBookingConfirmation, { isLoading: sendingReceipt }] = useSendBookingConfirmationMutation();
  const [validateDiscountCode] = useLazyValidateDiscountCodeQuery();
  const [lookupGiftCard, { isFetching: gcLooking }] = useLazyLookupGiftCardQuery();
  const [redeemGiftCard, { isLoading: gcRedeeming }] = useRedeemGiftCardMutation();

  const [method, setMethod] = useState("card");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [discount, setDiscount] = useState(null);
  const [complete, setComplete] = useState(null);
  const [couponCode, setCouponCode] = useState("");
  const [manualDiscount, setManualDiscount] = useState("");
  const [managerOpen, setManagerOpen] = useState(false);
  const [draftSubmitting, setDraftSubmitting] = useState(false);
  // Gift card tender: looked-up card + its code/PIN (needed again at redeem).
  const [gcCode, setGcCode] = useState("");
  const [gcPin, setGcPin] = useState("");
  const [gcCard, setGcCard] = useState(null);
  // Idempotency: one base key per opened dialog (per booking attempt).
  // Sub-scoped (":discount", ":payment") when used so the two recordPayment
  // calls have independent dedupe identities. Retrying after a failed
  // second call replays the same ":payment" key, so the backend can
  // dedupe without double-charging the booking.
  const [sessionKey, setSessionKey] = useState(null);
  // Receipt recipient. Pre-filled from any known booking/customer email;
  // for a walk-in (no email captured) the cashier can type one here and Send.
  const [receiptEmail, setReceiptEmail] = useState("");

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
    setDraftSubmitting(false);
    setGcCode("");
    setGcPin("");
    setGcCard(null);
    setReceiptEmail(
      booking?.guestEmail ||
        booking?.guest?.guestEmail ||
        booking?.draft?.payload?.guestEmail ||
        ""
    );
    // Mint a key now so handleSubmit and any retry share the same one.
    // crypto.randomUUID is available in all modern browsers / Electron
    // / WebView 2 — safe for kiosks.
    const id = (typeof crypto !== "undefined" && crypto.randomUUID)
      ? crypto.randomUUID()
      : `pay_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    setSessionKey(`pay_${id}`);
  }, [open, booking?.bookingId]);

  // NOTE: All hooks must run on every render. The early return below
  // would skip these, producing a "Rendered more hooks than during the
  // previous render" crash when `open` flips false→true (i.e. every
  // time the cashier clicks "Take payment"). buildBookingPromoCartLines
  // safely handles a null booking (optional chaining + Array.isArray
  // guards), so calling it eagerly is fine.
  const promoCartLines = useMemo(() => buildBookingPromoCartLines(booking), [booking]);

  // Synchronous double-submit guard. The React `isBusy` flag only flips
  // after the next render, leaving a tiny window where a fast double-tap
  // can fire two parallel handleSubmit invocations. The ref flips
  // immediately so the second tap exits before any await.
  const submitLockRef = useRef(false);

  if (!open || !booking) return null;

  const balanceDue = Number(booking.balanceDue ?? booking.totalAmount ?? 0);
  const subTotal = Number(booking.subTotal ?? booking.subtotal ?? balanceDue);
  const taxAmount = Number(booking.taxAmount ?? booking.tax ?? 0);
  const cartDiscountAmount = roundMoney(booking.discountAmount ?? booking.discount?.amount ?? 0);
  const discountAmount = roundMoney(Math.min(Number(discount?.amount || 0), balanceDue));
  const payableBalance = roundMoney(Math.max(0, balanceDue - discountAmount));
  const totalDiscountShown = roundMoney(cartDiscountAmount + discountAmount);
  const tendered = Number(amount) || 0;
  const isCash = method === "cash";
  const isGiftCard = method === "gift_card";
  // Gift card pays up to its remaining balance (partial allowed; any
  // shortfall stays as the booking's balance due).
  const gcBalance = roundMoney(Number(gcCard?.currentBalance || 0));
  const gcApply = isGiftCard && gcCard ? roundMoney(Math.min(payableBalance, gcBalance)) : 0;
  const recordAmount = isCash ? Math.min(payableBalance, tendered) : isGiftCard ? gcApply : tendered;
  const remaining = Math.max(0, payableBalance - recordAmount);
  const changeDue = isCash ? Math.max(0, tendered - payableBalance) : 0;
  const isDraftSale = booking?.draftSale === true;
  const isBusy = isSubmitting || draftSubmitting || gcLooking || gcRedeeming;

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
    // Gift card amount is driven by the looked-up card, not the keypad.
    setAmount(next === "cash" || next === "gift_card" ? "" : payableBalance.toFixed(2));
    if (next !== "gift_card") setGcCard(null);
  };

  const handleGcLookup = async () => {
    const code = gcCode.trim();
    const pin = gcPin.trim();
    if (!code || !pin) {
      toast.error("Enter gift card code and PIN.");
      return;
    }
    try {
      const res = await lookupGiftCard({ code, pin }).unwrap();
      const card = res?.data;
      if (!card) { toast.error("Card not found."); return; }
      if (String(card.status || "").toLowerCase() !== "active") {
        toast.error(`Card is ${card.status || "unavailable"}.`);
        return;
      }
      if (Number(card.currentBalance || 0) <= 0) {
        toast.error("Card has no balance.");
        return;
      }
      setGcCard(card);
      toast.success(`Gift card balance ${moneyFmt(card.currentBalance)}`);
    } catch (err) {
      toast.error(err?.data?.message || err?.data?.error || "Gift card lookup failed.");
    }
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
    if (submitLockRef.current) return;

    // ── Gift card tender ──────────────────────────────────────────────
    // The gift-cards/redeem endpoint atomically decrements the card AND
    // records the payment on the booking, so we don't use recordPayment for
    // the gift-card amount. For a draft sale we first create the booking
    // (unpaid) so we have a bookingId to redeem against.
    if (isGiftCard) {
      if (!gcCard) { toast.error("Look up the gift card first."); return; }
      if (gcApply <= 0) { toast.error("Gift card has no balance to apply."); return; }
      submitLockRef.current = true;
      const terminal = getTerminal();
      try {
        let bookingId = booking?.bookingId || null;
        let receiptInfo = null;
        if (isDraftSale) {
          setDraftSubmitting(true);
          const result = await onCompleteDraft?.({
            paymentMethod: "gift_card",
            giftCard: true, // completeDraftCheckout: create UNPAID, skip payment payload
            discountAmount,
            discount,
            note,
            remarks: note || "Gift card payment at POS sell",
          });
          bookingId = result?.bookingId || null;
          receiptInfo = result || {};
          if (!bookingId) throw new Error("Booking could not be created.");
        } else if (discountAmount > 0) {
          // Existing booking: record the POS discount as complimentary first.
          await recordPayment({
            bookingId,
            amountPaid: discountAmount,
            paymentMethod: "complimentary",
            terminalDeviceId: terminal?.deviceId || null,
            remarks: [
              `POS discount applied: ${discount?.label || "Discount"}`,
              discount?.code ? `Code ${discount.code}.` : "",
              discount?.managerName ? `Approved by ${discount.managerName}.` : "",
            ].filter(Boolean).join(" "),
            idempotencyKey: sessionKey ? `${sessionKey}:discount` : undefined,
          }).unwrap();
        }
        const gc = await redeemGiftCard({
          code: gcCode.trim(),
          pin: gcPin.trim(),
          amount: gcApply,
          bookingId,
          note: note || "POS gift card payment",
        }).unwrap();
        const balanceAfter = Number(gc?.data?.balanceAfter ?? 0);
        setComplete({
          ...(receiptInfo || {}),
          bookingId,
          amountPaid: roundMoney(gcApply),
          discountAmount: totalDiscountShown,
          discountLabel: discount?.label || booking.discount?.name || null,
          paymentAmount: gcApply,
          paymentMethod: "gift_card",
          giftCardBalanceAfter: balanceAfter,
          balanceRemaining: remaining,
          changeDue: 0,
        });
        toast.success(
          remaining > 0
            ? `${moneyFmt(gcApply)} on gift card · ${moneyFmt(remaining)} still due`
            : `${moneyFmt(gcApply)} paid by gift card`
        );
      } catch (err) {
        toast.error(err?.data?.message || err?.data?.error || "Gift card payment failed.");
      } finally {
        setDraftSubmitting(false);
        submitLockRef.current = false;
      }
      return;
    }

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
    // Lock now, synchronously, before any await. A second tap that arrives
    // before isBusy flips will hit the guard at the top and exit cleanly.
    submitLockRef.current = true;
    const finalRecord = isCash ? payableBalance : tendered;
    const cashRemark = isCash
      ? `Cash tendered ${moneyFmt(tendered)}; change due ${moneyFmt(changeDue)}.`
      : "";
    const terminal = getTerminal();
    // Tracks whether we've already committed the discount. If the tender
    // call fails after this, the cashier sees a clear partial-paid message
    // (instead of a generic "Could not record payment") and can retry —
    // idempotency keys on each call ensure no double-charge.
    let discountCommitted = false;

    try {
      if (isDraftSale) {
        setDraftSubmitting(true);
        const result = await onCompleteDraft?.({
          amountPaid: finalRecord,
          paymentMethod: method,
          tenderedAmount: tendered,
          changeDue,
          terminalDeviceId: terminal?.deviceId || null,
          discountAmount,
          discount,
          note,
          remarks: [note || "Payment recorded at POS sell", cashRemark].filter(Boolean).join(" "),
        });
        if (isCash && finalRecord > 0) {
          openCashDrawer({ bookingId: result?.bookingId || null, terminal });
        }
        setComplete({
          ...(result || {}),
          amountPaid: roundMoney(finalRecord),
          discountAmount: totalDiscountShown,
          discountLabel: discount?.label || booking.discount?.name || null,
          paymentAmount: finalRecord,
          paymentMethod: method,
          tenderedAmount: tendered,
          changeDue,
          drawerOpened: isCash && finalRecord > 0,
        });
        toast.success(isCash ? `${moneyFmt(finalRecord)} recorded · drawer opened` : `${moneyFmt(finalRecord)} recorded`);
        return;
      }

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
          idempotencyKey: sessionKey ? `${sessionKey}:discount` : undefined,
        }).unwrap();
        discountCommitted = true;
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
          idempotencyKey: sessionKey ? `${sessionKey}:payment` : undefined,
        }).unwrap();
      }
      if (isCash && finalRecord > 0) {
        openCashDrawer({ bookingId: booking.bookingId, terminal });
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
      const baseMsg = err?.data?.message || err?.data?.error || "Could not record payment";
      if (discountCommitted) {
        // The discount call succeeded but the tender call failed. The
        // booking is now in a partial-paid state. Idempotency on both
        // keys means retrying handleSubmit replays only the tender call
        // (the discount returns the cached record); make this explicit
        // so the cashier knows it's safe to hit "Complete order" again.
        toast.error(`Discount was applied but the payment did not record. Tap "Complete order" to retry. ${baseMsg}`);
      } else {
        toast.error(baseMsg);
      }
    } finally {
      setDraftSubmitting(false);
      submitLockRef.current = false;
    }
  };

  const handleEmailReceipt = async () => {
    const receiptBookingId = booking?.bookingId || complete?.bookingId;
    if (!receiptBookingId) return;
    const email = receiptEmail.trim();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      toast.error("Enter a valid email address.");
      return;
    }
    const promise = sendBookingConfirmation({ bookingId: receiptBookingId, email }).unwrap();
    toast.promise(promise, {
      loading: "Sending receipt...",
      success: `Receipt emailed to ${email}`,
      error: (err) => err?.data?.message || err?.data?.error || "Could not email receipt",
    });
  };

  // Try the kiosk's printer agent first; fall back to the OS print
  // dialog if the agent doesn't ack within 2s. See src/lib/hardware.js.
  const handlePrint = () => {
    const terminal = getTerminal();
    printReceipt({
      bookingId: booking?.bookingId || complete?.bookingId,
      bookingNumber: booking?.bookingNumber || complete?.bookingNumber,
      terminal,
    });
  };

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
                {booking.bookingNumber || (isDraftSale ? "DRAFT SALE" : "—")}
              </div>
              <div style={{ fontSize: 20, fontWeight: 900, color: "var(--ink-900)", marginTop: 2 }}>
                {complete ? "Payment complete" : isDraftSale ? "Checkout payment" : "Take payment"}
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
            {/* Email receipt — type any address (walk-ins have none on file). */}
            {(booking?.bookingId || complete?.bookingId) && (
              <div style={{ marginTop: 16 }}>
                <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: ".06em",
                  textTransform: "uppercase", color: "var(--ink-500)", marginBottom: 6 }}>
                  Email receipt
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <input
                    type="email"
                    inputMode="email"
                    autoComplete="email"
                    value={receiptEmail}
                    onChange={(e) => setReceiptEmail(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") handleEmailReceipt(); }}
                    placeholder="customer@email.com"
                    style={{ flex: 1, fontSize: 14, padding: "10px 12px",
                      border: "1.5px solid var(--ink-200)", borderRadius: 8 }}
                  />
                  <button type="button" className="a-btn a-btn--secondary"
                    onClick={handleEmailReceipt} disabled={sendingReceipt}>
                    <Icon name="mail" size={14} /> {sendingReceipt ? "Sending…" : "Send"}
                  </button>
                </div>
              </div>
            )}
            <div style={{ display: "flex", gap: 10, marginTop: 16, justifyContent: "center" }}>
              <button type="button" className="a-btn a-btn--secondary" onClick={handlePrint}>
                <Icon name="printer" size={14} /> Print
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
                {totalDiscountShown > 0 && (
                  <>
                    <span style={{ color: "#137A35" }}>Discount {discount?.label || booking.discount?.name ? `· ${discount?.label || booking.discount?.name}` : ""}</span>
                    <span style={{ color: "#137A35" }}>−{moneyFmt(totalDiscountShown)}</span>
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
              {isGiftCard ? (
                <div style={{ display: "grid", gap: 10 }}>
                  <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: ".06em",
                    textTransform: "uppercase", color: "var(--ink-500)" }}>Gift card</div>
                  {!gcCard ? (
                    <>
                      <input value={gcCode} onChange={(e) => setGcCode(e.target.value.toUpperCase())}
                        onKeyDown={(e) => { if (e.key === "Enter") handleGcLookup(); }}
                        placeholder="Card code" autoComplete="off"
                        style={{ fontSize: 15, padding: "12px 14px", border: "1.5px solid var(--ink-200)", borderRadius: 8, fontFamily: "var(--font-mono)", fontWeight: 800 }} />
                      <input value={gcPin} onChange={(e) => setGcPin(e.target.value.replace(/\D/g, ""))}
                        onKeyDown={(e) => { if (e.key === "Enter") handleGcLookup(); }}
                        placeholder="PIN" inputMode="numeric" maxLength={6} type="password" autoComplete="off"
                        style={{ fontSize: 15, padding: "12px 14px", border: "1.5px solid var(--ink-200)", borderRadius: 8 }} />
                      <button type="button" className="a-btn a-btn--secondary" onClick={handleGcLookup}
                        disabled={gcLooking || !gcCode.trim() || !gcPin.trim()}
                        style={{ justifyContent: "center", minHeight: 48 }}>
                        <Icon name="search" size={16} /> {gcLooking ? "Looking…" : "Look up card"}
                      </button>
                    </>
                  ) : (
                    <div style={{ border: "1.5px solid var(--ink-200)", borderRadius: 10, padding: 12, background: "white", display: "grid", gap: 6 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontFamily: "var(--font-mono)", fontWeight: 900 }}>
                        <span>{gcCard.code}</span>
                        <button type="button" onClick={() => setGcCard(null)} title="Use a different card"
                          style={{ all: "unset", cursor: "pointer", color: "var(--ink-500)" }}>
                          <Icon name="x" size={14} />
                        </button>
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                        <span>Card balance</span><span style={{ fontWeight: 800 }}>{moneyFmt(gcBalance)}</span>
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                        <span>Applies to order</span><span style={{ fontWeight: 900, color: "#137A35" }}>{moneyFmt(gcApply)}</span>
                      </div>
                      {remaining > 0 && (
                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "#B83210" }}>
                          <span>Balance remaining</span><span style={{ fontWeight: 800 }}>{moneyFmt(remaining)}</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ) : (
              <>
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
                      style={{
                        minHeight: 48,
                        border: "1px solid var(--ink-200)", background: "white",
                        borderRadius: 7, fontSize: 14, fontWeight: 800, cursor: "pointer",
                      }}>
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
              </>
              )}
              <button type="button" className="a-btn a-btn--primary" onClick={handleSubmit}
                disabled={isBusy || (isGiftCard && !gcCard)}
                style={{ width: "100%", justifyContent: "center", minHeight: 52, marginTop: 10, fontSize: 16 }}>
                <Icon name="check" size={16} />
                {isBusy ? "Completing…" : isGiftCard ? `Pay ${moneyFmt(gcApply)} by gift card` : `Complete order · ${moneyFmt(payableBalance)}`}
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
          targetId={booking.bookingId || "draft-sale"}
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
