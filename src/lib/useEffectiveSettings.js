// useEffectiveSettings — merged location + device settings for the cashier.
//
// The pair endpoint already returns a `settings` object with location
// defaults + device overrides merged server-side; we save it on
// localStorage at pair time. Reading from there means every screen has
// settings synchronously without an API round-trip.

import { useMemo } from "react";
import { getTerminal } from "./terminal";

const FALLBACKS = {
  // Location-wide cashier behaviour
  skipNewGuestDetails: true,
  autoCheckInOnPurchase: true,
  allowUndoCheckIn: false,
  requirePinForReprint: true,
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
  // Per-device hardware
  hasCashDrawer: true,
  openDrawerForCashOnly: true,
  deviceTimeoutMinutes: 10,
  receiptPrinterId: null,
};

export function useEffectiveSettings() {
  const terminal = getTerminal();
  return useMemo(() => {
    return { ...FALLBACKS, ...(terminal?.settings || {}) };
  }, [terminal?.settings, terminal?.deviceId]);
}
