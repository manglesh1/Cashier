// SellPaymentOverlay — the Sell-flow payment overlay.
//
// The Sell screen and the Check-in screen share one payment UI:
// CheckInPaymentModal. The difference between the two flows is what
// the modal sits on top of:
//
//   • Check-in:  an EXISTING booking that already has a balance.
//   • Sell:      a CART that doesn't have a backend booking yet.
//
// This overlay preserves the "no booking until paid" guarantee — the
// backend booking is NEVER created until the cashier actually
// completes payment. While the modal is open we feed CheckInPaymentModal
// a synthetic display-only booking object built from the cart draft
// (totals come from the cart's pricingSummary). On Complete we make
// ONE atomic createBooking call carrying the payment payload, so if
// the cashier closes without paying nothing lands in the backend.
//
// Multi-booking split for voucher_pack / membership / etc. is preserved
// inside the atomic create+pay loop — the main booking gets the
// payment, additional voucher / membership bookings are created next
// (unpaid) so each pack lives in its own row with its own
// redemption tokens.

import React, { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  useCreateBookingMutation,
  useRecordPaymentMutation,
  useSendBookingConfirmationMutation,
} from "../../features/bookings/bookingApi";
import { useRedeemGiftCardMutation } from "../../features/vouchers/voucherApi";
import { moneyFmt, roundMoney } from "../../lib/money";
import { getTerminal } from "../../lib/terminal";
import { openCashDrawer, printReceipt } from "../../lib/hardware";
import { buildPaidCheckoutPricingSummary } from "./cartPricing";
import CheckInPaymentModal from "./CheckInPaymentModal";
import TerminalPaymentModal from "./TerminalPaymentModal";
import TerminalProgressModal from "./TerminalProgressModal";
import { useTipDefaults } from "../../features/tips/useTipDefaults";

export default function SellPaymentOverlay({
  open,
  draftPayment,      // shape produced by CashierApp.handleCheckout
  onClose,           // () => void — cashier dismissed without paying
  onComplete,        // (paymentComplete) => void — payment recorded; cart can be cleared
}) {
  // ── Payment-form state (mirrors CheckIn.jsx's parent-owned state) ─
  const [paymentMethod, setPaymentMethod] = useState("card");
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentNote, setPaymentNote] = useState("");
  const [paymentDiscount, setPaymentDiscount] = useState(null);
  const [paymentComplete, setPaymentComplete] = useState(null);
  const [pendingTerminal, setPendingTerminal] = useState(null);
  const [terminalPayment, setTerminalPayment] = useState(null);
  // After atomic create+pay we know the real bookingId — store it so
  // receipt actions (print / email) can target the right booking.
  const [paidBooking, setPaidBooking] = useState(null);
  // On-glass card tip: the allocation the cashier picked on the payment
  // screen, handed to the card reader so the guest's tip is recorded to it.
  const tipDefaults = useTipDefaults();
  const [cardTipAllocation, setCardTipAllocation] = useState("booking_host");

  // ── Mutations ─────────────────────────────────────────────────────
  const [createBooking, { isLoading: creating }] = useCreateBookingMutation();
  const [recordPayment, { isLoading: recordingExtra }] = useRecordPaymentMutation();
  const [redeemGiftCard, { isLoading: gcRedeeming }] = useRedeemGiftCardMutation();
  const [sendBookingConfirmation, { isLoading: sendingReceipt }] = useSendBookingConfirmationMutation();

  // ── Idempotency / re-entry guards ─────────────────────────────────
  const paymentLockRef = useRef(false);
  const paymentSessionRef = useRef(null);

  // ── Synthetic display-only booking ────────────────────────────────
  // Built from the cart's draft so CheckInPaymentModal can render
  // totals, header label, customer email for receipts, etc. — without
  // any backend booking existing yet. After successful create+pay we
  // swap in paidBooking, which carries the real bookingId/Number for
  // the receipt step.
  const syntheticBooking = useMemo(() => {
    if (!draftPayment?.draft) return null;
    const draft = draftPayment.draft;
    const guestEmail = draftPayment?.guestEmail
      || draftPayment?.cartCustomer?.contactEmail
      || draft.payload?.guestEmail
      || null;
    const guestId = draftPayment?.guestId
      || draftPayment?.cartCustomer?.guestId
      || draft.payload?.guestId
      || null;
    // Totals are cart-level (validateCart's authoritative output,
    // captured into draftPayment by CashierApp.handleCheckout).
    //
    // We deliberately do NOT read from draft.payload.pricingSummary —
    // that's a per-LINE allocation (one per booking we'll create).
    // For a no-schedule-only cart (membership / voucher pack purchase
    // by itself), the regular-line allocation is $0 because every
    // line went into a per-voucher allocation, and reading it here
    // would show the customer "Total $0" on the receipt.
    return {
      bookingId: null,
      bookingNumber: "New sale",
      bookingName: draft.guestName || "Walk-in",
      totalAmount: roundMoney(Number(draftPayment.totalAmount) || 0),
      subtotalAmount: roundMoney(Number(draftPayment.subTotal) || 0),
      taxAmount: roundMoney(Number(draftPayment.taxAmount) || 0),
      discountAmount: roundMoney(Number(draftPayment.discountAmount) || 0),
      // Server-computed voucher coverage from validate-cart. Reduces
      // balanceDue so the overlay asks for the post-voucher amount.
      // Total still shows the gross for the receipt; voucher acts as
      // a tender on the payment side.
      voucherCoveredAmount: roundMoney(Number(draftPayment.voucherCoveredAmount) || 0),
      guestEmail,
      guest: { guestEmail, guestId },
      guestId,
      bookingItems: [],
      purchasedItems: [],
    };
  }, [draftPayment]);

  // What the modal sees as "the booking" — real one after payment,
  // synthetic one while collecting.
  const displayBooking = paidBooking || syntheticBooking;
  const balanceDue = roundMoney(
    Math.max(
      0,
      Number(displayBooking?.totalAmount || 0) -
        Number(displayBooking?.voucherCoveredAmount || 0)
    )
  );
  const fullyCovered = balanceDue < 0.005;

  // ── Initial amount when the overlay opens ────────────────────────
  useEffect(() => {
    if (!open) return;
    if (paymentMethod === "cash" || paymentMethod === "gift_card") return;
    if (!paymentAmount && balanceDue > 0) {
      setPaymentAmount(balanceDue.toFixed(2));
      paymentSessionRef.current = `sell-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    }
  }, [open, balanceDue, paymentAmount, paymentMethod]);

  // ── Reset everything when the overlay closes ─────────────────────
  useEffect(() => {
    if (open) return;
    setPaymentAmount("");
    setPaymentMethod("card");
    setPaymentNote("");
    setPaymentDiscount(null);
    setPaymentComplete(null);
    setPendingTerminal(null);
    setTerminalPayment(null);
    setPaidBooking(null);
    paymentLockRef.current = false;
    paymentSessionRef.current = null;
  }, [open]);

  // ── Atomic create+pay: the no-booking-until-paid path ────────────
  //
  // One createBooking call carrying the payment payload. If it fails,
  // no booking exists and the cashier can adjust + retry. If it
  // succeeds, the booking lands paid in the backend in a single
  // transaction. Multi-booking voucher_pack splits get created after
  // the main paid booking — they're zero-balance pack rows and
  // don't carry payment themselves.
  const performCreateAndPay = async (payment) => {
    const draft = draftPayment?.draft;
    if (!draft?.payload) {
      throw new Error("Checkout draft is no longer available.");
    }
    const payByGiftCard = payment?.giftCard === true;
    const payByTerminal = payment?.terminal === true;
    const paymentPayload = (payByGiftCard || payByTerminal)
      ? {}
      : {
          amountPaid: Number(payment?.amountPaid || 0),
          paymentMethod: payment?.paymentMethod,
          referenceNumber: payment?.referenceNumber || null,
          paymentDetails: {
            tenderedAmount: Number(payment?.tenderedAmount || 0),
            changeDue: Number(payment?.changeDue || 0),
            terminalDeviceId: payment?.terminalDeviceId || null,
            remarks: payment?.remarks || "",
          },
        };
    const paidPricingSummary = buildPaidCheckoutPricingSummary(
      draft.payload.pricingSummary,
      payment
    );
    const baseKey = draft.checkoutKey || null;
    let primary = null;

    let voucherSeq = 0;
    const voucherAllocations = Array.isArray(draft.voucherAllocations) ? draft.voucherAllocations : [];

    // Separate memberships from other no-schedule items. Memberships
    // ride on the SAME booking as regular cart items (cart-level rule:
    // 1 cart → 1 booking). Memberships, gift cards, and voucher
    // packs ALL ride on the same booking now.
    const membershipUnits = [];
    const giftCardUnits = [];
    const voucherPackUnits = [];
    const nonMembershipItems = [];
    for (const item of draft.noScheduleItems || []) {
      const productType = String(item.productType || "").toLowerCase();
      if (productType === "membership") {
        const repeats = Math.max(1, Number(item.qty) || 1);
        for (let i = 0; i < repeats; i += 1) {
          const recipient = normalizeRecipientForCheckout(
            item.recipientUnits?.[i] || item.recipient || null
          );
          membershipUnits.push({
            activityId: Number(item.activityId),
            variationId: item.variationId || null,
            allocationIndex: voucherSeq,
            guestInfo: recipient
              ? {
                  guestId: recipient.guestId || null,
                  guestName: recipient.name,
                  guestEmail: recipient.contactEmail,
                  guestPhone: recipient.contactPhone || "",
                }
              : draft.payload.guestInfo,
          });
          voucherSeq += 1;
        }
      } else if (productType === "gift_card") {
        const repeats = Math.max(1, Number(item.qty) || 1);
        for (let i = 0; i < repeats; i += 1) {
          const recipient = normalizeRecipientForCheckout(
            item.recipientUnits?.[i] || item.recipient || null
          );
          giftCardUnits.push({
            activityId: Number(item.activityId),
            variationId: item.variationId || null,
            allocationIndex: voucherSeq,
            customAmount: item.customAmount || item.faceValue || null,
            guestInfo: recipient
              ? {
                  guestId: recipient.guestId || null,
                  guestName: recipient.name,
                  guestEmail: recipient.contactEmail,
                  guestPhone: recipient.contactPhone || "",
                }
              : null,
          });
          voucherSeq += 1;
        }
      } else if (productType === "voucher_pack") {
        // Voucher packs: one entry per pack purchased. Backend mints
        // the child voucher BookingItems + Entitlements on the same
        // booking. Multiple packs of the same SKU = multiple entries.
        const repeats = Math.max(1, Number(item.qty) || 1);
        for (let i = 0; i < repeats; i += 1) {
          voucherPackUnits.push({
            activityId: Number(item.activityId),
            variationId: item.variationId || null,
            quantity: 1, // each entry = 1 pack
            allocationIndex: voucherSeq,
          });
          voucherSeq += 1;
        }
      } else {
        nonMembershipItems.push(item);
      }
    }

    const membershipsPayload = membershipUnits.map(
      ({ activityId, variationId, guestInfo }) => ({ activityId, variationId, guestInfo })
    );
    const giftCardsPayload = giftCardUnits.map(
      ({ activityId, variationId, guestInfo, customAmount }) => ({
        activityId,
        variationId,
        guestInfo,
        customAmount,
      })
    );
    const voucherPacksPayload = voucherPackUnits.map(
      ({ activityId, variationId, quantity }) => ({
        activityId,
        variationId,
        quantity,
      })
    );

    // The full cart total — what the cashier collected at the overlay.
    // When regular items + memberships are in the cart, the regular
    // booking absorbs BOTH and the payment lands on it once.
    const cartGrandTotal = Number(draftPayment.totalAmount) || 0;

    if (
      (draft.regularItems || []).length > 0 ||
      membershipUnits.length > 0 ||
      giftCardUnits.length > 0 ||
      voucherPackUnits.length > 0
    ) {
      // Mixed cart: one createBooking call carries regular items +
      // memberships + gift cards. Backend updates Booking.totalAmount
      // to include all artifacts and lands a single PaymentTransaction.
      // When there are no regular items, we still go through this path —
      // backend treats memberships/giftCards as the artifacts on a
      // booking with no schedule items, same flow.
      const fullPayment = payByGiftCard || payByTerminal
        ? {}
        : {
            ...paymentPayload,
            amountPaid: cartGrandTotal,
          };
      const noRegular = (draft.regularItems || []).length === 0;
      const res = await createBooking({
        ...draft.payload,
        ...(noRegular ? { sessions: undefined, waiverSignatureIds: undefined, deferWaiverEnforcement: true } : { pricingSummary: paidPricingSummary }),
        ...fullPayment,
        memberships: membershipsPayload,
        giftCards: giftCardsPayload,
        voucherPacks: voucherPacksPayload,
        idempotencyKey: baseKey ? `${baseKey}:main` : undefined,
      }).unwrap();
      const data = res?.data || {};
      primary = {
        bookingId: data.bookingId || res?.bookingId || res?.bookingMasterId || res?.id,
        bookingNumber: data.bookingNumber || res?.bookingNumber || "",
      };
    }

    // Per-line payment split for the REMAINING no-schedule items
    // (vouchers, gift cards, etc.) — these still go one-per-booking.
    for (const item of nonMembershipItems) {
      const repeats = Math.max(1, Number(item.qty) || 1);
      for (let i = 0; i < repeats; i += 1) {
        const lineItem = { ...item, qty: 1 };
        const recipient = normalizeRecipientForCheckout(item.recipientUnits?.[i] || item.recipient || null);
        const recipientGuestInfo = recipient
          ? {
              guestId: recipient.guestId || null,
              guestName: recipient.name,
              guestEmail: recipient.contactEmail,
              guestPhone: recipient.contactPhone || "",
            }
          : draft.payload.guestInfo;
        const allocation = voucherAllocations[voucherSeq] || {
          subtotalAmount: 0,
          discountAmount: 0,
          taxAmount: 0,
          grandTotal: 0,
          totalAmount: 0,
        };
        voucherSeq += 1;

        // Build a payment payload sized to THIS line. Card/terminal
        // payments are passed through as-is (the adapter handles
        // capture against the booking total); cash/check/etc. get
        // amountPaid = this line's allocation total.
        const lineTotal = Number(allocation.totalAmount || allocation.grandTotal) || 0;
        const linePayment = payByGiftCard || payByTerminal
          ? {}
          : {
              ...paymentPayload,
              amountPaid: lineTotal,
              paymentDetails: {
                ...(paymentPayload.paymentDetails || {}),
                // Tendered/change reflect the CART total — preserved
                // on the first line so the receipt shows what the
                // customer handed over; subsequent lines just record
                // their own slice without re-counting cash.
                ...(primary ? { tenderedAmount: lineTotal, changeDue: 0 } : {}),
              },
            };

        const res = await createBooking({
          ...draft.payload,
          ...linePayment,
          guestInfo: recipientGuestInfo,
          guestName: recipientGuestInfo?.guestName || draft.guestName,
          guestEmail: recipientGuestInfo?.guestEmail || draft.payload.guestEmail,
          guestPhone: recipientGuestInfo?.guestPhone || draft.payload.guestPhone,
          pricingSummary: buildPaidCheckoutPricingSummary(allocation, payment),
          sessions: undefined,
          waiverSignatureIds: undefined,
          activityIds: [Number(item.activityId)],
          variationId: item.variationId || null,
          bookingName: `${recipientGuestInfo?.guestName || draft.guestName || ""} - ${item.name}`.trim(),
          deferWaiverEnforcement: true,
          idempotencyKey: baseKey ? `${baseKey}:voucher${voucherSeq}` : undefined,
        }).unwrap();
        if (!primary) {
          const data = res?.data || {};
          primary = {
            bookingId: data.bookingId || res?.bookingId,
            bookingNumber: data.bookingNumber || res?.bookingNumber || "",
          };
        }
      }
    }
    return primary;
  };

  // ── Submit handlers (mirror CheckIn.jsx) ─────────────────────────
  const handleRecordPayment = async () => {
    if (paymentComplete || paymentLockRef.current) return;
    const discountAmount = roundMoney(Math.min(Number(paymentDiscount?.amount || 0), balanceDue));
    const payableBalance = roundMoney(Math.max(0, balanceDue - discountAmount));
    const tenderedAmount = Number(paymentAmount);
    if (payableBalance > 0 && (!Number.isFinite(tenderedAmount) || tenderedAmount <= 0)) {
      toast.error(paymentMethod === "cash" ? "Enter cash received." : "Enter a payment amount.");
      return;
    }
    if (paymentMethod === "cash" && tenderedAmount < payableBalance) {
      toast.error(`Cash received must cover ${moneyFmt(payableBalance)}.`);
      return;
    }
    if (paymentMethod !== "cash" && tenderedAmount > payableBalance) {
      toast.error(`Amount cannot exceed ${moneyFmt(payableBalance)}.`);
      return;
    }

    paymentLockRef.current = true;
    let keepLock = false;
    const recordAmount = paymentMethod === "cash" ? payableBalance : tenderedAmount;
    const changeDue = paymentMethod === "cash"
      ? Math.max(0, Number((tenderedAmount - payableBalance).toFixed(2)))
      : 0;
    const terminal = getTerminal();
    const cashRemark = paymentMethod === "cash"
      ? `Cash tendered ${moneyFmt(tenderedAmount)}; change due ${moneyFmt(changeDue)}.`
      : "";

    try {
      const isCard = paymentMethod === "card";
      const existingPrimary = paidBooking?.bookingId
        ? {
            bookingId: paidBooking.bookingId,
            bookingNumber: paidBooking.bookingNumber || "",
          }
        : null;
      const primary = existingPrimary || (await performCreateAndPay(isCard
          ? {
              terminal: true,
              discountAmount,
              discount: paymentDiscount,
              discountLabel: paymentDiscount?.label || null,
              discountCode: paymentDiscount?.code || null,
            }
          : {
              amountPaid: recordAmount,
              paymentMethod,
              tenderedAmount,
              changeDue,
              terminalDeviceId: terminal?.deviceId || null,
              remarks: [paymentNote || "Payment recorded at POS sell", cashRemark].filter(Boolean).join(" "),
              discountAmount,
              discount: paymentDiscount,
              discountLabel: paymentDiscount?.label || null,
              discountCode: paymentDiscount?.code || null,
            }));
      if (!primary?.bookingId) throw new Error("Booking creation failed.");

      // Record a separate "complimentary" line for the discount AFTER
      // the booking exists. Card-present sales skip this until the
      // terminal approves, so a cancelled tap does not leave a partial
      // payment audit line on an unpaid booking.
      if (!isCard && discountAmount > 0 && primary?.bookingId) {
        try {
          await recordPayment({
            bookingId: primary.bookingId,
            amountPaid: discountAmount,
            paymentMethod: "complimentary",
            terminalDeviceId: terminal?.deviceId || null,
            idempotencyKey: paymentSessionRef.current
              ? `${paymentSessionRef.current}:discount`
              : undefined,
            remarks: [
              `POS discount applied: ${paymentDiscount?.label || "Discount"}`,
              paymentDiscount?.code ? `Code ${paymentDiscount.code}.` : "",
              paymentDiscount?.managerName ? `Approved by ${paymentDiscount.managerName}.` : "",
            ].filter(Boolean).join(" "),
          }).unwrap();
        } catch (err) {
          // Non-fatal: the booking is paid, the audit log is incomplete.
          // eslint-disable-next-line no-console
          console.warn("[SellPaymentOverlay] discount audit line failed:", err);
        }
      }

      if (isCard && recordAmount > 0) {
        setPaidBooking({
          ...(syntheticBooking || {}),
          bookingId: primary.bookingId,
          bookingNumber: primary.bookingNumber || "",
          guestEmail: syntheticBooking?.guestEmail || null,
          guest: { guestEmail: syntheticBooking?.guestEmail || null },
        });
        setTerminalPayment({
          bookingId: primary.bookingId,
          bookingNumber: primary.bookingNumber || "",
          amount: recordAmount,
          discountAmount,
          discountLabel: paymentDiscount?.label || null,
        });
        keepLock = true;
        return;
      }

      if (existingPrimary && recordAmount > 0) {
        await recordPayment({
          bookingId: primary.bookingId,
          amountPaid: recordAmount,
          paymentMethod,
          tenderedAmount,
          changeDue,
          terminalDeviceId: terminal?.deviceId || null,
          remarks: [paymentNote || "Payment recorded at POS sell", cashRemark].filter(Boolean).join(" "),
          idempotencyKey: paymentSessionRef.current
            ? `${paymentSessionRef.current}:retry-${paymentMethod}`
            : undefined,
        }).unwrap();
      }

      if (paymentMethod === "cash" && recordAmount > 0) {
        openCashDrawer({ bookingId: primary?.bookingId, terminal });
      }
      setPaidBooking({
        ...(syntheticBooking || {}),
        bookingId: primary?.bookingId || null,
        bookingNumber: primary?.bookingNumber || "",
        guestEmail: syntheticBooking?.guestEmail || null,
        guest: { guestEmail: syntheticBooking?.guestEmail || null },
      });
      setPaymentComplete({
        bookingId: primary?.bookingId || null,
        bookingNumber: primary?.bookingNumber || "",
        amountPaid: roundMoney(recordAmount + discountAmount),
        discountAmount,
        discountLabel: paymentDiscount?.label || null,
        paymentAmount: recordAmount,
        paymentMethod,
        tenderedAmount,
        changeDue,
        drawerOpened: paymentMethod === "cash" && recordAmount > 0,
      });
      toast.success(`Order ${primary?.bookingNumber || ""} completed`);
    } catch (err) {
      const msg = err?.data?.message || err?.data?.error || err?.message || "Could not record payment";
      toast.error(msg);
    } finally {
      if (!keepLock) paymentLockRef.current = false;
    }
  };

  // Gift-card path: same no-booking-until-paid guarantee. The
  // gift-cards/redeem endpoint expects an existing bookingId, so we
  // create the booking first WITHOUT payment, then redeem. If redeem
  // fails the booking will be in an unpaid state but the cashier sees
  // an error; this is an acceptable narrow window because the gift-card
  // redemption can only happen against an existing booking by API
  // contract.
  const handleGiftCardPayment = async ({ code, pin, amount }) => {
    if (paymentComplete || paymentLockRef.current) return;
    const discountAmount = roundMoney(Math.min(Number(paymentDiscount?.amount || 0), balanceDue));
    const payable = roundMoney(Math.max(0, balanceDue - discountAmount));
    const apply = roundMoney(Math.min(payable, Number(amount) || 0));
    if (apply <= 0) {
      toast.error("Gift card has no balance to apply.");
      return;
    }
    paymentLockRef.current = true;
    const terminal = getTerminal();
    try {
      // Create the booking unpaid first (no payment payload) so we
      // have a bookingId to redeem against. If a previous card-terminal
      // attempt already created the unpaid booking, reuse it.
      const primary = paidBooking?.bookingId
        ? {
            bookingId: paidBooking.bookingId,
            bookingNumber: paidBooking.bookingNumber || "",
          }
        : await performCreateAndPay({ giftCard: true });
      if (!primary?.bookingId) throw new Error("Booking creation failed.");

      if (discountAmount > 0 && !paidBooking?.bookingId) {
        await recordPayment({
          bookingId: primary.bookingId,
          amountPaid: discountAmount,
          paymentMethod: "complimentary",
          terminalDeviceId: terminal?.deviceId || null,
          remarks: [
            `POS discount applied: ${paymentDiscount?.label || "Discount"}`,
            paymentDiscount?.code ? `Code ${paymentDiscount.code}.` : "",
          ].filter(Boolean).join(" "),
        }).unwrap();
      }
      const gc = await redeemGiftCard({
        code: String(code).trim(),
        ...(pin ? { pin: String(pin).trim() } : {}),
        amount: apply,
        bookingId: primary.bookingId,
        note: paymentNote || "POS gift card payment",
      }).unwrap();
      const balanceRemaining = roundMoney(Math.max(0, payable - apply));
      setPaidBooking({
        ...(syntheticBooking || {}),
        bookingId: primary.bookingId,
        bookingNumber: primary.bookingNumber || "",
        guestEmail: syntheticBooking?.guestEmail || null,
        guest: { guestEmail: syntheticBooking?.guestEmail || null },
        totalAmount: balanceRemaining || apply,
        balanceDue: balanceRemaining,
        subtotalAmount: balanceRemaining || apply,
        taxAmount: 0,
        discountAmount: 0,
      });
      if (balanceRemaining > 0) {
        setPaymentMethod("card");
        setPaymentAmount(balanceRemaining.toFixed(2));
        setPaymentDiscount(null);
        toast.success(`${moneyFmt(apply)} on gift card - ${moneyFmt(balanceRemaining)} still due`);
        return;
      }
      setPaymentComplete({
        bookingId: primary.bookingId,
        bookingNumber: primary.bookingNumber || "",
        amountPaid: roundMoney(apply + discountAmount),
        discountAmount,
        discountLabel: paymentDiscount?.label || null,
        paymentAmount: apply,
        paymentMethod: "gift_card",
        giftCardBalanceAfter: Number(gc?.data?.balanceAfter ?? 0),
        balanceRemaining,
        changeDue: 0,
      });
      toast.success(
        balanceRemaining > 0
          ? `${moneyFmt(apply)} on gift card · ${moneyFmt(balanceRemaining)} still due`
          : `${moneyFmt(apply)} paid by gift card`
      );
    } catch (err) {
      toast.error(err?.data?.error || err?.data?.message || err?.message || "Gift card payment failed.");
    } finally {
      paymentLockRef.current = false;
    }
  };

  const handlePrintReceipt = () => {
    printReceipt({
      bookingId: paidBooking?.bookingId || null,
      bookingNumber: paidBooking?.bookingNumber || null,
      terminal: getTerminal(),
    });
  };

  const handleEmailReceipt = async (email) => {
    if (!paidBooking?.bookingId) return;
    const clean = String(email || "").trim();
    if (!clean || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) {
      toast.error("Enter a valid email address.");
      return;
    }
    const promise = sendBookingConfirmation({
      bookingId: paidBooking.bookingId,
      email: clean,
    }).unwrap();
    toast.promise(promise, {
      loading: "Sending receipt...",
      success: `Receipt emailed to ${clean}`,
      error: (err) => err?.data?.message || err?.data?.error || "Could not email receipt",
    });
  };

  const handleClose = () => {
    if (paymentComplete) {
      onComplete?.(paymentComplete);
    } else {
      setPendingTerminal(null);
      setTerminalPayment(null);
      onClose?.();
    }
  };

  if (!open || !displayBooking) return null;

  return (
    <>
      <CheckInPaymentModal
        booking={displayBooking}
        balanceDue={balanceDue}
        amount={paymentAmount}
        method={paymentMethod}
        note={paymentNote}
        discount={paymentDiscount}
        isSubmitting={creating || recordingExtra}
        complete={paymentComplete}
        onAmountChange={setPaymentAmount}
        onMethodChange={setPaymentMethod}
        onNoteChange={setPaymentNote}
        onDiscountChange={setPaymentDiscount}
        onSubmit={handleRecordPayment}
        onGiftCardSubmit={handleGiftCardPayment}
        gcRedeeming={gcRedeeming}
        onPrintReceipt={handlePrintReceipt}
        onEmailReceipt={handleEmailReceipt}
        isSendingReceipt={sendingReceipt}
        onClose={handleClose}
        cardTipEnabled={tipDefaults.enabled}
        onCardTip={setCardTipAllocation}
      />
      {terminalPayment && (
        <TerminalPaymentModal
          open={!!terminalPayment}
          onClose={() => {
            setTerminalPayment(null);
            paymentLockRef.current = false;
            if (!paymentComplete) toast.info("Card payment cancelled.");
          }}
          amount={terminalPayment.amount}
          locationId={getTerminal()?.locationId}
          posDeviceId={getTerminal()?.deviceId}
          readerId={getTerminal()?.settings?.terminalReaderId || undefined}
          sourceType="booking"
          sourceId={terminalPayment.bookingId}
          tip={tipDefaults.enabled ? { allocation: cardTipAllocation, defaultAllocation: tipDefaults.defaultAllocation } : null}
          onApproved={(result) => {
            const data = result?.transaction || result?.data || result || {};
            setPaymentComplete({
              bookingId: terminalPayment.bookingId,
              bookingNumber: terminalPayment.bookingNumber || "",
              amountPaid: roundMoney(terminalPayment.amount + Number(terminalPayment.discountAmount || 0)),
              discountAmount: terminalPayment.discountAmount || 0,
              discountLabel: terminalPayment.discountLabel || null,
              paymentAmount: terminalPayment.amount,
              paymentMethod: "card",
              tenderedAmount: terminalPayment.amount,
              changeDue: 0,
              providerTransactionId: data.providerTransactionId || data.transactionId || null,
              providerReference: data.providerReference || null,
            });
            setTerminalPayment(null);
            paymentLockRef.current = false;
            toast.success(`${moneyFmt(terminalPayment.amount)} approved`);
          }}
        />
      )}
      {pendingTerminal && (
        <TerminalProgressModal
          transactionId={pendingTerminal.transactionId}
          bookingId={pendingTerminal.bookingId}
          amount={pendingTerminal.amount}
          instructions={pendingTerminal.instructions}
          onComplete={(data) => {
            setPaymentComplete({
              ...(data?.data || data || {}),
              bookingId: pendingTerminal.bookingId,
              bookingNumber: pendingTerminal.bookingNumber || "",
              amountPaid: roundMoney(pendingTerminal.amount + Number(pendingTerminal.discountAmount || 0)),
              discountAmount: pendingTerminal.discountAmount || 0,
              discountLabel: pendingTerminal.discountLabel || null,
              paymentAmount: pendingTerminal.amount,
              paymentMethod: "card",
              tenderedAmount: pendingTerminal.amount,
              changeDue: 0,
            });
            setPendingTerminal(null);
            paymentLockRef.current = false;
            toast.success(`${moneyFmt(pendingTerminal.amount)} approved`);
          }}
          onCancelled={(reason) => {
            setPendingTerminal(null);
            paymentLockRef.current = false;
            toast.error(reason === "cashier_cancel" ? "Card payment cancelled." : `Card payment cancelled: ${reason || ""}`);
          }}
          onFailed={(message) => {
            setPendingTerminal(null);
            paymentLockRef.current = false;
            toast.error(message || "Card payment failed.");
          }}
        />
      )}
    </>
  );
}

function normalizeRecipientForCheckout(guest) {
  if (!guest) return null;
  const name = guest.name || guest.guestName || guest.fullName || "";
  const contactEmail = guest.contactEmail || guest.guestEmail || guest.email || "";
  const contactPhone = guest.contactPhone || guest.guestPhone || guest.phone || "";
  return {
    guestId: guest.guestId || null,
    name,
    contact: contactEmail || contactPhone,
    contactEmail,
    contactPhone,
  };
}
