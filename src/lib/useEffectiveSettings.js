// useEffectiveSettings — merged location + device settings for the cashier.
//
// The pair endpoint already returns a `settings` object with location
// defaults + device overrides merged server-side; we save it on
// localStorage at pair time. Reading from there means every screen has
// settings synchronously without an API round-trip.

import { useEffect, useMemo, useState } from "react";
import { getTerminal, SETTINGS_UPDATED_EVENT } from "./terminal";

const FALLBACKS = {
  // Location-wide cashier behaviour
  skipNewGuestDetails: true,
  autoCheckInOnPurchase: true,
  allowUndoCheckIn: false,
  requirePinForReprint: true,
  requirePOSPinForRefunds: false,
  enableDiscounts: true,
  enableCustomDiscount: true,
  allowCustomDiscountWithoutPin: false,
  cashierDiscountPercentLimit: 20,
  cashierDiscountAmountLimit: 20,
  requireManagerCode: false,
  bannedGuestsManagerCode: false,
  enableTipping: false,
  predefinedTipPercentages: [5, 10, 15],
  allowCustomTipAmount: false,
  // Tip % base + default recipient (now emitted by mergeSettings).
  // calculateTipsOnBookingTotal: false → suggested % is on the amount
  // being paid; true → on the full booking total. defaultTipAllocation
  // preselects the Tip step's allocation radio.
  calculateTipsOnBookingTotal: false,
  defaultTipAllocation: "booking_host",
  // Per-device hardware
  hasCashDrawer: true,
  openDrawerForCashOnly: true,
  deviceTimeoutMinutes: 10,
  receiptPrinterId: null,
  // Card reader bound to THIS till (Stripe tmr_… or Nuvei terminal id).
  // Passed to the backend as readerId when charging a card so the prompt
  // lights up on this station's reader. null → backend falls back to the
  // venue's online reader.
  terminalReaderId: null,
  // Walk-in slot auto-pick (POS quick checkout). A running slot is offered
  // only if it started within joinGraceMinutes AND has at least
  // minRemainingMinutes left before it ends; otherwise the next upcoming
  // slot is chosen. See scheduleHelpers.pickNearestSession.
  joinGraceMinutes: 15,
  // 0 = the "minimum time remaining" rule is OFF (only the join window
  // applies). Managers opt in by setting a positive value in admin.
  minRemainingMinutes: 0,
  // Sales tax — comes from the paired location's default TaxRate so the
  // cart matches the booking the backend creates. taxRate is a percent
  // (e.g. 10 = 10%). null → CartPanel uses its own fallback. taxCalculation
  // mirrors the location: "add_to_price" (tax on top) or "include_in_price".
  taxRate: null,
  taxCalculation: "add_to_price",
};

export function useEffectiveSettings() {
  // Re-read on mount and whenever the heartbeat refreshes settings, so admin
  // edits propagate live without a re-pair (terminal.updateTerminalSettings
  // dispatches SETTINGS_UPDATED_EVENT after writing to localStorage).
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const bump = () => setVersion((n) => n + 1);
    window.addEventListener(SETTINGS_UPDATED_EVENT, bump);
    return () => window.removeEventListener(SETTINGS_UPDATED_EVENT, bump);
  }, []);

  return useMemo(() => {
    const terminal = getTerminal();
    return { ...FALLBACKS, ...(terminal?.settings || {}) };
  }, [version]);
}
