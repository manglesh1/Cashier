import test from "node:test";
import assert from "node:assert/strict";

import {
  buildAutoBindPlan,
  buildCheckInAllPlan,
  buildGuestTotals,
  buildSelectedProgress,
  getBookingBalanceDue,
  getTicketBlocker,
  isPaidBooking,
  isTicketReadyForCheckIn,
  normalizeBookingTicketsPayload,
  normalizeCheckInParticipantsPayload,
  normalizeTicketSummaryPayload,
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

test("paid booking status wins over stale balance fields", () => {
  const booking = { paymentStatus: "paid", balance: 120, totalAmount: 120, amountPaid: 120 };

  assert.equal(isPaidBooking(booking), true);
  assert.equal(getBookingBalanceDue(booking), 0);
});

test("unpaid booking keeps explicit balance due", () => {
  const booking = { paymentStatus: "pending", balanceDue: 45 };

  assert.equal(isPaidBooking(booking), false);
  assert.equal(getBookingBalanceDue(booking), 45);
});

test("same-day early arrival is allowed to check in (good will)", () => {
  const laterToday = (() => { const d = new Date(now); d.setHours(23, 0, 0, 0); return d.toISOString(); })();
  assert.equal(
    getTicketBlocker(ticket({ validFrom: laterToday }), { balanceDue: 0, now }),
    null
  );
});

test("future-day booking is still too early to check in", () => {
  const tomorrow = (() => { const d = new Date(now); d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0); return d.toISOString(); })();
  assert.equal(
    getTicketBlocker(ticket({ validFrom: tomorrow }), { balanceDue: 0, now }),
    "not_yet_valid"
  );
});

test("same-day past slot allows late check-in (no longer blocked)", () => {
  // Slot ended an hour ago, but it's still TODAY — the capacity hold has
  // released back into the pool, so the cashier can still admit a late
  // guest. Mirrors the early-arrival policy on the validFrom side.
  const oneHourAgo = new Date(now.getTime() - 3600 * 1000).toISOString();
  assert.equal(
    getTicketBlocker(ticket({ validUntil: oneHourAgo }), { balanceDue: 0, now }),
    null
  );
});

test("previous-day expired slot still blocks check-in", () => {
  // A genuinely-stale ticket from a previous day — the cashier should
  // not be able to admit on this. Only the validity window protects
  // against this; status-based expiry (cron sweep / void) is covered
  // by the status check above.
  const yesterday = (() => {
    const d = new Date(now);
    d.setDate(d.getDate() - 1);
    d.setHours(17, 0, 0, 0);
    return d.toISOString();
  })();
  assert.equal(
    getTicketBlocker(ticket({ validUntil: yesterday }), { balanceDue: 0, now }),
    "expired"
  );
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

test("check-in all plan skips transferables, blocks missing waivers, and keeps valid guests", () => {
  const rows = [
    ticket({ ticketCode: "TRANSFERABLE", participantId: null, requiresWaiver: false }),
    ticket({ ticketCode: "NO-HOLDER", participantId: null, requiresWaiver: true }),
    ticket({ ticketCode: "NO-WAIVER", participantId: 2, requiresWaiver: true }),
    ticket({ ticketCode: "READY", participantId: 1, requiresWaiver: true }),
    ticket({ ticketCode: "DONE", status: "redeemed", participantId: 3, requiresWaiver: true }),
  ];
  const participantsById = new Map([
    [1, { bookingParticipantId: 1, hasValidWaiver: true }],
    [2, { bookingParticipantId: 2, hasValidWaiver: false }],
    [3, { bookingParticipantId: 3, hasValidWaiver: true }],
  ]);
  const blockers = new Map(
    rows.map((row) => [row.ticketCode, getTicketBlocker(row, { participantsById, now })])
  );

  assert.deepEqual(buildCheckInAllPlan({ tickets: rows, ticketBlockers: blockers }), {
    readyCodes: ["READY"],
    readyCount: 1,
    blocked: [
      { ticketCode: "NO-HOLDER", reason: "requires_waiver_no_holder" },
      { ticketCode: "NO-WAIVER", reason: "requires_waiver" },
    ],
    skipped: [{ ticketCode: "TRANSFERABLE", reason: "transferable_without_participant" }],
  });
});

test("Select all includes transferable tickets (no participant, no waiver) that check-in-all skips", () => {
  // Real case: a paid party booking whose tickets have no participant linked
  // and don't require a waiver. Each row's own checkbox is enabled, so "Select
  // all" (which uses isTicketReadyForCheckIn) must include them — even though
  // the AUTO "check in all" plan deliberately skips them as transferable.
  const rows = [
    ticket({ ticketCode: "PARTY-1" }),
    ticket({ ticketCode: "PARTY-2" }),
    ticket({ ticketCode: "DONE", status: "redeemed" }),
  ];
  const blockers = new Map(
    rows.map((row) => [row.ticketCode, getTicketBlocker(row, { balanceDue: 0, now })])
  );

  // Select-all gate: both issued party tickets are selectable; redeemed isn't.
  assert.deepEqual(
    rows.filter((row) => isTicketReadyForCheckIn(row, blockers)).map((row) => row.ticketCode),
    ["PARTY-1", "PARTY-2"]
  );
  // Auto check-in-all still skips them (no participant to auto-assign).
  assert.deepEqual(buildCheckInAllPlan({ tickets: rows, ticketBlockers: blockers }).readyCodes, []);
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

test("guest counters tolerate alternate API summary shapes", () => {
  assert.deepEqual(
    buildGuestTotals([
      { summary: { total: 20, redeemed: 5 } },
      { totalTickets: 4, redeemedCount: 4 },
      { ticketSummary: { total: 6, redeemed: 0 } },
    ]),
    { totalGuests: 30, checkedInGuests: 9, pendingGuests: 21, completedBookings: 1 }
  );
});

test("selected progress falls back to redeemed ticket rows when summary is missing", () => {
  const rows = [
    ticket({ ticketCode: "DONE", status: "redeemed" }),
    ticket({ ticketCode: "READY" }),
  ];
  const blockers = new Map(rows.map((row) => [row.ticketCode, getTicketBlocker(row, { now })]));

  assert.deepEqual(
    buildSelectedProgress({ tickets: rows, ticketBlockers: blockers, redeemedCount: undefined, totalCount: undefined }),
    { checkedIn: 1, total: 2, ready: 1, blocked: 0, pending: 1, percent: 50 }
  );
});

test("check-in detail normalizes flat and nested ticket API payloads", () => {
  const rows = [
    ticket({ ticketCode: "A" }),
    ticket({ ticketCode: "B", status: "redeemed" }),
  ];

  assert.deepEqual(normalizeBookingTicketsPayload({ data: rows }), rows);
  assert.deepEqual(normalizeBookingTicketsPayload({ data: { tickets: rows } }), rows);
  assert.deepEqual(
    normalizeTicketSummaryPayload({ data: { tickets: rows, summary: { total: 2, redeemed: 1 } } }, rows),
    { total: 2, redeemed: 1, issued: 1, voided: 0, expired: 0 }
  );
});

test("check-in detail normalizes participant payloads before rendering", () => {
  const participants = [
    { bookingParticipantId: 1, displayName: "Bimal Gayali" },
  ];

  assert.deepEqual(normalizeCheckInParticipantsPayload({ data: { participants } }), participants);
  assert.deepEqual(normalizeCheckInParticipantsPayload({ participants }), participants);
  assert.deepEqual(normalizeCheckInParticipantsPayload({ data: null }), []);
});

test("auto-bind plan prefers newly linked waiver holders and target ticket", () => {
  const tickets = [
    ticket({ ticketCode: "A", ticketId: 1, requiresWaiver: true }),
    ticket({ ticketCode: "B", ticketId: 2, requiresWaiver: true }),
  ];
  const participants = [
    { bookingParticipantId: 10, hasValidWaiver: true },
    { bookingParticipantId: 20, hasValidWaiver: true },
  ];

  const plan = buildAutoBindPlan({
    participants,
    tickets,
    preferredTicketCode: "B",
    preferredParticipantIds: [20],
  });

  assert.deepEqual(
    plan.assignments.map((assignment) => ({
      ticketCode: assignment.ticket.ticketCode,
      participantId: assignment.participant.bookingParticipantId,
    })),
    [
      { ticketCode: "B", participantId: 20 },
      { ticketCode: "A", participantId: 10 },
    ]
  );
});
