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
import TerminalProgressModal from "./TerminalProgressModal";
import TipStep from "../../features/tips/TipStep";
import { useTipDefaults } from "../../features/tips/useTipDefaults";
import { useStandaloneTipMutation } from "../../features/tips/tipsApi";
import { computeTipBase } from "../../features/tips/tipMath";
import { getTerminal } from "../../lib/terminal";
import { openCashDrawer, printReceipt } from "../../lib/hardware";
import { moneyFmt, roundMoney } from "../../lib/money";
import { createIdempotencyKey } from "../../lib/idempotency";

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

// Gift card is NOT a method here — it's an applied CREDIT (see the gift-card
// panel). These are the tenders that settle whatever remains after the gift
// card, so a gift card + cash/card/check is one flow (split tender).
const PAYMENT_METHODS = [
  { value: "cash", label: "Cash", icon: "banknote", bg: "#F23B20" },
  { value: "card", label: "Credit / Debit", icon: "credit-card", bg: "#FF8A00" },
  { value: "check", label: "Check", icon: "receipt", bg: "#D8D8D8", fg: "#111" },
];
const QUICK_CASH = [1, 5, 10, 20, 50, 100];
const KEYPAD = ["7", "8", "9", "4", "5", "6", "1", "2", "3", "0", "00", "."];

const cashTenderLabel = (value) => {
  const amount = Number(value) || 0;
  if (amount >= 1) return `$${amount}`;
  if (amount === 0.25) return "Quarter";
  if (amount === 0.1) return "Dime";
  if (amount === 0.05) return "Nickel";
  return moneyFmt(amount);
};

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
  const tipDefaults = useTipDefaults();
  const [standaloneTip] = useStandaloneTipMutation();

  const [method, setMethod] = useState("card");
  const [amount, setAmount] = useState("");
  const [cashTenders, setCashTenders] = useState([]);
  const [note, setNote] = useState("");
  const [discount, setDiscount] = useState(null);
  const [complete, setComplete] = useState(null);
  const [couponCode, setCouponCode] = useState("");
  const [manualDiscount, setManualDiscount] = useState("");
  const [managerOpen, setManagerOpen] = useState(false);
  const [draftSubmitting, setDraftSubmitting] = useState(false);
  // Gift card tender: looked-up card + its code.
  const [gcCode, setGcCode] = useState("");
  const [gcCard, setGcCard] = useState(null);
  // Applied gift-card credit: { code, amount }. When set, the gift card
  // covers up to its balance and the method below settles the remainder.
  const [gcApplied, setGcApplied] = useState(null);
  // Check tender: capture the check number (stored as the payment reference).
  const [checkNumber, setCheckNumber] = useState("");
  // Tip (gratuity). Recorded as a dedicated tip-only transaction after the
  // payment succeeds, so the booking total/balance never include it.
  // { amount, allocation, selectedPct, managerOverrideAuditId }
  const [tip, setTip] = useState({ amount: 0, allocation: "booking_host", selectedPct: null, managerOverrideAuditId: null });
  // Idempotency: one base key per opened dialog (per booking attempt).
  // Sub-scoped (":discount", ":payment") when used so the two recordPayment
  // calls have independent dedupe identities. Retrying after a failed
  // second call replays the same ":payment" key, so the backend can
  // dedupe without double-charging the booking.
  const [sessionKey, setSessionKey] = useState(null);
  // Receipt recipient. Pre-filled from any known booking/customer email;
  // for a walk-in (no email captured) the cashier can type one here and Send.
  const [receiptEmail, setReceiptEmail] = useState("");
  // Card-on-terminal: when method='card' and the backend opens a sale on
  // the pin-pad, we hold the pending state here and render
  // <TerminalProgressModal> until the cardholder taps or the cashier
  // cancels. Shape: { transactionId, amount, instructions } or null.
  const [pendingTerminal, setPendingTerminal] = useState(null);

  // Reset every time a new booking is opened.
  useEffect(() => {
    if (!open) return;
    const due = Number(booking?.balanceDue ?? booking?.totalAmount ?? 0);
    setMethod("card");
    setAmount(due.toFixed(2));
    setCashTenders([]);
    setNote("");
    setDiscount(null);
    setComplete(null);
    setCouponCode("");
    setManualDiscount("");
    setDraftSubmitting(false);
    setGcCode("");
    setGcCard(null);
    setGcApplied(null);
    setCheckNumber("");
    setTip({ amount: 0, allocation: tipDefaults.defaultAllocation || "booking_host", selectedPct: null, managerOverrideAuditId: null });
    setReceiptEmail(
      booking?.guestEmail ||
        booking?.guest?.guestEmail ||
        booking?.draft?.payload?.guestEmail ||
        ""
    );
    // Mint a key now so handleSubmit and any retry share the same one.
    // crypto.randomUUID is available in all modern browsers / Electron
    // / WebView 2 — safe for kiosks.
    setSessionKey(createIdempotencyKey("cashier-payment"));
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
  // Gift card credit applied to the order (clamped to the current payable
  // balance — a discount may have been applied after the card was looked up).
  const gcBalance = roundMoney(Number(gcCard?.currentBalance || 0));
  const giftApplied = gcApplied ? roundMoney(Math.min(Number(gcApplied.amount || 0), payableBalance)) : 0;
  // What cash / card / check must still settle AFTER the gift card credit.
  // This is the split-tender remainder (0 when the card covers the order).
  const remainingAfterGift = roundMoney(Math.max(0, payableBalance - giftApplied));
  const tendered = Number(amount) || 0;
  const isCash = method === "cash";
  const isCheck = method === "check";
  const methodRecord = remainingAfterGift > 0 ? (isCash ? Math.min(remainingAfterGift, tendered) : tendered) : 0;
  const changeDue = isCash && remainingAfterGift > 0 ? Math.max(0, tendered - remainingAfterGift) : 0;
  const isDraftSale = booking?.draftSale === true;
  const isBusy = isSubmitting || draftSubmitting || gcLooking || gcRedeeming;

  // Tip is offered for the cash/check settle step (card tips are collected
  // on the pin-pad). A tip is its own `tips`-table record now (decoupled
  // from the tender), so it's offered EVEN when a gift card is applied —
  // i.e. gift-card + cash/check split tender can still leave a tip.
  const showTip = tipDefaults.enabled && (isCash || isCheck);
  // Base the % buttons compute on: the amount being paid now, or the full
  // booking total, per the location's calculateTipsOnBookingTotal setting.
  const tipBase = computeTipBase({
    subtotal: remainingAfterGift > 0 ? remainingAfterGift : payableBalance,
    bookingTotal: Number(booking.totalAmount ?? balanceDue),
    calcOnTotal: tipDefaults.calcOnBookingTotal,
  });
  const tipAmount = showTip ? roundMoney(tip.amount || 0) : 0;

  // Record the tip as a dedicated `tips`-table row (no PaymentTransaction)
  // once the booking exists and is paid. Non-fatal: the sale is complete
  // regardless, so a failure just nudges the cashier to use "Add tip" later.
  const recordTipIfAny = async (bid, attemptKey) => {
    if (!bid || tipAmount <= 0 || !(isCash || isCheck)) return null;
    try {
      const res = await standaloneTip({
        bookingId: bid,
        tipAmount,
        method: isCheck ? "check" : "cash",
        allocation: tip.allocation,
        defaultAllocation: tipDefaults.defaultAllocation,
        managerOverrideAuditId: tip.managerOverrideAuditId || undefined,
        source: "checkout",
        idempotencyKey: `${attemptKey}:tip`,
      }).unwrap();
      return res?.data || null;
    } catch (err) {
      toast.error(
        `Payment recorded, but the tip didn't save (${err?.data?.message || err?.data?.error || "use Add tip on the booking"}).`
      );
      return null;
    }
  };

  const addTender = (v) => {
    const value = Number(v) || 0;
    if (value <= 0) return;
    setAmount(roundMoney((Number(amount) || 0) + value).toFixed(2));
    setCashTenders((prev) => {
      const idx = prev.findIndex((entry) => Number(entry.value) === value);
      if (idx < 0) return [...prev, { value, count: 1 }];
      const next = [...prev];
      next[idx] = { ...next[idx], count: next[idx].count + 1 };
      return next;
    });
  };
  const appendDigit = (digit) => {
    if (isCash && cashTenders.length > 0) setCashTenders([]);
    const cur = String(amount || "");
    if (digit === "." && cur.includes(".")) return;
    const next = cur === "0" && digit !== "." ? digit : `${cur}${digit}`;
    setAmount(next);
  };
  const handleMethodChange = (next) => {
    setMethod(next);
    setCashTenders([]);
    // The method tender settles whatever remains after the gift-card credit.
    setAmount(next === "cash" ? "" : remainingAfterGift.toFixed(2));
  };

  const handleGcLookup = async () => {
    const code = gcCode.trim();
    if (!code) {
      toast.error("Enter gift card code.");
      return;
    }
    try {
      // Venue policy: no PIN. Backend lookup tolerates the missing
      // field — PIN check is conditional on a non-empty pin.
      const res = await lookupGiftCard({ code }).unwrap();
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

  // Apply the looked-up card as a credit (up to its balance / the order total).
  // Whatever is left becomes the cash/card/check remainder — that's the split.
  const applyGiftCard = () => {
    if (!gcCard) return;
    const amt = roundMoney(Math.min(Number(gcCard.currentBalance || 0), payableBalance));
    if (amt <= 0) { toast.error("Gift card has no balance to apply."); return; }
    setGcApplied({ code: gcCode.trim(), amount: amt });
    const rem = roundMoney(Math.max(0, payableBalance - amt));
    setAmount(method === "cash" ? "" : rem.toFixed(2));
    toast.success(
      rem > 0
        ? `${moneyFmt(amt)} gift card applied · ${moneyFmt(rem)} remaining`
        : `${moneyFmt(amt)} gift card covers the order`
    );
  };
  const removeGiftCard = () => {
    setGcApplied(null);
    setGcCard(null);
    setGcCode("");
    setAmount(method === "cash" ? "" : payableBalance.toFixed(2));
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

    const hasGift = giftApplied > 0 && !!gcApplied;
    const needRemainder = remainingAfterGift > 0;

    // Validate the remainder tender (cash / card / check), if there is one.
    if (needRemainder) {
      if (!Number.isFinite(tendered) || tendered <= 0) {
        toast.error(isCash ? "Enter cash received." : "Enter a payment amount.");
        return;
      }
      if (isCash && tendered < remainingAfterGift) {
        toast.error(`Cash received must cover ${moneyFmt(remainingAfterGift)}.`);
        return;
      }
      if (!isCash && tendered > remainingAfterGift) {
        toast.error(`Amount cannot exceed ${moneyFmt(remainingAfterGift)}.`);
        return;
      }
      if (isCheck && !checkNumber.trim()) {
        toast.error("Enter the check number.");
        return;
      }
    } else if (!hasGift && payableBalance > 0) {
      toast.error("Enter a payment amount.");
      return;
    }

    // useEffect normally creates this when the dialog opens. Ensure it again
    // synchronously for the first-render/fast-click edge case, then use the
    // same base key for every retry of this checkout attempt.
    const attemptKey =
      sessionKey || createIdempotencyKey("cashier-payment");
    if (!sessionKey) setSessionKey(attemptKey);

    // Lock now, synchronously, before any await.
    submitLockRef.current = true;
    const terminal = getTerminal();
    const methodAmount = isCash ? remainingAfterGift : (needRemainder ? tendered : 0);
    const cashRemark = isCash && needRemainder
      ? `Cash tendered ${moneyFmt(tendered)}; change due ${moneyFmt(changeDue)}.`
      : "";
    const checkRemark = isCheck && needRemainder ? `Check #${checkNumber.trim()}.` : "";
    const methodRef = isCheck && needRemainder ? `CHK-${checkNumber.trim()}` : undefined;
    const methodRemarks = [note || "Payment recorded at POS sell", cashRemark, checkRemark].filter(Boolean).join(" ");
    const discountRemarks = [
      `POS discount applied: ${discount?.label || "Discount"}`,
      discount?.code ? `Code ${discount.code}.` : "",
      discount?.managerName ? `Approved by ${discount.managerName}.` : "",
    ].filter(Boolean).join(" ");
    // Tracks whether the discount call already committed so a later failure
    // surfaces a clear partial-paid retry message (idempotency prevents dupes).
    let discountCommitted = false;

    try {
      // ── Path A: gift card applied (covers all, or split with a method) ──
      if (hasGift) {
        let bookingId = booking?.bookingId || null;
        let receiptInfo = null;
        if (isDraftSale) {
          setDraftSubmitting(true);
          // Create the booking UNPAID, then settle with gift card (+remainder).
          const result = await onCompleteDraft?.({
            giftCard: true,
            discountAmount,
            discount,
            note,
            remarks: note || "Split tender at POS sell",
          });
          bookingId = result?.bookingId || null;
          receiptInfo = result || {};
          if (!bookingId) throw new Error("Booking could not be created.");
        } else if (discountAmount > 0) {
          await recordPayment({
            bookingId,
            amountPaid: discountAmount,
            paymentMethod: "complimentary",
            terminalDeviceId: terminal?.deviceId || null,
            remarks: discountRemarks,
            idempotencyKey: `${attemptKey}:discount`,
          }).unwrap();
          discountCommitted = true;
        }
        // Redeem the gift-card portion (records its own payment on the booking).
        const gc = await redeemGiftCard({
          code: gcApplied.code,
          ...(gcApplied.pin ? { pin: gcApplied.pin } : {}),
          amount: giftApplied,
          bookingId,
          idempotencyKey: `${attemptKey}:gift-card`,
          note: note || "POS gift card payment",
        }).unwrap();
        const balanceAfter = Number(gc?.data?.balanceAfter ?? 0);
        // Settle the remainder (if any) with the chosen method.
        if (needRemainder && methodAmount > 0) {
          await recordPayment({
            bookingId,
            amountPaid: methodAmount,
            paymentMethod: method,
            tenderedAmount: tendered,
            changeDue,
            referenceNumber: methodRef,
            terminalDeviceId: terminal?.deviceId || null,
            remarks: methodRemarks,
            idempotencyKey: `${attemptKey}:payment`,
          }).unwrap();
          if (isCash) openCashDrawer({ bookingId, terminal });
        }
        // Tip rides on the cash/check remainder (gift-card + cash/check split).
        // Decoupled from the tender — recorded as its own tips-table row.
        await recordTipIfAny(bookingId, attemptKey);
        setComplete({
          ...(receiptInfo || {}),
          bookingId,
          amountPaid: roundMoney(giftApplied + methodAmount),
          discountAmount: totalDiscountShown,
          discountLabel: discount?.label || booking.discount?.name || null,
          paymentMethod: needRemainder ? method : "gift_card",
          giftCardAmount: giftApplied,
          giftCardBalanceAfter: balanceAfter,
          methodAmount,
          tenderedAmount: tendered,
          changeDue,
          checkNumber: isCheck && needRemainder ? checkNumber.trim() : null,
          balanceRemaining: 0,
          drawerOpened: isCash && needRemainder,
        });
        toast.success(
          needRemainder
            ? `${moneyFmt(giftApplied)} gift card + ${moneyFmt(methodAmount)} ${method}`
            : `${moneyFmt(giftApplied)} paid by gift card`
        );
        return;
      }

      // ── Path B: no gift card — cash / card / check only ──
      const finalRecord = isCash ? remainingAfterGift : tendered; // == payableBalance here
      if (isDraftSale) {
        setDraftSubmitting(true);
        const result = await onCompleteDraft?.({
          amountPaid: finalRecord,
          paymentMethod: method,
          tenderedAmount: tendered,
          changeDue,
          referenceNumber: methodRef,
          terminalDeviceId: terminal?.deviceId || null,
          discountAmount,
          discount,
          note,
          remarks: methodRemarks,
        });
        if (isCash && finalRecord > 0) {
          openCashDrawer({ bookingId: result?.bookingId || null, terminal });
        }
        await recordTipIfAny(result?.bookingId, attemptKey);
        setComplete({
          ...(result || {}),
          amountPaid: roundMoney(finalRecord),
          discountAmount: totalDiscountShown,
          discountLabel: discount?.label || booking.discount?.name || null,
          paymentMethod: method,
          methodAmount: finalRecord,
          tenderedAmount: tendered,
          changeDue,
          checkNumber: isCheck ? checkNumber.trim() : null,
          tipAmount,
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
          remarks: discountRemarks,
          idempotencyKey: `${attemptKey}:discount`,
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
          referenceNumber: methodRef,
          terminalDeviceId: terminal?.deviceId || null,
          // For card-on-terminal, pass the paired terminal id so the
          // backend can route the sale to the right pin-pad.
          terminalId: method === "card" ? (terminal?.terminalId || undefined) : undefined,
          posDeviceId: method === "card" ? (terminal?.deviceId || undefined) : undefined,
          remarks: methodRemarks,
          idempotencyKey: `${attemptKey}:payment`,
        }).unwrap();
      }
      // Card-on-terminal path: backend returns { status: 'pending', transactionId, terminalSessionId }.
      // Show the progress modal and wait for the cardholder to tap. The
      // modal calls onComplete/onCancelled/onFailed which finishes the
      // happy path (setComplete) or shows an error toast.
      if (method === "card" && res?.data?.status === "pending") {
        setPendingTerminal({
          transactionId: res.data.transactionId,
          amount: finalRecord,
          instructions: res.data.instructions,
          discountAmount,
          discountLabel: discount?.label || null,
        });
        return; // setComplete runs in the modal's onComplete handler
      }
      if (isCash && finalRecord > 0) {
        openCashDrawer({ bookingId: booking.bookingId, terminal });
      }
      await recordTipIfAny(booking.bookingId, attemptKey);
      setComplete({
        ...(res?.data || {}),
        amountPaid: roundMoney(finalRecord + discountAmount),
        discountAmount,
        discountLabel: discount?.label || null,
        paymentMethod: method,
        methodAmount: finalRecord,
        tenderedAmount: tendered,
        changeDue,
        checkNumber: isCheck ? checkNumber.trim() : null,
        tipAmount,
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
    const promise = sendBookingConfirmation({
      bookingId: receiptBookingId,
      email,
      intent: "receipt",
      actor: "cashier",
    }).unwrap();
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

  // Card-on-terminal: when a card sale is in flight, the modal owns the
  // UI until the cardholder taps, the cashier cancels, or polling times
  // out. handleSubmit setComplete()s in the captured handler so the
  // receipt + drawer logic stays in one place.
  const terminalProgressModal = pendingTerminal ? (
    <TerminalProgressModal
      transactionId={pendingTerminal.transactionId}
      amount={pendingTerminal.amount}
      bookingId={booking?.bookingId}
      instructions={pendingTerminal.instructions}
      onComplete={(result) => {
        const data = result?.data || result;
        setComplete({
          bookingId: booking?.bookingId,
          amountPaid: roundMoney(pendingTerminal.amount + (pendingTerminal.discountAmount || 0)),
          discountAmount: pendingTerminal.discountAmount || 0,
          discountLabel: pendingTerminal.discountLabel || null,
          paymentMethod: "card",
          methodAmount: pendingTerminal.amount,
          tenderedAmount: pendingTerminal.amount,
          changeDue: 0,
          providerTransactionId: data?.providerTransactionId || null,
          providerReference: data?.providerReference || null,
          balanceRemaining: 0,
        });
        setPendingTerminal(null);
        toast.success(`${moneyFmt(pendingTerminal.amount)} on card`);
      }}
      onCancelled={() => {
        setPendingTerminal(null);
        toast.info("Card payment cancelled");
      }}
      onFailed={(msg) => {
        setPendingTerminal(null);
        toast.error(msg || "Card payment failed");
      }}
    />
  ) : null;

  return (
    <>
    {terminalProgressModal}
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
                {complete.giftCardAmount > 0 && complete.methodAmount > 0
                  ? `${moneyFmt(complete.giftCardAmount)} gift card + ${moneyFmt(complete.methodAmount)} ${complete.paymentMethod}`
                  : complete.giftCardAmount > 0
                    ? `Gift card${complete.giftCardBalanceAfter != null ? ` · ${moneyFmt(complete.giftCardBalanceAfter)} left` : ""}`
                    : complete.paymentMethod === "cash"
                      ? `Cash · change due ${moneyFmt(complete.changeDue)}`
                      : `${complete.paymentMethod} payment`}
                {complete.checkNumber ? ` · Check #${complete.checkNumber}` : ""}
                {complete.discountAmount > 0 ? ` · ${moneyFmt(complete.discountAmount)} discount applied` : ""}
              </div>
              {complete.tipAmount > 0 && (
                <div style={{ fontSize: 13, fontWeight: 800, color: "#137A35", marginTop: 6 }}>
                  + {moneyFmt(complete.tipAmount)} tip · {moneyFmt(roundMoney(complete.amountPaid + complete.tipAmount))} charged
                </div>
              )}
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
                {giftApplied > 0 && (
                  <>
                    <span style={{ color: "#1687F5" }}>Gift card</span>
                    <span style={{ color: "#1687F5" }}>−{moneyFmt(giftApplied)}</span>
                    <span style={{ fontWeight: 800, color: "var(--ink-900)" }}>Remaining</span>
                    <span style={{ fontWeight: 800, color: "var(--ink-900)" }}>{moneyFmt(remainingAfterGift)}</span>
                  </>
                )}
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

              {/* Gift card credit — apply up to its balance; the method below
                  settles whatever remains (split tender in one flow). */}
              <div style={{ marginTop: 14, padding: "10px 12px", background: "white",
                border: "1.5px solid var(--ink-200)", borderRadius: 10 }}>
                <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: ".06em",
                  textTransform: "uppercase", color: "var(--ink-500)", marginBottom: 6 }}>Gift card</div>
                {gcApplied ? (
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 13 }}>
                    <span style={{ display: "flex", alignItems: "center", gap: 6, fontFamily: "var(--font-mono)" }}>
                      <Icon name="gift" size={13} style={{ color: "#1687F5" }} />
                      {gcApplied.code} · <strong style={{ color: "#1687F5" }}>{moneyFmt(giftApplied)}</strong>
                    </span>
                    <button type="button" onClick={removeGiftCard} title="Remove gift card"
                      style={{ all: "unset", cursor: "pointer", color: "var(--ink-500)" }}>
                      <Icon name="x" size={13} />
                    </button>
                  </div>
                ) : !gcCard ? (
                  <div style={{ display: "flex", gap: 6 }}>
                    <input value={gcCode} onChange={(e) => setGcCode(e.target.value.toUpperCase())}
                      onKeyDown={(e) => { if (e.key === "Enter") handleGcLookup(); }}
                      placeholder="Card code" autoComplete="off"
                      style={{ flex: 1, fontSize: 13, padding: "6px 8px", border: "1.5px solid var(--ink-200)", borderRadius: 6, fontFamily: "var(--font-mono)", fontWeight: 700 }} />
                    <button type="button" className="a-btn a-btn--secondary a-btn--sm" onClick={handleGcLookup}
                      disabled={gcLooking || !gcCode.trim()}>
                      {gcLooking ? "…" : "Look up"}
                    </button>
                  </div>
                ) : (
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, fontSize: 13 }}>
                    <span>Balance <strong>{moneyFmt(gcBalance)}</strong></span>
                    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      <button type="button" className="a-btn a-btn--primary a-btn--sm" onClick={applyGiftCard}>
                        Apply {moneyFmt(Math.min(gcBalance, payableBalance))}
                      </button>
                      <button type="button" onClick={() => setGcCard(null)} title="Cancel"
                        style={{ all: "unset", cursor: "pointer", color: "var(--ink-500)" }}>
                        <Icon name="x" size={13} />
                      </button>
                    </div>
                  </div>
                )}
              </div>

              <div style={{ marginTop: 14 }}>
                <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: ".06em",
                  textTransform: "uppercase", color: "var(--ink-500)", marginBottom: 6 }}>
                  {remainingAfterGift > 0 ? "Method (remaining)" : "Method"}
                </div>
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

              {showTip && (
                <TipStep
                  base={tipBase}
                  bookingId={booking?.bookingId || null}
                  defaults={tipDefaults}
                  value={tip}
                  onChange={setTip}
                />
              )}

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
              {remainingAfterGift <= 0 && giftApplied > 0 ? (
                // Gift card covers the entire balance — nothing left to collect.
                <div style={{ border: "1.5px solid #8AD5A3", background: "#EAF8EF",
                  borderRadius: 12, padding: 22, textAlign: "center", display: "grid", gap: 6 }}>
                  <Icon name="gift" size={30} style={{ color: "#137A35", margin: "0 auto" }} />
                  <div style={{ fontWeight: 900, fontSize: 17, color: "#137A35" }}>
                    Gift card covers {moneyFmt(giftApplied)}
                  </div>
                  <div style={{ fontSize: 12, color: "var(--ink-600)" }}>Nothing left to collect.</div>
                </div>
              ) : (
              <>
              <div style={{ padding: "10px 12px", background: "white",
                border: "1.5px solid var(--ink-200)", borderRadius: 10,
                display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ fontSize: 11, fontWeight: 800, color: "var(--ink-500)" }}>
                  {isCash ? "Cash tendered" : PAYMENT_METHODS.find((m) => m.value === method)?.label || "Amount"}
                </div>
                <div style={{ fontSize: 22, fontWeight: 900, color: "var(--ink-900)" }}>
                  {moneyFmt(amount || 0)}
                </div>
              </div>
              {isCash && cashTenders.length > 0 && (
                <div style={{
                  marginTop: 8,
                  padding: "10px 12px",
                  border: "1.5px solid var(--ink-200)",
                  borderRadius: 10,
                  background: "#FFFDF0",
                  display: "grid",
                  gap: 6,
                }}>
                  <div style={{
                    fontSize: 11,
                    fontWeight: 900,
                    letterSpacing: ".06em",
                    textTransform: "uppercase",
                    color: "var(--ink-500)",
                  }}>
                    Cash entered
                  </div>
                  {cashTenders.map((entry) => (
                    <div
                      key={entry.value}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        fontSize: 13,
                        fontWeight: 800,
                        color: "var(--ink-900)",
                      }}
                    >
                      <span>{entry.count} x {cashTenderLabel(entry.value)}</span>
                      <span>{moneyFmt(entry.count * entry.value)}</span>
                    </div>
                  ))}
                </div>
              )}
              {isCheck && (
                <div style={{ marginTop: 8 }}>
                  <div style={{ fontSize: 11, fontWeight: 800, color: "var(--ink-500)", marginBottom: 4 }}>
                    Check number
                  </div>
                  <input value={checkNumber} onChange={(e) => setCheckNumber(e.target.value.replace(/[^\w-]/g, ""))}
                    placeholder="e.g. 10421" autoComplete="off"
                    style={{ width: "100%", fontSize: 15, padding: "10px 12px",
                      border: "1.5px solid var(--ink-200)", borderRadius: 8,
                      fontFamily: "var(--font-mono)", fontWeight: 700 }} />
                </div>
              )}
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
                      borderRadius: 7, fontSize: 16, fontWeight: 800, cursor: "pointer",
                    }}>
                    {k}
                  </button>
                ))}
                <button type="button" onClick={() => {
                  setAmount("");
                  setCashTenders([]);
                }}
                  style={{ minHeight: 54, border: "1px solid var(--ink-200)", background: "white",
                    borderRadius: 7, fontSize: 14, fontWeight: 800, cursor: "pointer",
                  }}>
                  Clear
                </button>
              </div>
              </>
              )}
              <button type="button" className="a-btn a-btn--primary" onClick={handleSubmit}
                disabled={isBusy}
                style={{ width: "100%", justifyContent: "center", minHeight: 52, marginTop: 10, fontSize: 16 }}>
                <Icon name="check" size={16} />
                {isBusy
                  ? "Completing…"
                  : remainingAfterGift <= 0 && giftApplied > 0
                    ? `Pay ${moneyFmt(giftApplied)} by gift card`
                    : giftApplied > 0
                      ? `Complete · ${moneyFmt(giftApplied)} gift + ${moneyFmt(remainingAfterGift)}`
                      : `Complete order · ${moneyFmt(remainingAfterGift)}`}
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
    </>
  );
}
