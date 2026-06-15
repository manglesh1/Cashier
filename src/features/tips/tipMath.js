// Client mirror of the backend utils/tips/tipMath.js — preview math for
// the Tip step. Keep in sync with the backend; the backend is always the
// source of truth (it revalidates), this is just for instant UI feedback.

import { roundMoney } from "../../lib/money.js";

/**
 * Base the % buttons compute on.
 *   calcOnTotal=false → the amount being paid now (balance/subtotal)
 *   calcOnTotal=true  → the full booking total
 */
export function computeTipBase({ subtotal, bookingTotal, calcOnTotal }) {
  const sub = roundMoney(subtotal);
  const bt = roundMoney(bookingTotal);
  return calcOnTotal ? bt : sub;
}

/** Apply a tip percentage (15 = 15%) to a base amount. */
export function applyTipPercent(base, percent) {
  const b = roundMoney(base);
  const p = Number(percent);
  if (!Number.isFinite(p) || p < 0) return 0;
  return roundMoney((b * p) / 100);
}

/**
 * Totals block for the receipt / preview.
 *   bookingTotal = subtotal + tax  ← what the booking owes (no tip)
 *   charged      = bookingTotal + tip ← what the guest pays in total
 */
export function computeTotals({ subtotal, tax, tipAmount }) {
  const sub = roundMoney(subtotal);
  const tx = roundMoney(tax);
  const tip = roundMoney(tipAmount);
  const bookingTotal = roundMoney(sub + tx);
  return { subtotal: sub, tax: tx, tip, bookingTotal, charged: roundMoney(bookingTotal + tip) };
}

export const TIP_ALLOCATIONS = [
  { value: "booking_host", label: "Booking host" },
  { value: "logged_in_staff", label: "Me (cashier)" },
  { value: "general_pool", label: "Tip pool" },
];
