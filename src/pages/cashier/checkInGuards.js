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

  if (ticket.validUntil && new Date(ticket.validUntil) < now) return "expired";
  if (ticket.validFrom && new Date(ticket.validFrom) > now) return "not_yet_valid";

  if (ticket.requiresWaiver) {
    if (!ticket.participantId) return "requires_waiver_no_holder";
    const participant = participantsById.get(Number(ticket.participantId));
    if (!participant || participant.hasValidWaiver === false) return "requires_waiver";
  }

  return null;
};

export const isTicketReadyForCheckIn = (ticket, ticketBlockers) =>
  ticket?.status === "issued" && !ticketBlockers.get(ticket.ticketCode);

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

export const buildSelectedProgress = ({ tickets = [], ticketBlockers = new Map(), redeemedCount = 0, totalCount }) => {
  const total = Number.isFinite(Number(totalCount)) ? Number(totalCount) : tickets.length;
  const checkedIn = Number(redeemedCount || 0);
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
  const totalGuests = bookings.reduce((sum, b) => sum + Number(b.totalGuests || 0), 0);
  const checkedInGuests = bookings.reduce((sum, b) => sum + Number(b.checkedInGuests || 0), 0);
  const completedBookings = bookings.filter(
    (b) => Number(b.totalGuests || 0) > 0 && Number(b.checkedInGuests || 0) >= Number(b.totalGuests || 0)
  ).length;

  return {
    totalGuests,
    checkedInGuests,
    pendingGuests: Math.max(0, totalGuests - checkedInGuests),
    completedBookings,
  };
};
