// useTipDefaults — reads the merged POS settings (location + device) and
// returns the tip configuration the Tip step needs. All five fields are
// emitted by the backend mergeSettings (Phase 1B fixed the two that were
// previously dropped). FALLBACKS in useEffectiveSettings cover an old
// pair snapshot that predates that fix.

import { useMemo } from "react";
import { useEffectiveSettings } from "../../lib/useEffectiveSettings";

export function useTipDefaults() {
  const s = useEffectiveSettings();
  return useMemo(() => {
    const percentages = Array.isArray(s.predefinedTipPercentages)
      ? s.predefinedTipPercentages.filter((n) => Number(n) > 0).slice(0, 4)
      : [5, 10, 15];
    return {
      enabled: s.enableTipping === true,
      percentages,
      allowCustom: s.allowCustomTipAmount === true,
      calcOnBookingTotal: s.calculateTipsOnBookingTotal === true,
      defaultAllocation: s.defaultTipAllocation || "booking_host",
    };
  }, [
    s.enableTipping,
    s.predefinedTipPercentages,
    s.allowCustomTipAmount,
    s.calculateTipsOnBookingTotal,
    s.defaultTipAllocation,
  ]);
}
