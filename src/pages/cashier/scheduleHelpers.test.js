import test from "node:test";
import assert from "node:assert/strict";
import {
  pickNearestSession,
  getCurrentSessionBlocker,
  isSessionSelectableNow,
  isSessionNotEnded,
  buildScheduledLine,
} from "./scheduleHelpers.js";

// Build a session whose name encodes the time range "HH:MM - HH:MM" (the
// shape getStartTime/getEndTime parse). cap = remaining capacity.
const slot = (range, cap = 10) => ({
  name: range,
  capacityRemaining: cap,
  isBooked: false,
  variations: [{ variationId: 1, isAvailable: true }],
});

// minutes-since-midnight for a 12h clock string like "6:10pm"
const at = (h, m, pm = true) => (h % 12) * 60 + m + (pm ? 12 * 60 : 0);

const OPTS = { graceMinutes: 15, minRemainingMinutes: 15 };

test("isSessionSelectableNow: past slot is not selectable", () => {
  assert.equal(isSessionSelectableNow(slot("08:00 - 09:00"), at(2, 48), OPTS), false);
});

test("isSessionSelectableNow: future slot is selectable", () => {
  assert.equal(isSessionSelectableNow(slot("15:00 - 16:00"), at(2, 48), OPTS), true);
});

test("isSessionSelectableNow: just-started slot within grace+time is selectable", () => {
  // now 14:48, slot 14:40-15:40: 8 min in (<=15) and 52 left (>=15) → ok
  assert.equal(isSessionSelectableNow(slot("14:40 - 15:40"), at(2, 48), OPTS), true);
});

test("isSessionSelectableNow: nearly-over running slot is not selectable", () => {
  // now 14:48, slot 13:50-14:50: only 2 min left (<15) → not selectable
  assert.equal(isSessionSelectableNow(slot("13:50 - 14:50"), at(2, 48), OPTS), false);
});

test("isSessionSelectableNow: minRemaining 0 disables the remaining check", () => {
  // 14:40-14:50 at 14:48: within 15-min grace but only 2 min left.
  const off = { graceMinutes: 15, minRemainingMinutes: 0 };
  assert.equal(isSessionSelectableNow(slot("14:40 - 14:50"), at(2, 48), off), true);
  // With a positive minimum it would be rejected.
  assert.equal(isSessionSelectableNow(slot("14:40 - 14:50"), at(2, 48), OPTS), false);
});

test("isSessionNotEnded: manual picker shows a running slot regardless of grace", () => {
  // 13:00-15:00 at 13:14: started 14 min ago, still running. Auto-rule with
  // grace 0 would reject it, but manual selection only cares that it hasn't ended.
  assert.equal(isSessionNotEnded(slot("13:00 - 15:00"), at(1, 14)), true);
  // Same slot is NOT auto-selectable when grace is 0 (the reported bug).
  assert.equal(isSessionSelectableNow(slot("13:00 - 15:00"), at(1, 14), { graceMinutes: 0, minRemainingMinutes: 0 }), false);
});

test("isSessionNotEnded: an already-ended slot is hidden from the manual picker", () => {
  // 13:00-14:00 at 14:30: ended 30 min ago → not pickable.
  assert.equal(isSessionNotEnded(slot("13:00 - 14:00"), at(2, 30)), false);
});

test("isSessionNotEnded: a future slot is pickable", () => {
  assert.equal(isSessionNotEnded(slot("18:00 - 19:00"), at(2, 30)), true);
});

test("pickNearestSession: grace 0 never auto-picks a running-only slot (reported bug)", () => {
  // Only a running slot exists (13:00-15:00, now 13:14). With grace 0 the
  // auto-assign returns null so the line is NOT auto-added; the cashier picks
  // it manually instead.
  const off = { graceMinutes: 0, minRemainingMinutes: 0 };
  assert.equal(pickNearestSession([slot("13:00 - 15:00")], at(1, 14), off), null);
});

test("pickNearestSession: minRemaining 0 still picks a barely-running slot", () => {
  const off = { graceMinutes: 15, minRemainingMinutes: 0 };
  assert.equal(pickNearestSession([slot("14:40 - 14:50")], at(2, 48), off)?.name, "14:40 - 14:50");
  // With a 15-min minimum, nothing qualifies (and no upcoming) → null.
  assert.equal(pickNearestSession([slot("14:40 - 14:50")], at(2, 48), OPTS), null);
});

test("joins the running slot when just started and time remains (6:10pm)", () => {
  const sessions = [slot("18:00 - 19:00"), slot("18:30 - 19:30")];
  const pick = pickNearestSession(sessions, at(6, 10), OPTS);
  assert.equal(pick.name, "18:00 - 19:00");
});

test("takes the next slot once past the grace window (6:25pm, grace 15)", () => {
  const sessions = [slot("18:00 - 19:00"), slot("18:30 - 19:30")];
  const pick = pickNearestSession(sessions, at(6, 25), OPTS);
  assert.equal(pick.name, "18:30 - 19:30");
});

test("skips a full running slot and takes the next (6:10pm)", () => {
  const sessions = [slot("18:00 - 19:00", 0), slot("18:30 - 19:30")];
  const pick = pickNearestSession(sessions, at(6, 10), OPTS);
  assert.equal(pick.name, "18:30 - 19:30");
});

test("flags a full current slot so auto-booking does not jump to a later session", () => {
  const sessions = [slot("18:00 - 19:00", 0), slot("18:30 - 19:30")];
  const blocker = getCurrentSessionBlocker(sessions, at(6, 10), OPTS);
  assert.equal(blocker?.reason, "sold_out");
  assert.equal(blocker?.session.name, "18:00 - 19:00");
  assert.match(blocker?.message || "", /sold out/i);
});

test("does not block future auto-pick when current slot is outside the join window", () => {
  const sessions = [slot("18:00 - 19:00", 0), slot("18:30 - 19:30")];
  assert.equal(getCurrentSessionBlocker(sessions, at(6, 25), OPTS), null);
});

test("before any slot starts, picks the soonest upcoming (5:50pm)", () => {
  const sessions = [slot("18:00 - 19:00"), slot("18:30 - 19:30")];
  const pick = pickNearestSession(sessions, at(5, 50), OPTS);
  assert.equal(pick.name, "18:00 - 19:00");
});

test("does not sell a nearly-over running slot, jumps to next (6:55pm)", () => {
  const sessions = [slot("18:00 - 19:00"), slot("19:00 - 20:00")];
  const pick = pickNearestSession(sessions, at(6, 55), OPTS);
  assert.equal(pick.name, "19:00 - 20:00");
});

test("min-remaining blocks a short running slot with too little time left", () => {
  // 20-min slot 6:00-6:20; at 6:10 elapsed=10 (<=15 grace) but only 10 min
  // remain (<15 minRemaining) → not joinable; nothing upcoming → null.
  const sessions = [slot("18:00 - 18:20")];
  const pick = pickNearestSession(sessions, at(6, 10), OPTS);
  assert.equal(pick, null);
});

test("among multiple running joinable slots, prefers the most-recently-started", () => {
  // both running at 6:12; 6:10 start has more time left than 6:00 start
  const sessions = [slot("18:00 - 19:00"), slot("18:10 - 19:10")];
  const pick = pickNearestSession(sessions, at(6, 12), OPTS);
  assert.equal(pick.name, "18:10 - 19:10");
});

test("returns null when nothing is bookable", () => {
  const sessions = [slot("18:00 - 19:00", 0), { name: "18:30 - 19:30", isBooked: true, variations: [] }];
  const pick = pickNearestSession(sessions, at(6, 10), OPTS);
  assert.equal(pick, null);
});

test("custom config: grace 30 lets a 6:25 walk-in still join the 6:00 slot", () => {
  const sessions = [slot("18:00 - 19:00"), slot("18:30 - 19:30")];
  const pick = pickNearestSession(sessions, at(6, 25), { graceMinutes: 30, minRemainingMinutes: 15 });
  assert.equal(pick.name, "18:00 - 19:00");
});

test("buildScheduledLine: re-scheduling (Change time) does not accumulate the meta label", () => {
  const variation = { variationId: 1, name: "Standard", cost: 18 };
  const build = (range, section, item) =>
    buildScheduledLine({
      item,
      section,
      selectedDate: "2026-05-22",
      session: { name: range },
      variation,
      guestCount: 1,
      slotIds: [10],
      resourceSelections: {},
      resolvedChoiceSelections: {},
      hasChoiceGroups: false,
    });

  // First add via the catalog section ("Party Bookings").
  const first = build("13:20 - 14:20", { title: "Party Bookings" }, { id: 1, name: "1 Hour Jump Pass" });
  assert.equal(first.sectionTitle, "Party Bookings");
  assert.equal((first.meta.match(/Party Bookings/g) || []).length, 1);
  assert.ok(first.meta.includes("13:20 - 14:20"));

  // Change time #1 — edit passes the line's clean sectionTitle back in.
  const second = build("13:40 - 14:40", { title: first.sectionTitle }, first);
  assert.equal((second.meta.match(/Party Bookings/g) || []).length, 1);
  assert.ok(second.meta.includes("13:40 - 14:40"));
  assert.ok(!second.meta.includes("13:20 - 14:20"));

  // Change time #2 — still no accumulation.
  const third = build("15:40 - 16:40", { title: second.sectionTitle }, second);
  assert.equal((third.meta.match(/Party Bookings/g) || []).length, 1);
  assert.ok(third.meta.includes("15:40 - 16:40"));
  assert.ok(!third.meta.includes("13:40 - 14:40"));
});
