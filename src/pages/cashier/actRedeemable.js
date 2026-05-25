// actRedeemable — the single action dispatcher for the unified scan pipeline.
// Given a resolved redeemable (with a declared `action`), fire the right
// backend call. Same logic works on every screen (gate, counter, check-in) —
// the backend declares the action, the frontend just dispatches it.

import { pickNearestSession, getVariationSlotIds, normalizeVariationId, formatDateValue } from "./scheduleHelpers";

export async function actRedeemable(redeemable, { context, deps }) {
  const action = redeemable?.action || {};
  const {
    redeemTicket,
    scheduleVoucher,
    redeemEntitlement,
    fetchAvailability,
    posSettings,
    terminal,
  } = deps;

  switch (action.type) {
    case "admit": {
      await redeemTicket({
        ticketCode: action.ticketCode,
        terminalDeviceId: terminal?.deviceId || null,
        gateOrZone: terminal?.deviceName || "Counter",
        allowEarlyCheckIn: true,
      }).unwrap();
      return { ok: true, message: `Admitted · ${redeemable.label}` };
    }

    case "redeem_qty": {
      const res = await redeemEntitlement({ entitlementId: action.entitlementId, quantity: 1 }).unwrap();
      const remaining = res?.data?.remainingQty ?? 0;
      return { ok: true, message: `Redeemed ${redeemable.label} — ${remaining} left`, remaining };
    }

    case "schedule_nearest": {
      if (!action.activityId) return { ok: false, message: "This pass has no activity to schedule." };
      // LOCAL date — NOT toISOString (UTC). In IST early-morning, UTC is still
      // the previous day, which would schedule into yesterday's slots.
      const today = formatDateValue(new Date());
      const res = await fetchAvailability({ date: today, activityId: action.activityId }, true).unwrap();
      const sessions = Array.isArray(res?.data?.sessions) ? res.data.sessions : (res?.sessions || []);
      const now = new Date();
      const nowMinutes = now.getHours() * 60 + now.getMinutes();
      const graceMinutes = Number.isFinite(Number(posSettings?.joinGraceMinutes)) ? Number(posSettings.joinGraceMinutes) : 15;
      const minRemainingMinutes = Number.isFinite(Number(posSettings?.minRemainingMinutes)) ? Number(posSettings.minRemainingMinutes) : 0;
      const session = pickNearestSession(sessions, nowMinutes, { graceMinutes, minRemainingMinutes });
      if (!session) return { ok: false, message: `No open slot today for ${redeemable.label}.` };
      const variation =
        (session.variations || []).find((v) => normalizeVariationId(v.variationId) === normalizeVariationId(action.variationId)) ||
        (session.variations || [])[0];
      const slotId = Number(getVariationSlotIds(variation)[0]);
      if (!slotId) return { ok: false, message: "Couldn't resolve a slot for this pass." };
      await scheduleVoucher({ bookingItemId: action.bookingItemId, slotId }).unwrap();
      const slotLabel = session.name || session.displayName || "slot";
      return { ok: true, message: `Scheduled ${redeemable.label} · ${slotLabel}`, slot: slotLabel };
    }

    case "none":
    default:
      return { ok: false, message: "Nothing to redeem here." };
  }
}
