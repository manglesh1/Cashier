import test from "node:test";
import assert from "node:assert/strict";

import {
  buildGuestTotals,
  buildSelectedProgress,
  getTicketBlocker,
  isTicketReadyForCheckIn,
  summarizeRedeemFailures,
} from "./checkInGuards.js";

const now = new Date("2026-05-18T10:00:00Z");

function ticket(overrides = {}) {
  return {
    ticketCode: "AS-T-001",
    status: "issued",
    participantId: null,
    requiresWaiver: false,
    validFrom: null,
    validUntil: null,
    ...overrides,
  };
}

test("unpaid booking blocks ticket check-in in the POS guard", () => {
  assert.equal(getTicketBlocker(ticket(), { balanceDue: 12.5, now }), "payment_required");
});

test("waiver-required ticket without participant cannot check in", () => {
  assert.equal(
    getTicketBlocker(ticket({ requiresWaiver: true }), { balanceDue: 0, now }),
    "requires_waiver_no_holder"
  );
});

test("waiver-required ticket with participant but no valid waiver cannot check in", () => {
  const participantsById = new Map([[7, { bookingParticipantId: 7, hasValidWaiver: false }]]);
  assert.equal(
    getTicketBlocker(ticket({ requiresWaiver: true, participantId: 7 }), {
      balanceDue: 0,
      participantsById,
      now,
    }),
    "requires_waiver"
  );
});

test("waiver-required ticket with missing participant status is blocked conservatively", () => {
  assert.equal(
    getTicketBlocker(ticket({ requiresWaiver: true, participantId: 7 }), {
      balanceDue: 0,
      participantsById: new Map(),
      now,
    }),
    "requires_waiver"
  );
});

test("valid waiver ticket is ready for check-in", () => {
  const participantsById = new Map([[7, { bookingParticipantId: 7, hasValidWaiver: true }]]);
  const row = ticket({ requiresWaiver: true, participantId: 7 });
  const blockers = new Map([[row.ticketCode, getTicketBlocker(row, { participantsById, now })]]);

  assert.equal(blockers.get(row.ticketCode), null);
  assert.equal(isTicketReadyForCheckIn(row, blockers), true);
});

test("select-all/check-in-all guard exposes only actionable issued tickets", () => {
  const rows = [
    ticket({ ticketCode: "READY", requiresWaiver: true, participantId: 1 }),
    ticket({ ticketCode: "NO-WAIVER", requiresWaiver: true, participantId: 2 }),
    ticket({ ticketCode: "NO-HOLDER", requiresWaiver: true, participantId: null }),
    ticket({ ticketCode: "DONE", status: "redeemed" }),
  ];
  const participantsById = new Map([
    [1, { bookingParticipantId: 1, hasValidWaiver: true }],
    [2, { bookingParticipantId: 2, hasValidWaiver: false }],
  ]);
  const blockers = new Map(
    rows.map((row) => [row.ticketCode, getTicketBlocker(row, { participantsById, now })])
  );

  assert.deepEqual(rows.filter((row) => isTicketReadyForCheckIn(row, blockers)).map((row) => row.ticketCode), [
    "READY",
  ]);
  const blocked = [...blockers]
    .map(([ticketCode, reason]) => ({ ticketCode, reason }))
    .filter((item) => item.reason && item.reason !== "already_redeemed");

  assert.equal(summarizeRedeemFailures(blocked), "1 waiver required, 1 link waiver first");
});

test("selected booking progress separates ready, blocked, pending, and complete tickets", () => {
  const rows = [
    ticket({ ticketCode: "READY", participantId: 1 }),
    ticket({ ticketCode: "BLOCKED", requiresWaiver: true, participantId: null }),
    ticket({ ticketCode: "DONE", status: "redeemed" }),
  ];
  const blockers = new Map(rows.map((row) => [row.ticketCode, getTicketBlocker(row, { now })]));

  assert.deepEqual(
    buildSelectedProgress({ tickets: rows, ticketBlockers: blockers, redeemedCount: 1, totalCount: 3 }),
    { checkedIn: 1, total: 3, ready: 1, blocked: 1, pending: 2, percent: 33 }
  );
});

test("guest counters match live operation labels", () => {
  assert.deepEqual(
    buildGuestTotals([
      { totalGuests: 60, checkedInGuests: 12 },
      { totalGuests: 2, checkedInGuests: 2 },
      { totalGuests: 1, checkedInGuests: 0 },
    ]),
    { totalGuests: 63, checkedInGuests: 14, pendingGuests: 49, completedBookings: 1 }
  );
});
