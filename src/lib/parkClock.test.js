import test from "node:test";
import assert from "node:assert/strict";
import { getParkClock, formatParkInstantTime } from "./parkClock.js";

test("POS date and minute of day use paired park timezone", () => {
  const now = new Date("2026-09-20T01:00:00.000Z");
  assert.deepEqual(getParkClock("America/Toronto", now), { date: "2026-09-19", minuteOfDay: 21 * 60 });
  assert.deepEqual(getParkClock("Asia/Kolkata", now), { date: "2026-09-20", minuteOfDay: 6 * 60 + 30 });
});

test("POS missing timezone is an error", () => {
  assert.throws(() => getParkClock(""));
});

test("ticket validity shows the same park slot clock on every cashier device", () => {
  assert.equal(formatParkInstantTime("2026-09-20T14:00:00.000Z", "America/Toronto"), "10:00 AM");
  assert.equal(formatParkInstantTime("2026-09-20T04:30:00.000Z", "Asia/Kolkata"), "10:00 AM");
  assert.throws(() => formatParkInstantTime("2026-09-20T14:00:00.000Z", ""));
});
