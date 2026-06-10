export const redeemReasonLabel = (reason) => {
  const labels = {
    payment_required: "payment required",
    requires_waiver: "waiver required",
    requires_waiver_no_holder: "link waiver first",
    not_yet_valid: "too early",
    expired: "expired",
    voided: "voided",
    refunded: "refunded",
    already_redeemed: "already redeemed",
    requires_manager_override: "manager override required",
  };
  return labels[reason] || reason || "failed";
};

const normalizedStatus = (value) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");

export const isPaidBooking = (booking = {}) => {
  const status = normalizedStatus(booking.paymentStatus ?? booking.payment_status);
  if (["paid", "fully_paid", "settled", "completed"].includes(status)) return true;
  if (["unpaid", "pending", "partial", "partially_paid", "failed"].includes(status)) return false;

  const explicitBalance = Number(
    booking.balance ?? booking.balanceDue ?? booking.remainingBalance ?? booking.amountDue
  );
  if (Number.isFinite(explicitBalance)) return explicitBalance <= 0;

  const total = Number(booking.totalAmount ?? booking.total);
  const paid = Number(booking.amountPaid ?? booking.paidAmount ?? booking.totalPaid);
  return Number.isFinite(total) && Number.isFinite(paid) && paid >= total;
};

export const getBookingBalanceDue = (booking = {}) => {
  if (isPaidBooking(booking)) return 0;
  return Math.max(
    0,
    Number(booking.balance ?? booking.balanceDue ?? booking.remainingBalance ?? booking.amountDue ?? 0)
  );
};

const firstArray = (...values) => {
  for (const value of values) {
    if (Array.isArray(value)) return value;
  }
  return [];
};

const safeCount = (...values) => {
  for (const value of values) {
    const count = Number(value);
    if (Number.isFinite(count)) return Math.max(0, count);
  }
  return null;
};

export const normalizeBookingTicketsPayload = (payload = {}) => {
  const data = payload?.data;
  return firstArray(
    data,
    data?.tickets,
    data?.rows,
    data?.items,
    payload?.tickets,
    payload?.rows,
    payload?.items
  ).filter((row) => row && typeof row === "object");
};

export const normalizeCheckInParticipantsPayload = (payload = {}) => {
  const data = payload?.data;
  return firstArray(
    data?.participants,
    data?.rows,
    data?.items,
    payload?.participants,
    payload?.rows,
    payload?.items,
    data
  ).filter((row) => row && typeof row === "object");
};

export const normalizeTicketSummaryPayload = (payload = {}, tickets = []) => {
  const data = payload?.data;
  const raw = payload?.summary || data?.summary || data?.ticketSummary || data?.ticketsSummary || {};
  const total = safeCount(raw.total, raw.totalTickets, raw.count, tickets.length) ?? 0;
  const redeemedFallback = tickets.filter(isRedeemedTicket).length;
  const redeemed = safeCount(raw.redeemed, raw.redeemedCount, raw.checkedIn, redeemedFallback) ?? 0;

  return {
    ...raw,
    total,
    redeemed,
    issued: safeCount(raw.issued, raw.issuedCount) ?? Math.max(0, total - redeemed),
    voided: safeCount(raw.voided, raw.refunded, raw.voidedCount) ?? 0,
    expired: safeCount(raw.expired, raw.expiredCount) ?? 0,
  };
};

export const redeemReasonMessage = (reason, ticket) => {
  const start = ticket?.validFrom
    ? new Date(ticket.validFrom).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : null;
  const messages = {
    payment_required: "Collect payment before check-in",
    requires_waiver: "Valid waiver required",
    requires_waiver_no_holder: "Link a waiver holder first",
    not_yet_valid: start ? `Starts at ${start}` : "Too early to check in",
    expired: "Ticket expired",
    voided: "Ticket voided",
    refunded: "Ticket refunded",
    already_redeemed: "Already checked in",
    requires_manager_override: "Manager override required",
  };
  return messages[reason] || redeemReasonLabel(reason);
};

export const isRedeemedTicket = (ticket) =>
  ticket?.status === "redeemed" || ticket?.status === "partially_redeemed";

export const getTicketBlocker = (
  ticket,
  { balanceDue = 0, participantsById = new Map(), now = new Date() } = {}
) => {
  if (!ticket) return "not_found";
  if (isRedeemedTicket(ticket)) return "already_redeemed";
  if (["voided", "refunded", "expired"].includes(ticket.status)) return ticket.status;
  if (balanceDue > 0) return "payment_required";

  // Late arrival: a slot that ENDED earlier today can still be checked in
  // by the cashier (good will — capacity hold has released back into the
  // pool by now, so admitting the late guest doesn't squeeze the venue).
  // Only a slot whose validUntil is a PREVIOUS day is genuinely "expired"
  // by the validity window. Status-based expiry (cron sweep / void) is
  // handled by the earlier status check above.
  if (ticket.validUntil) {
    const validUntil = new Date(ticket.validUntil);
    if (validUntil < now && validUntil.toDateString() !== now.toDateString()) {
      return "expired";
    }
  }
  // Early arrival: a slot starting later TODAY can be checked in by the
  // cashier (good will — paid/waiver-ready guests aren't turned away). Only
  // a FUTURE-DAY slot is still "too early".
  if (ticket.validFrom) {
    const validFrom = new Date(ticket.validFrom);
    if (validFrom > now && validFrom.toDateString() !== now.toDateString()) {
      return "not_yet_valid";
    }
  }

  if (ticket.requiresWaiver) {
    if (!ticket.participantId) return "requires_waiver_no_holder";
    const participant = participantsById.get(Number(ticket.participantId));
    if (!participant || participant.hasValidWaiver === false) return "requires_waiver";
  }

  return null;
};

export const isTicketReadyForCheckIn = (ticket, ticketBlockers) =>
  ticket?.status === "issued" && !ticketBlockers.get(ticket.ticketCode);

const ticketRequiresWaiver = (ticket) =>
  Boolean(ticket?.requiresWaiver || ticket?.activity?.activityDetails?.requiresWaiver);

export const buildCheckInAllPlan = ({ tickets = [], ticketBlockers = new Map() } = {}) => {
  const readyCodes = [];
  const blocked = [];
  const skipped = [];

  tickets.forEach((ticket) => {
    const reason = ticketBlockers.get(ticket.ticketCode);
    if (reason) {
      if (reason !== "already_redeemed") blocked.push({ ticketCode: ticket.ticketCode, reason });
      return;
    }
    if (!isTicketReadyForCheckIn(ticket, ticketBlockers)) return;
    if (!ticket.participantId && !ticketRequiresWaiver(ticket)) {
      skipped.push({ ticketCode: ticket.ticketCode, reason: "transferable_without_participant" });
      return;
    }
    readyCodes.push(ticket.ticketCode);
  });

  return {
    readyCodes,
    readyCount: readyCodes.length,
    blocked,
    skipped,
  };
};

export const summarizeRedeemFailures = (failures = []) => {
  const counts = failures.reduce((acc, failure) => {
    const key = failure?.reason || "failed";
    acc.set(key, (acc.get(key) || 0) + 1);
    return acc;
  }, new Map());
  return [...counts.entries()]
    .slice(0, 2)
    .map(([reason, count]) => `${count} ${redeemReasonLabel(reason)}`)
    .join(", ");
};

export const normalizeGuestName = (value) =>
  String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();

const countValue = (...values) => {
  for (const value of values) {
    const count = Number(value);
    if (Number.isFinite(count)) return Math.max(0, count);
  }
  return null;
};

const bookingGuestTotal = (booking = {}) =>
  countValue(
    booking.totalGuests,
    booking.guestCount,
    booking.totalGuestCount,
    booking.totalTickets,
    booking.ticketCount,
    booking.summary?.total,
    booking.ticketSummary?.total,
    booking.ticketsSummary?.total
  ) ?? 0;

const bookingCheckedInTotal = (booking = {}) =>
  countValue(
    booking.checkedInGuests,
    booking.checkedInCount,
    booking.redeemedGuests,
    booking.redeemedCount,
    booking.summary?.redeemed,
    booking.ticketSummary?.redeemed,
    booking.ticketsSummary?.redeemed
  ) ?? 0;

export const buildSelectedProgress = ({ tickets = [], ticketBlockers = new Map(), redeemedCount, totalCount }) => {
  const redeemedFallback = tickets.filter(isRedeemedTicket).length;
  const total = Math.max(countValue(totalCount) ?? tickets.length, tickets.length, redeemedFallback);
  const checkedIn = Math.min(total, countValue(redeemedCount) ?? redeemedFallback);
  const ready = tickets.filter((ticket) => isTicketReadyForCheckIn(ticket, ticketBlockers)).length;
  const blocked = tickets.filter((ticket) => {
    const reason = ticketBlockers.get(ticket.ticketCode);
    return reason && reason !== "already_redeemed";
  }).length;

  return {
    checkedIn,
    total,
    ready,
    blocked,
    pending: Math.max(0, total - checkedIn),
    percent: total > 0 ? Math.min(100, Math.round((checkedIn / total) * 100)) : 0,
  };
};

export const buildAutoBindPlan = ({
  participants = [],
  tickets = [],
  preferredTicketCode = null,
  preferredParticipantIds = [],
} = {}) => {
  const boundParticipantIds = new Set(
    tickets
      .map((ticket) => Number(ticket.participantId))
      .filter(Boolean)
  );
  const preferredParticipantOrder = new Map(
    preferredParticipantIds
      .map(Number)
      .filter(Boolean)
      .map((id, index) => [id, index])
  );
  const availableParticipants = participants
    .filter((participant) => {
      const id = Number(participant.bookingParticipantId);
      return id && participant.hasValidWaiver && !participant.checkedInAt && !boundParticipantIds.has(id);
    })
    .sort((left, right) => {
      const leftId = Number(left.bookingParticipantId);
      const rightId = Number(right.bookingParticipantId);
      const leftPreferred = preferredParticipantOrder.has(leftId);
      const rightPreferred = preferredParticipantOrder.has(rightId);
      if (leftPreferred !== rightPreferred) return leftPreferred ? -1 : 1;
      if (leftPreferred && rightPreferred) {
        return preferredParticipantOrder.get(leftId) - preferredParticipantOrder.get(rightId);
      }
      return 0;
    });
  const targetTickets = tickets
    .filter((ticket) =>
      ticket.status === "issued" &&
      ticket.requiresWaiver &&
      !ticket.participantId &&
      !isRedeemedTicket(ticket)
    )
    .sort((a, b) => {
      if (!preferredTicketCode) return 0;
      if (a.ticketCode === preferredTicketCode) return -1;
      if (b.ticketCode === preferredTicketCode) return 1;
      return 0;
    });
  const count = Math.min(availableParticipants.length, targetTickets.length);
  const assignments = Array.from({ length: count }, (_, index) => ({
    ticket: targetTickets[index],
    participant: availableParticipants[index],
  }));

  return {
    assignments,
    available: availableParticipants.length,
    target: targetTickets.length,
  };
};

export const buildGuestTotals = (bookings = []) => {
  const totalGuests = bookings.reduce((sum, booking) => sum + bookingGuestTotal(booking), 0);
  const checkedInGuests = bookings.reduce((sum, booking) => sum + bookingCheckedInTotal(booking), 0);
  const completedBookings = bookings.filter(
    (booking) => {
      const total = bookingGuestTotal(booking);
      return total > 0 && bookingCheckedInTotal(booking) >= total;
    }
  ).length;

  return {
    totalGuests,
    checkedInGuests,
    pendingGuests: Math.max(0, totalGuests - checkedInGuests),
    completedBookings,
  };
};
