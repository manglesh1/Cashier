// CheckIn — cashier check-in screen.
// Lists today's confirmed bookings, lets the cashier search by
// name/email/phone/booking number, and one-tap-checks-in the whole
// party via the checkInAllTickets endpoint (which iterates the booking's
// pending tickets, mints redemption events, and respects waiver/expiry
// rules — the exact same path the Redeem screen takes).

import React, { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Icon } from "./Icon";
import { StatusPill } from "./StatusPill";
import { CashierScreenBoundary } from "./CashierScreenBoundary";
import {
  useGetAllBookingQuery,
  useGetCheckInStatusQuery,
  useCheckInParticipantsMutation,
  useUndoParticipantCheckInMutation,
  useUpsertParticipantsMutation,
  useLazySearchWaiversQuery,
  useLinkParticipantFromWaiverMutation,
  useRemoveParticipantMutation,
  useRecordPaymentMutation,
  useSendBookingConfirmationMutation,
  useAdjustBookingOrderMutation,
  useGetOrderAdjustmentCatalogQuery,
  useReslotBookingMutation,
  useGetAvailabilityQuery,
} from "../../features/bookings/bookingApi";
import {
  useGetBookingTicketsQuery,
  useCheckInAllTicketsMutation,
  useRedeemTicketMutation,
  useBindTicketHolderMutation,
} from "../../features/tickets/ticketApi";
import { useLazyValidateDiscountCodeQuery } from "../../features/discount/discountApi";
import {
  useLazyLookupGiftCardQuery,
  useRedeemGiftCardMutation,
} from "../../features/vouchers/voucherApi";
import ManagerOverridePrompt from "../../components/ManagerOverridePrompt";
import { useDebounceSearch } from "../../hooks/useDebounceSearch";
import { getTerminal } from "../../lib/terminal";
import { printReceipt, openCashDrawer } from "../../lib/hardware";
import { useEffectiveSettings } from "../../lib/useEffectiveSettings";
import { moneyFmt, roundMoney } from "../../lib/money";
import {
  isSessionBookable,
  isVariationUnavailable,
  getVariationSlotIds,
  getStartTime,
  timeRangeFromSession,
  formatShortDate,
} from "./scheduleHelpers";
import { adminBookingDetailUrl } from "../../lib/adminLink";
import {
  buildAutoBindPlan,
  buildCheckInAllPlan,
  buildGuestTotals,
  buildSelectedProgress,
  getBookingBalanceDue,
  getTicketBlocker,
  isRedeemedTicket,
  isTicketReadyForCheckIn,
  isPaidBooking,
  normalizeBookingTicketsPayload,
  normalizeCheckInParticipantsPayload,
  normalizeGuestName,
  normalizeTicketSummaryPayload,
  redeemReasonMessage,
  summarizeRedeemFailures,
} from "./checkInGuards";

const localIsoDate = (date = new Date()) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};
const today = localIsoDate();
const asArray = (value) => (Array.isArray(value) ? value : []);
const displayText = (value, fallback = "") => {
  if (value === null || value === undefined || value === "") return fallback;
  if (["string", "number", "boolean"].includes(typeof value)) return String(value);
  if (typeof value === "object") {
    return displayText(
      value.displayName ?? value.name ?? value.activityName ?? value.variationName ?? value.label,
      fallback
    );
  }
  return fallback;
};
const firstText = (...values) => {
  const fallback = values[values.length - 1] ?? "";
  for (const value of values) {
    const text = displayText(value, "");
    if (text) return text;
  }
  return displayText(fallback, "");
};

function buildBookingPromoCartLines(booking) {
  const bookingItems = Array.isArray(booking?.bookingItems) ? booking.bookingItems : [];
  const purchasedItems = Array.isArray(booking?.purchasedItems) ? booking.purchasedItems : [];
  return [
    ...bookingItems.map((item) => ({
      activityId: Number(item.activityId || item.activity?.activityId || item.variation?.activityId || 0) || null,
      variationId: Number(item.variationId || item.variation?.variationId || 0) || null,
      activityType: item.activityTypeKey || item.productType || item.activity?.typeKey || null,
      quantity: Math.max(1, Number(item.noOfTickets || item.quantity || 1) || 1),
      subtotal: roundMoney(item.totalPrice || item.total || item.amount || 0),
      date: item.date || item.activityDate || null,
      timefrom: item.timefrom || item.fromTime || item.startTime || null,
    })),
    ...purchasedItems
      .filter((item) => !item.isBundleInclusion)
      .map((item) => ({
        activityId: Number(item.activityId || 0) || null,
        variationId: Number(item.variationId || 0) || null,
        activityType: item.activityTypeKey || item.productType || null,
        quantity: Math.max(1, Number(item.count || item.quantity || 1) || 1),
        subtotal: roundMoney(item.total || item.totalPrice || 0),
      })),
  ].filter((line) => line.subtotal > 0 && (line.activityId || line.variationId || line.activityType));
}

const fmtTime = (range) => formatClockLabel((range || "").split(/[–-]/)[0].trim()) || "—";

const formatClockLabel = (value) => {
  if (!value) return "";
  const raw = String(value).trim();
  const timeMatch = raw.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (timeMatch) {
    const hour24 = Number(timeMatch[1]);
    const hour = hour24 % 12 || 12;
    const suffix = hour24 >= 12 ? "PM" : "AM";
    return `${hour}:${timeMatch[2]} ${suffix}`;
  }
  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }
  return raw;
};

const formatTimeRange = (value) => {
  const raw = String(value || "").trim();
  if (!raw || raw === "—") return "";
  const parts = raw.split(/\s*(?:–|-|to)\s*/i).filter(Boolean);
  if (parts.length >= 2) {
    return `${formatClockLabel(parts[0])} - ${formatClockLabel(parts[1])}`;
  }
  return formatClockLabel(raw);
};

const formatScheduledTicketTime = (ticket, bookingTimeRange = "") => {
  const slotStart = ticket?.slot?.fromTime;
  const slotEnd = ticket?.slot?.toTime;
  if (slotStart && slotEnd) {
    return `${formatClockLabel(slotStart)} - ${formatClockLabel(slotEnd)}`;
  }

  if (bookingTimeRange && bookingTimeRange !== "—") return formatTimeRange(bookingTimeRange);

  if (ticket?.validFrom && ticket?.validUntil) {
    const start = new Date(ticket.validFrom);
    const end = new Date(ticket.validUntil);
    const durationHours = (end - start) / (1000 * 60 * 60);
    const startsAtDayOpen = start.getHours() === 0 && start.getMinutes() === 0;
    if (startsAtDayOpen && durationHours > 6) return `until ${formatClockLabel(ticket.validUntil)}`;
    return `${formatClockLabel(ticket.validFrom)} - ${formatClockLabel(ticket.validUntil)}`;
  }

  return ticket?.validFrom ? formatClockLabel(ticket.validFrom) : "";
};



export function CheckIn() {
  const { searchTerm, inputValue, setDebouncedSearch } = useDebounceSearch(400);
  const [selected, setSelected] = useState(null);
  const [bookingBucket, setBookingBucket] = useState("upcoming");

  const { data, isLoading, refetch } = useGetAllBookingQuery({
    page: 1,
    limit: 100,
    search: searchTerm,
    dateFrom: today,
    dateTo: today,
    status: ["confirmed", "pending"],
    paymentStatus: [],
    activityId: [],
  });

  const bookings = asArray(data?.data);
  const stats = data?.stats || {};

  useEffect(() => {
    if (!selected?.bookingId) return;
    const updated = bookings.find((b) => String(b.bookingId) === String(selected.bookingId));
    if (updated && updated !== selected) setSelected(updated);
  }, [bookings, selected?.bookingId]);

  const partition = useMemo(() => {
    const now = new Date();
    return bookings
      .map((b) => ({
        ...b,
        _arrival: parseTime(b.timeRange),
        _waiverComplete: !b.waiverRequired || (b.signedWaivers ?? 0) >= (b.totalGuests ?? 0),
        _isPaid: isPaidBooking(b),
        _totalGuests: Number(b.totalGuests || 0),
        _checkedInGuests: Number(b.checkedInGuests || 0),
      }))
      .sort((a, b) => (a._arrival || 9e15) - (b._arrival || 9e15))
      .map((b) => ({
        ...b,
        _isUpcoming: b._arrival && b._arrival > now,
        _isLate: b._arrival && b._arrival < now,
        _isCompleted: b._totalGuests > 0 && b._checkedInGuests >= b._totalGuests,
        _isInProgress: b._checkedInGuests > 0 && b._checkedInGuests < b._totalGuests,
      }));
  }, [bookings]);

  const bookingBuckets = useMemo(() => {
    const buckets = {
      upcoming: [],
      inProgress: [],
      completed: [],
    };
    partition.forEach((b) => {
      // Route by check-in status. A fully checked-in booking belongs in
      // Completed (it was previously mis-routed to Upcoming whenever the
      // list payload lacked a completion timestamp).
      if (b._isCompleted) buckets.completed.push(b);
      else if (b._isInProgress) buckets.inProgress.push(b);
      else buckets.upcoming.push(b);
    });
    return buckets;
  }, [partition]);

  const visibleBookings = bookingBuckets[bookingBucket] || [];

  const totalToday = stats.totalBookings ?? stats.bookings ?? stats.total ?? bookings.length;
  const guestTotals = useMemo(() => buildGuestTotals(bookings), [bookings]);

  const refreshSelectedBooking = async () => {
    const result = await refetch();
    const nextRows = asArray(result?.data?.data);
    if (!selected?.bookingId) return;
    const updated = nextRows.find((b) => String(b.bookingId) === String(selected.bookingId));
    if (updated) setSelected(updated);
  };

  return (
    <div style={{ flex: 1, minHeight: 0, overflow: "hidden", display: "flex", flexDirection: "column" }}>
      {/* Search bar */}
      <div style={{ padding: "16px 28px", borderBottom: "1px solid var(--ink-100)", display: "flex", gap: 12, alignItems: "center", flexShrink: 0 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "12px 18px",
            background: "#fff",
            border: "1.5px solid var(--ink-200)",
            borderRadius: 14,
            flex: 1,
            maxWidth: 480,
            minWidth: 0,
          }}
        >
          <Icon name="search" size={20} stroke={2} style={{ color: "var(--ink-500)" }} />
          <input
            value={inputValue}
            onChange={(e) => setDebouncedSearch(e.target.value)}
            placeholder="Search by name, email, phone, or booking ID…"
            style={{ all: "unset", flex: 1, minWidth: 0, fontSize: 16 }}
          />
        </div>
        <button
          type="button"
          onClick={refetch}
          className="a-btn a-btn--ghost a-btn--sm"
          title="Refresh"
        >
          <Icon name="refresh" size={14} /> Refresh
        </button>
      </div>

      {/* Stats strip */}
      <div style={{
        padding: "12px 28px",
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))",
        gap: 12,
        flexShrink: 0,
        borderBottom: "1px solid var(--ink-100)",
      }}>
        <Stat label="Booked today" value={totalToday} hint="Bookings" />
        <Stat
          label="Guests checked in"
          value={guestTotals.checkedInGuests}
          hint={`of ${guestTotals.totalGuests} guests`}
          fg="var(--color-success)"
        />
        <Stat
          label="Pending guests"
          value={guestTotals.pendingGuests}
          hint="Guests remaining"
          fg={guestTotals.pendingGuests > 0 ? "#8A5A00" : "var(--color-success)"}
        />
        <Stat label="Completed bookings" value={guestTotals.completedBookings} hint="Fully checked in" />
      </div>

      {/* Body — list (left) + selected detail (right) */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden", minHeight: 0 }}>
        <div style={{
          width: "clamp(300px, 24vw, 360px)",
          flex: "0 0 clamp(300px, 24vw, 360px)",
          overflowY: "auto",
          overscrollBehavior: "contain",
          scrollbarGutter: "stable",
          minHeight: 0,
          padding: "12px 14px 12px 18px",
          borderRight: "1px solid var(--ink-100)",
          background: "var(--ink-25)",
        }}>
          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
            gap: 6,
            marginBottom: 10,
          }}>
            <BookingBucketTab
              label="Upcoming"
              count={bookingBuckets.upcoming.length}
              active={bookingBucket === "upcoming"}
              onClick={() => setBookingBucket("upcoming")}
            />
            <BookingBucketTab
              label="In Progress"
              count={bookingBuckets.inProgress.length}
              active={bookingBucket === "inProgress"}
              onClick={() => setBookingBucket("inProgress")}
            />
            <BookingBucketTab
              label="Completed"
              count={bookingBuckets.completed.length}
              active={bookingBucket === "completed"}
              onClick={() => setBookingBucket("completed")}
            />
          </div>

          {isLoading ? (
            <div style={{ padding: 32, textAlign: "center", color: "var(--ink-500)" }}>Loading…</div>
          ) : visibleBookings.length === 0 ? (
            <div style={{ padding: 32, textAlign: "center", color: "var(--ink-500)" }}>
              {bookingBucket === "completed"
                ? "No fully checked-in bookings yet."
                : `No ${bookingBucket === "inProgress" ? "in progress" : bookingBucket} bookings.`}
            </div>
          ) : (
            visibleBookings.map((b) => (
              <BookingRow
                key={b.bookingId}
                b={b}
                isSelected={selected?.bookingId === b.bookingId}
                onClick={() => setSelected(b)}
              />
            ))
          )}
        </div>
        <aside
          style={{
            flex: 1,
            overflow: "hidden",
            padding: 0,
            background: "var(--ink-25)",
            display: "flex",
            flexDirection: "column",
            minHeight: 0,
            minWidth: 0,
          }}
        >
          {selected ? (
            <CashierScreenBoundary screenKey={`checkin-detail:${selected.bookingId}`}>
              <SelectedBookingDetail booking={selected} onCheckedIn={refreshSelectedBooking} />
            </CashierScreenBoundary>
          ) : (
            <EmptyDetail />
          )}
        </aside>
      </div>
    </div>
  );
}

function parseTime(range) {
  const m = String(range || "").match(/(\d{1,2}):(\d{2})\s*(AM|PM|am|pm)?/);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  const ampm = (m[3] || "").toUpperCase();
  if (ampm === "PM" && h !== 12) h += 12;
  if (ampm === "AM" && h === 12) h = 0;
  const d = new Date();
  d.setHours(h, min, 0, 0);
  return d;
}

function Stat({ label, value, fg, hint }) {
  return (
    <div
      title={hint ? `${label}: ${value} (${hint})` : `${label}: ${value}`}
      style={{
        minWidth: 0,
        padding: "8px 10px",
        background: "white",
        border: "1.5px solid var(--ink-100)",
        borderRadius: 10,
      }}
    >
      <div style={{ fontSize: 11, fontWeight: 800, color: "var(--ink-500)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
        {label}
      </div>
      <div
        className="display-num"
        style={{
          fontFamily: "var(--font-display, inherit)",
          fontSize: 24,
          fontWeight: 800,
          color: fg || "var(--ink-900)",
          marginTop: 2,
          lineHeight: 1,
        }}
      >
        {value}
      </div>
      {hint && (
        <div style={{ marginTop: 4, fontSize: 10, fontWeight: 700, color: "var(--ink-500)", lineHeight: 1.1 }}>
          {hint}
        </div>
      )}
    </div>
  );
}

function BookingBucketTab({ label, count, active, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        appearance: "none",
        border: active ? "2px solid var(--aero-orange-500)" : "1.5px solid var(--ink-200)",
        borderRadius: 10,
        background: active ? "var(--aero-orange-50)" : "white",
        color: active ? "var(--aero-orange-700)" : "var(--ink-700)",
        padding: "8px 6px",
        cursor: "pointer",
        display: "grid",
        gap: 2,
        justifyItems: "center",
        minWidth: 0,
      }}
    >
      <span style={{ fontSize: 10, fontWeight: 900, lineHeight: 1.1, whiteSpace: "nowrap" }}>
        {label}
      </span>
      <span style={{ fontSize: 17, fontWeight: 950, fontFamily: "var(--font-display, inherit)", lineHeight: 1 }}>
        {count}
      </span>
    </button>
  );
}

function BookingRow({ b, isSelected, onClick }) {
  // Primary pill reflects check-in state first (Checked in / partly in),
  // falling back to waiver readiness only when nobody's checked in yet.
  let statusTone;
  let statusLabel;
  if (b._isCompleted) {
    statusTone = "success";
    statusLabel = "Checked in";
  } else if (b._isInProgress) {
    statusTone = "info";
    statusLabel = `${b._checkedInGuests}/${b._totalGuests} in`;
  } else if (b._waiverComplete) {
    statusTone = "success";
    statusLabel = "Ready";
  } else {
    const missing = (b.totalGuests || 0) - (b.signedWaivers || 0);
    statusTone = "danger";
    statusLabel = `${missing} waiver${missing === 1 ? "" : "s"} missing`;
  }

  return (
    <div
      onClick={onClick}
      style={{
        display: "grid",
        gridTemplateColumns: "54px minmax(0, 1fr) 18px",
        gridTemplateRows: "auto auto auto",
        columnGap: 10,
        rowGap: 7,
        alignItems: "center",
        padding: "12px 12px",
        marginBottom: 8,
        background: isSelected ? "var(--aero-orange-50)" : "#fff",
        border: isSelected ? "2px solid var(--aero-orange-500)" : "1.5px solid var(--ink-200)",
        borderRadius: 12,
        cursor: "pointer",
      }}
    >
      <div
        style={{
          fontFamily: "var(--font-mono)",
          fontWeight: 700,
          fontSize: 13,
          color: b._isLate ? "var(--color-danger)" : b._isUpcoming ? "var(--aero-orange-600)" : "var(--ink-700)",
          gridColumn: "1",
          gridRow: "1 / span 3",
          alignSelf: "center",
        }}
      >
        {fmtTime(b.timeRange)}
      </div>
      <div style={{ gridColumn: "2", gridRow: "1", lineHeight: 1.25, minWidth: 0 }}>
        <div style={{
          fontWeight: 800,
          fontSize: 14,
          color: "var(--ink-900)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}>
          {displayText(b.bookingName, "Walk-in")}
        </div>
      </div>
      <div style={{
        gridColumn: "2",
        gridRow: "2",
        fontSize: 11,
        lineHeight: 1.25,
        color: "var(--ink-500)",
        display: "flex",
        gap: 6,
        minWidth: 0,
      }}>
        <span style={{ fontFamily: "var(--font-mono)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {displayText(b.bookingNumber, "Booking")}
        </span>
        <span style={{ flexShrink: 0 }}>{b.totalGuests || 0} pax</span>
      </div>
      <div style={{
        gridColumn: "2",
        gridRow: "3",
        display: "flex",
        alignItems: "center",
        gap: 8,
        minWidth: 0,
        overflow: "hidden",
      }}>
        <StatusPill tone={statusTone}>{statusLabel}</StatusPill>
        {!b._isPaid && <StatusPill tone="danger">Unpaid</StatusPill>}
      </div>
      <Icon name="chevron-right" size={18} style={{ color: "var(--ink-400)", gridColumn: "3", gridRow: "1 / span 3", justifySelf: "end" }} />
    </div>
  );
}

function EmptyDetail() {
  return (
    <div style={{ padding: 24, textAlign: "center", color: "var(--ink-500)" }}>
      <Icon name="user-round" size={42} style={{ color: "var(--ink-200)", marginBottom: 12 }} />
      <div style={{ fontWeight: 700, color: "var(--ink-700)", marginBottom: 4 }}>Select a booking</div>
      <div style={{ fontSize: 13 }}>Tap a row on the left to see details, waiver status, and check the party in.</div>
    </div>
  );
}

function SelectedBookingDetail({ booking, onCheckedIn }) {
  const bookingNumber = displayText(booking.bookingNumber, "Booking");
  const bookingName = displayText(booking.bookingName, "Walk-in");
  const bookingActivityName = displayText(booking.activityName, "Activity");
  const bookingTimeRange = formatTimeRange(displayText(booking.timeRange, "")) || "—";

  // Tickets are the source of truth — one row per redeemable line.
  const { data: ticketsData, isLoading: ticketsLoading, refetch: refetchTickets } =
    useGetBookingTicketsQuery(booking.bookingId, { skip: !booking.bookingId });
  const { data: checkInData, refetch: refetchStatus } =
    useGetCheckInStatusQuery(booking.bookingId, { skip: !booking.bookingId });
  const [redeemTicket, { isLoading: redeeming }] = useRedeemTicketMutation();
  const [checkInAll, { isLoading: checkingInAll }] = useCheckInAllTicketsMutation();
  const [bindHolder, { isLoading: binding }] = useBindTicketHolderMutation();
  const [selectedCodes, setSelectedCodes] = useState(new Set());
  const [hideCheckedIn, setHideCheckedIn] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState("card");
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentNote, setPaymentNote] = useState("");
  const [paymentComplete, setPaymentComplete] = useState(null);
  const [paymentDiscount, setPaymentDiscount] = useState(null);
  const [addItemOpen, setAddItemOpen] = useState(false);
  const [waiverTargetCode, setWaiverTargetCode] = useState(null);
  const [recordPayment, { isLoading: recordingPayment }] = useRecordPaymentMutation();
  const [sendBookingConfirmation, { isLoading: sendingReceipt }] = useSendBookingConfirmationMutation();
  const [adjustBookingOrder, { isLoading: adjustingOrder }] = useAdjustBookingOrderMutation();
  const [redeemGiftCard, { isLoading: gcRedeeming }] = useRedeemGiftCardMutation();

  const tickets = useMemo(() => normalizeBookingTicketsPayload(ticketsData), [ticketsData]);
  const summary = useMemo(() => normalizeTicketSummaryPayload(ticketsData, tickets), [ticketsData, tickets]);
  const redeemedCount = (summary.redeemed ?? 0);
  const totalCount = summary.total ?? tickets.length;
  const remaining = Math.max(0, totalCount - redeemedCount);
  const balanceDue = getBookingBalanceDue(booking);
  const isFullyCheckedIn = totalCount > 0 && redeemedCount >= totalCount;
  const [waiverModalOpen, setWaiverModalOpen] = useState(false);
  const [removeParticipant] = useRemoveParticipantMutation();

  const refresh = async () => {
    await Promise.all([
      refetchTickets(),
      refetchStatus(),
    ]);
    await onCheckedIn?.();
  };

  const handleAdjustOrder = async (payload) => {
    const promise = adjustBookingOrder({ bookingId: booking.bookingId, ...payload }).unwrap();
    toast.promise(promise, {
      loading: "Updating order...",
      success: (res) => {
        refresh();
        return res?.message || "Order updated";
      },
      error: (err) => err?.data?.error || err?.data?.message || "Could not update order",
    });
    await promise;
  };

  useEffect(() => {
    if (!editorOpen) return undefined;

    const handleMessage = (event) => {
      const type = event?.data?.type;
      if (
        type !== "movira:booking-editor-close" &&
        type !== "movira:booking-editor-updated"
      ) return;
      if (type === "movira:booking-editor-close") setEditorOpen(false);
      refresh();
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [editorOpen]);

  // Booking-wide pool of waiver-eligible holders. The candidate set per
  // ticket is this pool minus participants already bound to other tickets.
  const allParticipants = useMemo(
    () => normalizeCheckInParticipantsPayload(checkInData),
    [checkInData]
  );
  const participantsById = useMemo(() => {
    const map = new Map();
    allParticipants.forEach((participant) => {
      map.set(Number(participant.bookingParticipantId), participant);
    });
    return map;
  }, [allParticipants]);

  // Map: bookingParticipantId → ticketId currently holding them.
  // Used to remove a person from other tickets' candidate lists once picked.
  const participantToTicket = useMemo(() => {
    const m = new Map();
    for (const t of tickets) {
      if (t.participantId) m.set(Number(t.participantId), t.ticketId);
    }
    return m;
  }, [tickets]);

  const candidatesFor = (ticket) => {
    if (ticket.participantId) return [];
    return allParticipants.filter((p) => {
      if (!p.hasValidWaiver) return false;
      if (p.checkedInAt) return false;
      const otherTicketId = participantToTicket.get(Number(p.bookingParticipantId));
      if (otherTicketId && otherTicketId !== ticket.ticketId) return false;
      return true;
    });
  };

  const autoBindReadyHolders = async ({
    participantRows = allParticipants,
    ticketRows = tickets,
    preferredTicketCode = null,
    preferredParticipantIds = [],
  } = {}) => {
    const plan = buildAutoBindPlan({
      participants: participantRows,
      tickets: ticketRows,
      preferredTicketCode,
      preferredParticipantIds,
    });
    if (plan.assignments.length <= 0) {
      return { bound: 0, available: plan.available, target: plan.target };
    }

    let bound = 0;
    for (const { ticket, participant } of plan.assignments) {
      await bindHolder({
        ticketCode: ticket.ticketCode,
        participantId: participant.bookingParticipantId,
        bookingId: booking.bookingId,
      }).unwrap();
      bound += 1;
    }
    await Promise.all([refetchTickets(), refetchStatus()]);
    await onCheckedIn?.();
    return { bound, available: plan.available, target: plan.target };
  };

  const handleAutoBindReadyHolders = async () => {
    const promise = autoBindReadyHolders();
    toast.promise(promise, {
      loading: "Assigning waiver holders...",
      success: (result) => {
        if (result.bound > 0) return `Assigned ${result.bound} holder${result.bound === 1 ? "" : "s"}`;
        if (result.target === 0) return "No waiver-required tickets need holders";
        if (result.available === 0) return "No unassigned waiver holders available";
        return "No holders assigned";
      },
      error: (err) => err?.data?.error || err?.data?.message || "Could not assign holders",
    });
    await promise.catch(() => null);
  };

  const handleWaiverLinked = async (linkResult) => {
    const [ticketResult, statusResult] = await Promise.all([refetchTickets(), refetchStatus()]);
    const nextTickets = normalizeBookingTicketsPayload(ticketResult?.data);
    const nextParticipants = normalizeCheckInParticipantsPayload(statusResult?.data);
    const autoResult = await autoBindReadyHolders({
      participantRows: nextParticipants.length ? nextParticipants : allParticipants,
      ticketRows: nextTickets.length ? nextTickets : tickets,
      preferredTicketCode: waiverTargetCode,
      preferredParticipantIds: linkResult?.data?.linkedParticipantIds || [],
    });
    await onCheckedIn?.();
    if (autoResult.bound > 0) {
      toast.success(`Assigned ${autoResult.bound} holder${autoResult.bound === 1 ? "" : "s"} to tickets`);
    } else {
      const created = linkResult?.data?.created || 0;
      const covered = linkResult?.data?.covered || 0;
      if (created > 0 || covered > 0) toast.info("Waiver linked. Pick a holder on the ticket row.");
    }
    setWaiverTargetCode(null);
  };

  const handleBind = async (ticketCode, participantId) => {
    const promise = bindHolder({
      ticketCode,
      participantId,
      bookingId: booking.bookingId,
    }).unwrap();
    toast.promise(promise, {
      loading: "Linking holder...",
      success: () => { refetchTickets(); refetchStatus(); return "Linked"; },
      error: (err) => err?.data?.error || "Could not link",
    });
  };

  const handleUnbind = async (ticketCode) => {
    const promise = bindHolder({
      ticketCode,
      participantId: null,
      bookingId: booking.bookingId,
    }).unwrap();
    toast.promise(promise, {
      loading: "Unlinking…",
      success: () => { refetchTickets(); refetchStatus(); return "Unlinked"; },
      error: (err) => err?.data?.error || "Could not unlink",
    });
  };


  const visibleTickets = useMemo(
    () => (hideCheckedIn ? tickets.filter((t) => t.status !== "redeemed") : tickets),
    [tickets, hideCheckedIn]
  );

  const ticketBlockers = useMemo(() => {
    const now = new Date();
    const map = new Map();
    tickets.forEach((ticket) => {
      map.set(ticket.ticketCode, getTicketBlocker(ticket, { balanceDue, participantsById, now }));
    });
    return map;
  }, [tickets, balanceDue, participantsById]);

  // Late arrival: if a session ticket has expired, the cashier can move the
  // booking into an available slot today (capacity-correct re-slot) so the
  // guest can still be checked in. Only payment_required does NOT count as
  // expired — that's a separate (pay-first) gate.
  const [reslotOpen, setReslotOpen] = useState(false);
  const [reslotBooking, { isLoading: reslotting }] = useReslotBookingMutation();
  const expiredTicket = useMemo(
    () => tickets.find((t) => ticketBlockers.get(t.ticketCode) === "expired") || null,
    [tickets, ticketBlockers]
  );
  // An in-progress session (started, not yet ended) that can still be checked
  // in. The cashier may ALSO move the party to another open slot today if they
  // want — but check-in here stays available (it's not blocked).
  const ongoingTicket = useMemo(() => {
    const now = new Date();
    return (
      tickets.find((t) => {
        if (ticketBlockers.get(t.ticketCode)) return false; // blocked → handled elsewhere
        if (isRedeemedTicket(t)) return false; // already checked in
        const start = t.validFrom ? new Date(t.validFrom) : null;
        const end = t.validUntil ? new Date(t.validUntil) : null;
        return start && end && start <= now && now < end;
      }) || null
    );
  }, [tickets, ticketBlockers]);
  const reslotSource = expiredTicket || ongoingTicket;
  const reslotIsExpired = Boolean(expiredTicket);
  const reslotActivity = reslotSource
    ? {
        activityId: Number(reslotSource.activityId || reslotSource.activity?.activityId) || null,
        variationId: Number(reslotSource.variationId || reslotSource.variation?.variationId) || null,
        name: reslotSource.activity?.activityName || reslotSource.productName || "this session",
      }
    : null;

  const handleReslot = async (slotId) => {
    try {
      const res = await reslotBooking({ bookingId: booking.bookingId, slotId }).unwrap();
      setReslotOpen(false);
      await refresh();
      const d = res?.data;
      toast.success(d?.fromTime ? `Moved to ${d.fromTime} – ${d.toTime}` : "Moved to the selected slot");
    } catch (err) {
      toast.error(err?.data?.error || err?.data?.message || "Could not move booking");
    }
  };

  const allBulkPlan = useMemo(
    () => buildCheckInAllPlan({ tickets, ticketBlockers }),
    [tickets, ticketBlockers]
  );
  // "Select all" must match the per-row checkboxes: every visible ticket that
  // can be checked in individually (issued + not blocked). buildCheckInAllPlan's
  // readyCodes is intentionally stricter — it skips transferable tickets that
  // have no participant for the AUTO "check in all" flow — which left party
  // tickets (no waiver, no participant) unselectable via Select all even though
  // each row's own checkbox worked. Use the looser per-row gate here.
  const safeSelectableCodes = useMemo(
    () => visibleTickets.filter((t) => isTicketReadyForCheckIn(t, ticketBlockers)).map((t) => t.ticketCode),
    [visibleTickets, ticketBlockers]
  );
  const bulkActionableCount = allBulkPlan.readyCount;
  const selectedProgress = useMemo(
    () => buildSelectedProgress({ tickets, ticketBlockers, redeemedCount, totalCount }),
    [tickets, ticketBlockers, redeemedCount, totalCount]
  );
  const allActionableSelected = safeSelectableCodes.length > 0 && safeSelectableCodes.every((c) => selectedCodes.has(c));

  useEffect(() => {
    setSelectedCodes((prev) => {
      const allowed = new Set(safeSelectableCodes);
      const next = new Set([...prev].filter((code) => allowed.has(code)));
      return next.size === prev.size ? prev : next;
    });
  }, [safeSelectableCodes]);

  const toggleSelect = (code) => {
    setSelectedCodes((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code); else next.add(code);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (allActionableSelected) setSelectedCodes(new Set());
    else setSelectedCodes(new Set(safeSelectableCodes));
  };

  const handleUnlinkParticipant = async (participantId) => {
    if (!window.confirm("Remove this guest from the booking? Their tickets stay on the booking and can be re-assigned.")) return;
    const promise = removeParticipant({ bookingId: booking.bookingId, participantId }).unwrap();
    toast.promise(promise, {
      loading: "Removing…",
      success: () => { refresh(); return "Removed"; },
      error: (err) => err?.data?.error || "Could not remove (check if already checked in)",
    });
  };

  const handleRedeemOne = async (code) => {
    const ticket = tickets.find((t) => t.ticketCode === code);
    const blocker = ticket ? ticketBlockers.get(code) : null;
    if (blocker) {
      toast.error(redeemReasonMessage(blocker, ticket));
      return;
    }
    const terminal = getTerminal();
    const promise = redeemTicket({
      ticketCode: code,
      terminalDeviceId: terminal?.deviceId || null,
      gateOrZone: terminal?.deviceName || "Cashier check-in",
      // Cashier check-in allows same-day early arrivals (backend gates to today).
      allowEarlyCheckIn: true,
    }).unwrap();
    toast.promise(promise, {
      loading: "Redeeming…",
      success: () => { refresh(); return "Checked in"; },
      error: (err) => err?.data?.error || redeemReasonMessage(err?.data?.reason, ticket) || "Redeem failed",
    });
  };

  const waiverBlocked = useMemo(
    () => tickets.filter(
      (t) => ["requires_waiver", "requires_waiver_no_holder"].includes(ticketBlockers.get(t.ticketCode))
    ),
    [tickets, ticketBlockers]
  );

  const handleRedeemSelected = async () => {
    if (selectedCodes.size === 0) return;
    const terminal = getTerminal();
    const codes = [...selectedCodes];
    let ok = 0;
    const failures = [];
    for (const code of codes) {
      const ticket = tickets.find((t) => t.ticketCode === code);
      const blocker = ticket ? ticketBlockers.get(code) : null;
      if (blocker) {
        failures.push({ code, reason: blocker });
        continue;
      }
      try {
        await redeemTicket({
          ticketCode: code,
          terminalDeviceId: terminal?.deviceId || null,
          gateOrZone: terminal?.deviceName || "Cashier check-in",
          allowEarlyCheckIn: true,
        }).unwrap();
        ok++;
      } catch (err) {
        failures.push({
          code,
          reason: err?.data?.reason || err?.data?.error || err?.data?.message || "failed",
        });
      }
    }
    setSelectedCodes(new Set());
    refresh();
    if (failures.length === 0) {
      toast.success(`Checked in ${ok}`);
      return;
    }
    const failureSummary = summarizeRedeemFailures(failures);
    const message = `Checked in ${ok} - ${failures.length} blocked${failureSummary ? ` (${failureSummary})` : ""}`;
    if (ok > 0) toast.warning(message);
    else toast.error(message);
  };

  const handleRedeemAll = async () => {
    if (bulkActionableCount === 0) {
      const summary = summarizeRedeemFailures(allBulkPlan.blocked);
      toast.error(summary ? `No tickets ready: ${summary}` : "No tickets ready to check in");
      return;
    }
    if (waiverBlocked.length > 0) {
      // Soft-warn (server still enforces). Bulk endpoint already skips these,
      // so this is purely so the cashier knows what won't get checked in.
      toast.warning(
        `${waiverBlocked.length} ticket${waiverBlocked.length === 1 ? "" : "s"} need a waiver — link guests first or use "Add from waiver"`
      );
    }
    const terminal = getTerminal();
    const toastId = toast.loading("Redeeming all...");
    try {
      const res = await checkInAll({
        bookingId: booking.bookingId,
        terminalDeviceId: terminal?.deviceId || null,
        gateOrZone: terminal?.deviceName || "Cashier check-in",
        allowEarlyCheckIn: true,
      }).unwrap();
      refresh();
      const succ = res?.succeeded ?? 0;
      const att = res?.attempted ?? 0;
      const failures = asArray(res?.results).filter((r) => !r.ok);
      const blocked = failures.filter((r) => r.reason === "requires_waiver").length;
      const failureSummary = summarizeRedeemFailures(failures);
      const tail = blocked > 0 ? ` - ${blocked} blocked by waiver` : failures.length > 0 ? ` - ${failureSummary}` : "";
      const message = `Checked in ${succ} of ${att}${tail}`;
      if (succ === 0 && failures.length > 0) toast.error(message, { id: toastId });
      else if (failures.length > 0) toast.warning(message, { id: toastId });
      else toast.success(message, { id: toastId });
    } catch (err) {
      toast.error(err?.data?.error || err?.data?.message || redeemReasonMessage(err?.data?.reason) || err?.message || "Redeem failed", { id: toastId });
    }
  };

  // Idempotency key for the current payment attempt + a synchronous lock so a
  // fast double-tap or wifi retry can't double-charge (mirrors the Sell dialog).
  const paymentSessionRef = useRef(null);
  const paymentLockRef = useRef(false);

  const openPayment = () => {
    setPaymentAmount(balanceDue.toFixed(2));
    setPaymentMethod("card");
    setPaymentNote("");
    setPaymentDiscount(null);
    setPaymentComplete(null);
    paymentSessionRef.current =
      (typeof crypto !== "undefined" && crypto.randomUUID)
        ? `pay_${crypto.randomUUID()}`
        : `pay_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    paymentLockRef.current = false;
    setPaymentOpen(true);
  };

  const handleRecordPayment = async () => {
    if (paymentLockRef.current) return;
    const discountAmount = roundMoney(Math.min(Number(paymentDiscount?.amount || 0), balanceDue));
    const payableBalance = roundMoney(Math.max(0, balanceDue - discountAmount));
    const tenderedAmount = Number(paymentAmount);
    if (payableBalance > 0 && (!Number.isFinite(tenderedAmount) || tenderedAmount <= 0)) {
      toast.error(paymentMethod === "cash" ? "Enter cash received." : "Enter a payment amount.");
      return;
    }
    if (paymentMethod === "cash" && tenderedAmount < payableBalance) {
      toast.error(`Cash received must cover ${moneyFmt(payableBalance)}.`);
      return;
    }
    if (paymentMethod !== "cash" && tenderedAmount > payableBalance) {
      toast.error(`Amount cannot exceed ${moneyFmt(payableBalance)}.`);
      return;
    }

    paymentLockRef.current = true;
    const recordAmount = paymentMethod === "cash" ? payableBalance : tenderedAmount;
    const changeDue = paymentMethod === "cash"
      ? Math.max(0, Number((tenderedAmount - payableBalance).toFixed(2)))
      : 0;
    const terminal = getTerminal();
    const sessionKey = paymentSessionRef.current;
    const cashRemark = paymentMethod === "cash"
      ? `Cash tendered ${moneyFmt(tenderedAmount)}; change due ${moneyFmt(changeDue)}.`
      : "";
    let discountCommitted = false;

    try {
      let discountRes = null;
      if (discountAmount > 0) {
        discountRes = await recordPayment({
          bookingId: booking.bookingId,
          amountPaid: discountAmount,
          paymentMethod: "complimentary",
          terminalDeviceId: terminal?.deviceId || null,
          idempotencyKey: sessionKey ? `${sessionKey}:discount` : undefined,
          remarks: [
            `POS discount applied: ${paymentDiscount?.label || "Discount"}`,
            paymentDiscount?.code ? `Code ${paymentDiscount.code}.` : "",
            paymentDiscount?.managerName ? `Approved by ${paymentDiscount.managerName}.` : "",
          ].filter(Boolean).join(" "),
        }).unwrap();
        discountCommitted = true;
      }
      let res = discountRes;
      if (recordAmount > 0) {
        res = await recordPayment({
          bookingId: booking.bookingId,
          amountPaid: recordAmount,
          paymentMethod,
          tenderedAmount,
          changeDue,
          terminalDeviceId: terminal?.deviceId || null,
          idempotencyKey: sessionKey ? `${sessionKey}:payment` : undefined,
          remarks: [paymentNote || "Payment recorded at POS check-in", cashRemark].filter(Boolean).join(" "),
        }).unwrap();
      }
      if (paymentMethod === "cash" && recordAmount > 0) {
        openCashDrawer({ bookingId: booking.bookingId, terminal });
      }
      setPaymentComplete({
        ...(res?.data || {}),
        amountPaid: roundMoney(recordAmount + discountAmount),
        discountAmount,
        discountLabel: paymentDiscount?.label || null,
        paymentAmount: recordAmount,
        paymentMethod,
        tenderedAmount,
        changeDue,
        drawerOpened: paymentMethod === "cash" && recordAmount > 0,
      });
      refresh();
      toast.success("Payment recorded");
    } catch (err) {
      const baseMsg = err?.data?.message || err?.data?.error || "Could not record payment";
      toast.error(
        discountCommitted
          ? `Discount applied but payment did not record. Tap "Complete The Order" to retry. ${baseMsg}`
          : baseMsg
      );
    } finally {
      paymentLockRef.current = false;
    }
  };

  // Gift-card tender for an existing booking. The gift-cards/redeem endpoint
  // decrements the card AND records the payment on the booking atomically.
  const handleGiftCardPayment = async ({ code, pin, amount }) => {
    if (paymentLockRef.current) return;
    const discountAmount = roundMoney(Math.min(Number(paymentDiscount?.amount || 0), balanceDue));
    const payable = roundMoney(Math.max(0, balanceDue - discountAmount));
    const apply = roundMoney(Math.min(payable, Number(amount) || 0));
    if (apply <= 0) { toast.error("Gift card has no balance to apply."); return; }
    paymentLockRef.current = true;
    const terminal = getTerminal();
    const sessionKey = paymentSessionRef.current;
    try {
      if (discountAmount > 0) {
        await recordPayment({
          bookingId: booking.bookingId,
          amountPaid: discountAmount,
          paymentMethod: "complimentary",
          terminalDeviceId: terminal?.deviceId || null,
          idempotencyKey: sessionKey ? `${sessionKey}:discount` : undefined,
          remarks: [
            `POS discount applied: ${paymentDiscount?.label || "Discount"}`,
            paymentDiscount?.code ? `Code ${paymentDiscount.code}.` : "",
            paymentDiscount?.managerName ? `Approved by ${paymentDiscount.managerName}.` : "",
          ].filter(Boolean).join(" "),
        }).unwrap();
      }
      const gc = await redeemGiftCard({
        code: String(code).trim(),
        pin: String(pin).trim(),
        amount: apply,
        bookingId: booking.bookingId,
        note: paymentNote || "POS gift card payment",
      }).unwrap();
      const balanceRemaining = roundMoney(Math.max(0, payable - apply));
      setPaymentComplete({
        amountPaid: roundMoney(apply + discountAmount),
        discountAmount,
        discountLabel: paymentDiscount?.label || null,
        paymentAmount: apply,
        paymentMethod: "gift_card",
        giftCardBalanceAfter: Number(gc?.data?.balanceAfter ?? 0),
        balanceRemaining,
        changeDue: 0,
      });
      refresh();
      toast.success(
        balanceRemaining > 0
          ? `${moneyFmt(apply)} on gift card · ${moneyFmt(balanceRemaining)} still due`
          : `${moneyFmt(apply)} paid by gift card`
      );
    } catch (err) {
      toast.error(err?.data?.error || err?.data?.message || "Gift card payment failed.");
    } finally {
      paymentLockRef.current = false;
    }
  };

  const handlePrintReceipt = () => {
    printReceipt({
      bookingId: booking?.bookingId || null,
      bookingNumber: booking?.bookingNumber || null,
      terminal: getTerminal(),
    });
  };

  const handleEmailReceipt = async (email) => {
    if (!booking?.bookingId) return;
    const clean = String(email || "").trim();
    if (!clean || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) {
      toast.error("Enter a valid email address.");
      return;
    }
    const promise = sendBookingConfirmation({ bookingId: booking.bookingId, email: clean }).unwrap();
    toast.promise(promise, {
      loading: "Sending receipt...",
      success: `Receipt emailed to ${clean}`,
      error: (err) => err?.data?.message || err?.data?.error || "Could not email receipt",
    });
  };

  return (
    <div style={{ height: "100%", minHeight: 0, display: "flex", overflow: "hidden" }}>
      <section
        style={{
          flex: 1,
          minWidth: 0,
          minHeight: 0,
          display: "flex",
          flexDirection: "column",
          padding: "12px 14px",
          overflow: "hidden",
        }}
      >
      {/* Booking header */}
      <div style={{ marginBottom: 14, display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexShrink: 0 }}>
        <div style={{ minWidth: 0 }}>
        <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--aero-orange-600)", fontWeight: 700, letterSpacing: "0.05em" }}>
          {bookingNumber}
        </div>
        <div style={{ fontFamily: "var(--font-display, inherit)", fontSize: 22, fontWeight: 800, color: "var(--ink-900)", letterSpacing: "-0.02em", marginTop: 2 }}>
          {bookingName}
        </div>
        <div style={{ fontSize: 13, color: "var(--ink-500)", marginTop: 4 }}>
          {bookingActivityName} · {booking.totalGuests || totalCount} pax · {bookingTimeRange}
        </div>
        </div>
        <button
          type="button"
          className="a-btn a-btn--secondary a-btn--sm"
          onClick={() => setEditorOpen(true)}
          style={{ justifyContent: "center", flex: "0 0 auto" }}
        >
          <Icon name="edit-3" size={13} /> Edit booking
        </button>
      </div>

      {/* Toolbar — ROLLER-style: select all + hide checked-in + batch redeem */}
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", paddingBottom: 12, overscrollBehavior: "contain", scrollbarGutter: "stable" }}>
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
        gap: 7,
        marginBottom: 8,
      }}>
        <CloseoutPill
          label="Waivers"
          value={waiverBlocked.length > 0 ? `${waiverBlocked.length} needed` : "Ready"}
          tone={waiverBlocked.length > 0 ? "danger" : "success"}
        />
        <CloseoutPill
          label="Check-in"
          value={`${selectedProgress.checkedIn}/${selectedProgress.total}`}
          tone={isFullyCheckedIn ? "success" : "warning"}
        />
        <CloseoutPill
          label="Payment"
          value={balanceDue > 0 ? `${moneyFmt(balanceDue)} due` : "Paid"}
          tone={balanceDue > 0 ? "danger" : "success"}
        />
      </div>

      <SelectedProgressPanel progress={selectedProgress} />

      <GuestWorkflowPanel
        bookingId={booking.bookingId}
        totalGuests={booking.totalGuests || totalCount}
        participants={allParticipants}
        tickets={tickets}
        onAddFromWaiver={() => setWaiverModalOpen(true)}
        onAutoAssign={handleAutoBindReadyHolders}
        onTargetWaiver={(ticketCode = null) => {
          setWaiverTargetCode(ticketCode);
          setWaiverModalOpen(true);
        }}
        onSaved={refresh}
        isAssigning={binding}
      />

      {paymentOpen && (
        <CheckInPaymentModal
          booking={booking}
          balanceDue={balanceDue}
          amount={paymentAmount}
          method={paymentMethod}
          note={paymentNote}
          discount={paymentDiscount}
          isSubmitting={recordingPayment}
          complete={paymentComplete}
          onAmountChange={setPaymentAmount}
          onMethodChange={setPaymentMethod}
          onNoteChange={setPaymentNote}
          onDiscountChange={setPaymentDiscount}
          onSubmit={handleRecordPayment}
          onGiftCardSubmit={handleGiftCardPayment}
          gcRedeeming={gcRedeeming}
          onPrintReceipt={handlePrintReceipt}
          onEmailReceipt={handleEmailReceipt}
          isSendingReceipt={sendingReceipt}
          onClose={() => { setPaymentOpen(false); setPaymentComplete(null); refresh(); }}
        />
      )}

      {reslotOpen && reslotActivity && (
        <ReslotModal
          activityId={reslotActivity.activityId}
          variationId={reslotActivity.variationId}
          activityName={reslotActivity.name}
          busy={reslotting}
          onPick={handleReslot}
          onClose={() => setReslotOpen(false)}
        />
      )}

      {editorOpen && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 1000,
            background: "rgba(26, 24, 20, 0.58)",
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "center",
            padding: 18,
            overflowY: "auto",
          }}
        >
          <div
            style={{
              width: "min(1440px, 100%)",
              height: "min(820px, calc(100vh - 36px))",
              background: "var(--ink-25, #FAF7EE)",
              border: "2px solid var(--ink-900)",
              borderRadius: 14,
              boxShadow: "0 20px 70px rgba(0,0,0,0.35)",
              overflow: "hidden",
              display: "flex",
              flexDirection: "column",
              minHeight: 0,
            }}
          >
            <div
              style={{
                height: 46,
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "0 12px 0 16px",
                background: "white",
                borderBottom: "1.5px solid var(--ink-200)",
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 800, color: "var(--ink-900)" }}>
                Edit {bookingNumber}
              </div>
              <button
                type="button"
                className="a-btn a-btn--ghost a-btn--sm"
                onClick={() => { setEditorOpen(false); refresh(); }}
              >
                <Icon name="x" size={14} /> Close
              </button>
            </div>
            <iframe
              title={`Edit booking ${bookingNumber}`}
              src={adminBookingDetailUrl(booking.bookingId, "embedded=1&returnTo=pos-checkin")}
              style={{ width: "100%", flex: 1, minHeight: 0, border: 0, background: "var(--ink-25, #FAF7EE)" }}
            />
          </div>
        </div>
      )}

      {reslotActivity && (
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap",
          gap: 10, marginBottom: 8, padding: "10px 12px",
          background: reslotIsExpired ? "#FFF7ED" : "#EFF6FF",
          border: reslotIsExpired ? "1.5px solid #FFB199" : "1.5px solid #9DC4F0",
          borderRadius: 12,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, color: reslotIsExpired ? "#B83210" : "#1D4ED8", fontWeight: 700, fontSize: 13 }}>
            <Icon name="clock" size={16} stroke={2.5} />
            {reslotIsExpired
              ? "This session's time has passed — move the guest to an open slot today."
              : "Session in progress — check in here, or move the guest to another open slot today."}
          </div>
          <button
            type="button"
            onClick={() => setReslotOpen(true)}
            disabled={reslotting || !reslotActivity.activityId}
            className={reslotIsExpired ? "a-btn a-btn--primary a-btn--sm" : "a-btn a-btn--ghost a-btn--sm"}
            style={{ justifyContent: "center" }}
          >
            <Icon name="calendar-clock" size={14} /> Move to available slot
          </button>
        </div>
      )}

      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap",
        gap: 10, marginBottom: 8, padding: "8px 10px",
        background: "white", border: "1.5px solid var(--ink-200)", borderRadius: 12,
      }}>
        <label style={{ display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: 12, fontWeight: 600, color: "var(--ink-700)" }}>
          <input type="checkbox" checked={allActionableSelected} onChange={toggleSelectAll} />
          Select all
        </label>
        <label style={{ display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: 12, fontWeight: 600, color: "var(--ink-700)" }}>
          <input type="checkbox" checked={hideCheckedIn} onChange={(e) => setHideCheckedIn(e.target.checked)} />
          Hide checked in
        </label>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 11, color: "var(--ink-500)", fontWeight: 600 }}>
          {redeemedCount}/{totalCount} redeemed
        </span>
        <button
          type="button"
          onClick={() => setWaiverModalOpen(true)}
          className="a-btn a-btn--ghost a-btn--sm"
          title="Look up an existing waiver and add the guest to this booking"
          style={{ justifyContent: "center" }}
        >
          <Icon name="search" size={13} /> Add from waiver
        </button>
        <button
          type="button"
          onClick={selectedCodes.size > 0 ? handleRedeemSelected : handleRedeemAll}
          disabled={(selectedCodes.size === 0 && bulkActionableCount === 0) || redeeming || checkingInAll}
          className="a-btn a-btn--primary a-btn--sm"
          style={{ minWidth: 110, justifyContent: "center" }}
        >
          <Icon name="check" size={13} stroke={3} />
          {selectedCodes.size > 0 ? `Redeem (${selectedCodes.size})` : `All (${bulkActionableCount})`}
        </button>
      </div>

      {waiverModalOpen && (
        <WaiverLookupModal
          bookingId={booking.bookingId}
          onClose={() => {
            setWaiverModalOpen(false);
            setWaiverTargetCode(null);
          }}
          onLinked={handleWaiverLinked}
        />
      )}

      {/* Ticket list — ROLLER-style flat rows with per-row redeem */}
      {ticketsLoading ? (
        <div style={{ fontSize: 13, color: "var(--ink-500)", padding: 12 }}>Loading tickets…</div>
      ) : visibleTickets.length === 0 ? (
        tickets.length === 0 ? (
          <div style={{
            padding: 20, textAlign: "center", background: "white",
            border: "1.5px solid var(--color-warning, #F59E0B)",
            borderRadius: 12,
          }}>
            <div style={{ fontSize: 13, color: "#8B6100", marginBottom: 4, fontWeight: 700 }}>
              <Icon name="alert-triangle" size={13} style={{ marginRight: 6, verticalAlign: "-2px" }} />
              This booking can't be checked in
            </div>
            <div style={{ fontSize: 12, color: "var(--ink-600)", lineHeight: 1.4 }}>
              No entries were generated for this booking. This is unusual — please ask a manager to investigate the booking on the admin app.
            </div>
          </div>
        ) : (
          <div style={{ fontSize: 13, color: "var(--ink-500)", padding: 16, textAlign: "center", background: "white", borderRadius: 10 }}>
            All tickets redeemed.
          </div>
        )
      ) : (
        <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 6 }}>
          {visibleTickets.map((t, i) => {
            const isRedeemed = isRedeemedTicket(t);
            const isSelected = selectedCodes.has(t.ticketCode);
            const blocker = ticketBlockers.get(t.ticketCode);
            const blockerMessage = blocker ? redeemReasonMessage(blocker, t) : "";
            const isBlocked = Boolean(blocker);
            const productName = firstText(t.product?.name, t.activity?.name, activityNameFromBooking(booking), "Item");
            const variationName = displayText(t.variation?.name, "");
            const ticketCode = displayText(t.ticketCode, "");
            const time = formatScheduledTicketTime(t, bookingTimeRange);
            return (
              <li
                key={t.ticketId}
                style={{
                  display: "flex", alignItems: "center", gap: 10,
                  padding: "10px 12px", borderRadius: 10,
                  background: isRedeemed ? "var(--ink-50)" : "white",
                  border: isSelected ? "2px solid var(--aero-orange-500)" : isBlocked ? "1.5px solid #F2CA65" : "1.5px solid var(--ink-200)",
                  opacity: isRedeemed ? 0.7 : 1,
                }}
              >
                <input
                  type="checkbox"
                  checked={isSelected}
                  disabled={isBlocked}
                  onChange={() => toggleSelect(t.ticketCode)}
                  title={blockerMessage || undefined}
                  style={{
                    width: 16, height: 16,
                    cursor: isBlocked ? "not-allowed" : "pointer",
                    flexShrink: 0,
                  }}
                />
                <div style={{
                  width: 28, height: 28, borderRadius: 6, flexShrink: 0,
                  background: "var(--ink-50)", color: "var(--ink-600)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  <Icon name="user-round" size={14} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontWeight: 700, fontSize: 13, color: "var(--ink-900)",
                    textDecoration: isRedeemed ? "line-through" : "none",
                  }}>
                    {productName}
                    {variationName && <span style={{ marginLeft: 6, fontWeight: 600, color: "var(--ink-600)" }}>· {variationName}</span>}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--ink-500)", display: "flex", gap: 8, marginTop: 2, alignItems: "center", flexWrap: "wrap" }}>
                    <span style={{ fontFamily: "var(--font-mono)", fontWeight: 700, color: "var(--aero-orange-600)" }}>
                      {ticketCode}
                    </span>
                    {time && <span>· {time}</span>}
                    {isBlocked && (
                      <span style={{
                        display: "inline-flex", alignItems: "center", gap: 4,
                        padding: "2px 6px", borderRadius: 6,
                        background: "#FFF0EA", color: "#B83210",
                        border: "1px solid #FFB199",
                        fontWeight: 700, fontSize: 10,
                      }}>
                        <Icon name="alert-triangle" size={10} stroke={2.5} />
                        {blockerMessage}
                      </span>
                    )}
                  </div>
                  {t.participantId && t.participant?.displayName && (
                    <BoundHolderChip
                      participant={t.participant}
                      onUnbind={isRedeemed ? null : () => handleUnbind(t.ticketCode)}
                      busy={binding}
                    />
                  )}
                  {!isRedeemed && !t.participantId && t.activity?.captureTicketHolder !== false && (
                    <HolderPicker
                      candidates={candidatesFor(t)}
                      onPick={(participantId) => handleBind(t.ticketCode, participantId)}
                      onSearch={() => {
                        setWaiverTargetCode(t.ticketCode);
                        setWaiverModalOpen(true);
                      }}
                      busy={binding}
                    />
                  )}
                </div>
                {t.participantId && !isRedeemed && (
                  <button
                    type="button"
                    onClick={() => handleUnlinkParticipant(t.participantId)}
                    title="Remove this guest from the booking (e.g. no-show)"
                    style={{
                      width: 28, height: 28, flexShrink: 0,
                      borderRadius: 6, border: "1.5px solid var(--ink-200)",
                      background: "white", color: "var(--ink-500)",
                      cursor: "pointer",
                      display: "flex", alignItems: "center", justifyContent: "center",
                    }}
                  >
                    <Icon name="x" size={14} stroke={3} />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => !isBlocked && handleRedeemOne(t.ticketCode)}
                  disabled={isBlocked || redeeming}
                  title={
                    isRedeemed
                      ? "Already redeemed"
                      : isBlocked
                        ? blockerMessage
                        : "Redeem this ticket"
                  }
                  style={{
                    width: 36, height: 36, flexShrink: 0,
                    borderRadius: 8, border: "1.5px solid",
                    borderColor: isRedeemed ? "var(--color-success)" : isBlocked ? "#F2CA65" : "var(--ink-200)",
                    background: isRedeemed ? "var(--color-success)" : isBlocked ? "#FFF7E5" : "white",
                    color: isRedeemed ? "white" : isBlocked ? "#8A5A00" : "var(--ink-700)",
                    cursor: isBlocked ? "not-allowed" : "pointer",
                    display: "flex", alignItems: "center", justifyContent: "center",
                  }}
                >
                  <Icon name={isBlocked ? "alert-triangle" : "check"} size={16} stroke={3} />
                </button>
              </li>
            );
          })}
        </ul>
      )}
      </div>
      </section>

      <aside
        style={{
          width: "clamp(290px, 27vw, 370px)",
          flex: "0 0 clamp(290px, 27vw, 370px)",
          minHeight: 0,
          minWidth: 290,
          padding: "12px 14px 12px 0",
          display: "flex",
          flexDirection: "column",
          overflowY: "auto",
          overscrollBehavior: "contain",
          scrollbarGutter: "stable",
        }}
      >
        <CheckInSettlementPanel
          balanceDue={balanceDue}
          isFullyCheckedIn={isFullyCheckedIn}
          redeemedCount={redeemedCount}
          totalCount={totalCount}
          booking={booking}
          tickets={tickets}
          isAdjusting={adjustingOrder}
          onAdjustOrder={handleAdjustOrder}
          onAddItem={() => setAddItemOpen(true)}
          onTakePayment={openPayment}
        />
      </aside>

      {addItemOpen && (
        <OrderAddItemModal
          bookingId={booking.bookingId}
          onAdd={(variationId, quantity) =>
            handleAdjustOrder({ action: "add_item", variationId, quantity })
          }
          onClose={() => setAddItemOpen(false)}
        />
      )}

    </div>
  );
}

function activityNameFromBooking(b) {
  return displayText(b?.activityName, "Item");
}

function SelectedProgressPanel({ progress }) {
  const percent = Number(progress?.percent || 0);
  return (
    <div
      style={{
        marginBottom: 8,
        padding: "9px 10px",
        background: "white",
        border: "1.5px solid var(--ink-200)",
        borderRadius: 12,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 7 }}>
        <div style={{ fontSize: 12, fontWeight: 900, color: "var(--ink-900)" }}>
          Booking progress
        </div>
        <div style={{ fontSize: 11, fontWeight: 800, color: "var(--ink-500)" }}>
          {progress.checkedIn}/{progress.total} checked in
        </div>
      </div>
      <div style={{ height: 8, borderRadius: 999, background: "var(--ink-100)", overflow: "hidden", marginBottom: 8 }}>
        <div
          style={{
            width: `${percent}%`,
            height: "100%",
            background: percent >= 100 ? "var(--color-success)" : "var(--aero-orange-500)",
            borderRadius: 999,
          }}
        />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 6 }}>
        <MiniStat label="Ready" value={progress.ready} tone={progress.ready ? "success" : "default"} />
        <MiniStat label="Blocked" value={progress.blocked} tone={progress.blocked ? "warning" : "default"} />
        <MiniStat label="Pending" value={progress.pending} tone={progress.pending ? "warning" : "success"} />
        <MiniStat label="Done" value={progress.checkedIn} tone={progress.checkedIn ? "success" : "default"} />
      </div>
    </div>
  );
}

function GuestWorkflowPanel({
  bookingId,
  totalGuests,
  participants = [],
  tickets = [],
  onAddFromWaiver,
  onTargetWaiver,
  onAutoAssign,
  onSaved,
  isAssigning = false,
}) {
  const [namesOpen, setNamesOpen] = useState(false);
  const boundIds = useMemo(
    () => new Set(tickets.map((ticket) => Number(ticket.participantId)).filter(Boolean)),
    [tickets]
  );
  const validParticipants = participants.filter((participant) => participant.hasValidWaiver);
  const availableValidParticipants = validParticipants.filter((participant) => {
    const id = Number(participant.bookingParticipantId);
    return id && !participant.checkedInAt && !boundIds.has(id);
  });
  const unassignedWaiverTickets = tickets.filter((ticket) =>
    ticket.status === "issued" &&
    ticket.requiresWaiver &&
    !ticket.participantId &&
    !isRedeemedTicket(ticket)
  );
  const missingNames = Math.max(0, Number(totalGuests || tickets.length || 0) - participants.length);
  const assignedCount = tickets.filter((ticket) => ticket.participantId).length;
  const sampleParticipants = participants.slice(0, 10);

  return (
    <div
      style={{
        marginBottom: 8,
        padding: "10px 12px",
        background: "white",
        border: "1.5px solid var(--ink-200)",
        borderRadius: 12,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <Icon name="users" size={15} style={{ color: "var(--ink-600)" }} />
          <div style={{ fontSize: 12, fontWeight: 900, color: "var(--ink-900)" }}>
            Guests
          </div>
          <span style={{ fontSize: 11, fontWeight: 750, color: "var(--ink-500)" }}>
            {participants.length}/{totalGuests || tickets.length || 0} named
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
          <button
            type="button"
            className="a-btn a-btn--ghost a-btn--sm"
            onClick={() => setNamesOpen((value) => !value)}
            style={{ justifyContent: "center" }}
          >
            <Icon name={namesOpen ? "chevron-up" : "user-plus"} size={13} />
            Names
          </button>
          <button
            type="button"
            className="a-btn a-btn--ghost a-btn--sm"
            onClick={() => (onTargetWaiver || onAddFromWaiver)?.(null)}
            style={{ justifyContent: "center" }}
          >
            <Icon name="search" size={13} />
            Waiver
          </button>
          <button
            type="button"
            className="a-btn a-btn--primary a-btn--sm"
            onClick={onAutoAssign}
            disabled={isAssigning || availableValidParticipants.length === 0 || unassignedWaiverTickets.length === 0}
            title={
              unassignedWaiverTickets.length === 0
                ? "No waiver tickets need holders"
                : availableValidParticipants.length === 0
                  ? "No unassigned waiver holders"
                  : "Assign waiver holders to tickets"
            }
            style={{ justifyContent: "center" }}
          >
            <Icon name="wand-2" size={13} />
            Auto assign
          </button>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 6, marginBottom: participants.length > 0 ? 8 : 0 }}>
        <MiniStat label="Waiver ready" value={validParticipants.length} tone={validParticipants.length ? "success" : "default"} />
        <MiniStat label="Unassigned" value={availableValidParticipants.length} tone={availableValidParticipants.length ? "warning" : "default"} />
        <MiniStat label="Tickets linked" value={assignedCount} tone={assignedCount ? "success" : "default"} />
        <MiniStat label="Names needed" value={missingNames} tone={missingNames ? "warning" : "success"} />
      </div>

      {participants.length > 0 && (
        <div style={{ display: "flex", gap: 5, flexWrap: "wrap", alignItems: "center", marginBottom: namesOpen ? 8 : 0 }}>
          {sampleParticipants.map((participant) => {
            const id = Number(participant.bookingParticipantId);
            const isBound = boundIds.has(id);
            return (
              <span
                key={participant.bookingParticipantId}
                title={participant.hasValidWaiver ? "Valid waiver" : "No valid waiver"}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  maxWidth: 170,
                  padding: "4px 8px",
                  borderRadius: 999,
                  border: `1.5px solid ${participant.hasValidWaiver ? "#8AD5A3" : "var(--ink-200)"}`,
                  background: isBound ? "var(--aero-orange-50)" : participant.hasValidWaiver ? "#EAF8EF" : "var(--ink-50)",
                  color: participant.hasValidWaiver ? "#137A35" : "var(--ink-600)",
                  fontSize: 11,
                  fontWeight: 750,
                }}
              >
                <Icon name={participant.hasValidWaiver ? "shield-check" : "user-round"} size={11} />
                <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {displayText(participant.displayName, "Guest")}
                </span>
              </span>
            );
          })}
          {participants.length > sampleParticipants.length && (
            <span style={{ fontSize: 11, fontWeight: 800, color: "var(--ink-500)" }}>
              +{participants.length - sampleParticipants.length} more
            </span>
          )}
        </div>
      )}

      {namesOpen && (
        <NameGuestsForm
          bookingId={bookingId}
          totalGuests={Math.max(1, missingNames || totalGuests || tickets.length || 1)}
          existingParticipants={participants}
          onSaved={() => {
            setNamesOpen(false);
            onSaved?.();
          }}
        />
      )}
    </div>
  );
}

function CloseoutPill({ label, value, tone = "neutral" }) {
  const colors = {
    success: { bg: "#EAF8EF", border: "#8AD5A3", fg: "#137A35" },
    warning: { bg: "#FFF7E5", border: "#F2CA65", fg: "#8A5A00" },
    danger: { bg: "#FFF0EA", border: "#FFB199", fg: "#B83210" },
    neutral: { bg: "white", border: "var(--ink-200)", fg: "var(--ink-700)" },
  };
  const c = colors[tone] || colors.neutral;
  return (
    <div style={{ background: c.bg, border: `1.5px solid ${c.border}`, borderRadius: 9, padding: "7px 9px", minWidth: 0 }}>
      <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--ink-500)" }}>
        {label}
      </div>
      <div style={{ marginTop: 2, fontSize: 12, fontWeight: 900, color: c.fg, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {value}
      </div>
    </div>
  );
}

function CheckInSettlementPanel({
  balanceDue,
  isFullyCheckedIn,
  redeemedCount,
  totalCount,
  booking,
  tickets = [],
  isAdjusting = false,
  onAdjustOrder,
  onAddItem,
  onTakePayment,
}) {
  const isPaid = balanceDue <= 0;
  const canTakePayment = !isPaid;
  const subtotal = Number(booking?.subTotal ?? booking?.subtotal ?? booking?.subtotalAmount ?? booking?.totalAmount ?? balanceDue) || 0;
  const tax = Number(booking?.taxAmount ?? booking?.tax ?? 0) || 0;
  const total = Number(booking?.totalAmount ?? booking?.total ?? balanceDue) || 0;
  const discount = Number(booking?.discountAmount ?? 0) || 0;
  const amountPaid = Math.max(
    0,
    Number(
      booking?.amountPaid ??
      booking?.paidAmount ??
      booking?.totalPaid ??
      Math.max(0, total - balanceDue)
    ) || 0
  );
  const invoiceItems = useMemo(() => {
    const bookingLines = Array.isArray(booking?.bookingItems) ? booking.bookingItems : [];
    const activeBookingItems = bookingLines
      .filter((item) => String(item.status || "active").toLowerCase() === "active")
      .filter((item) => Number(item.totalPrice || 0) > 0 || Number(item.noOfTickets || 0) > 0)
      .map((item) => ({
        key: `bookingItem:${item.bookingItemId}`,
        name: firstText(booking?.activityName, item.variation?.activityName, "Booking item"),
        detail: [
          displayText(item.variation?.name, ""),
          item.timefrom && item.timeto ? `${item.timefrom} - ${item.timeto}` : "",
        ].filter(Boolean).join(" - "),
        qty: Number(item.noOfTickets || 1) || 1,
        amount: Number(item.totalPrice || 0),
        source: "bookingItem",
        bookingItemId: item.bookingItemId,
      }));

    if (activeBookingItems.length === 0 && (!Array.isArray(tickets) || tickets.length === 0)) {
      return [{
        key: "booking",
        name: booking?.activityName || booking?.bookingName || "Booking",
        detail: booking?.timeRange || "",
        qty: Number(booking?.totalGuests || 1) || 1,
        amount: subtotal || null,
      }];
    }

    const rows = Array.isArray(tickets) ? tickets : [];
    const groups = new Map();
    rows.forEach((ticket) => {
      if (ticket.bookingItemId) return;
      const productName = firstText(ticket.product?.name, ticket.activity?.name, activityNameFromBooking(booking), "Item");
      const variationName = firstText(ticket.variation?.name, ticket.ticketTypeName, ticket.priceName, "");
      const bookingItemId = ticket.bookingItemId || ticket.bookingItem?.bookingItemId || null;
      const key = bookingItemId ? `bookingItem:${bookingItemId}` : `${productName}|${variationName}`;
      const unitAmount = Number(
        ticket.unitPrice ??
        ticket.price ??
        ticket.amount ??
        ticket.totalAmount ??
        ticket.product?.price ??
        ticket.variation?.price
      );
      const existing = groups.get(key) || {
        key,
        name: productName,
        detail: variationName,
        qty: 0,
        amount: 0,
        hasAmount: false,
        source: bookingItemId ? "bookingItem" : "ticket",
        bookingItemId,
      };
      existing.qty += 1;
      if (Number.isFinite(unitAmount) && unitAmount > 0) {
        existing.amount += unitAmount;
        existing.hasAmount = true;
      }
      groups.set(key, existing);
    });

    const ticketItems = Array.from(groups.values()).map((item) => ({
      ...item,
      amount: item.hasAmount ? item.amount : null,
    }));
    const purchasedItems = Array.isArray(booking?.purchasedItems) ? booking.purchasedItems : [];
    const extraItems = purchasedItems
      .filter((item) => !item.isBundleInclusion)
      .map((item) => ({
        key: `purchased:${item.variationId}`,
        name: firstText(item.activityName, item.variation?.name, "Item"),
        detail: displayText(item.variation?.name, ""),
        qty: Number(item.count || item.quantity || 1) || 1,
        amount: Number(item.total || 0),
        source: "purchasedItem",
        variationId: item.variationId,
      }));
    return [...activeBookingItems, ...ticketItems, ...extraItems];
  }, [booking, subtotal, tickets]);

  const changeQty = (item, delta) => {
    if (!onAdjustOrder || isAdjusting) return;
    const nextQty = Math.max(item.source === "bookingItem" ? 1 : 0, Number(item.qty || 0) + delta);
    if (nextQty === Number(item.qty || 0)) return;
    onAdjustOrder({
      action: "set_quantity",
      source: item.source,
      bookingItemId: item.bookingItemId,
      variationId: item.variationId,
      quantity: nextQty,
    });
  };
  const panel = isPaid
    ? {
        icon: "check-circle-2",
        title: "Paid in full",
        body: "No balance remains for this booking.",
        bg: "#EAF8EF",
        border: "#8AD5A3",
        fg: "#137A35",
      }
    : isFullyCheckedIn
    ? {
        icon: "credit-card",
        title: "Payment available",
        body: "All guests are checked in. Collect any remaining balance when ready.",
        bg: "var(--aero-orange-50)",
        border: "var(--aero-orange-500)",
        fg: "var(--aero-orange-700)",
      }
    : {
        icon: "credit-card",
        title: "Payment available",
        body: `${redeemedCount}/${totalCount} guests checked in. Payments can be taken before, during, or after check-in.`,
        bg: "var(--aero-orange-50)",
        border: "var(--aero-orange-500)",
        fg: "var(--aero-orange-700)",
      };

  return (
    <div
      style={{
        marginBottom: 0,
        padding: "16px 18px",
        borderRadius: 14,
        border: "1.5px solid var(--ink-200)",
        background: "white",
        color: "var(--ink-900)",
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 12 }}>
        <Icon name={panel.icon} size={18} stroke={2.2} style={{ flex: "0 0 auto", marginTop: 1 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 900, color: panel.fg }}>{panel.title}</div>
          <div style={{ marginTop: 4, fontSize: 12, lineHeight: 1.45, color: "var(--ink-700)" }}>
            {panel.body}
          </div>
        </div>
      </div>

      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 10, fontWeight: 900, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--ink-500)", marginBottom: 7 }}>
          Invoice items
        </div>
        <div style={{ display: "grid", gap: 7 }}>
          {invoiceItems.map((item) => (
            <div
              key={item.key}
              style={{
                display: "grid",
                gridTemplateColumns: "minmax(0, 1fr) auto auto",
                gap: 10,
                padding: "9px 10px",
                border: "1.5px solid var(--ink-100)",
                borderRadius: 10,
                background: "var(--ink-25)",
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 850, color: "var(--ink-900)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {displayText(item.name, "Item")}
                </div>
                <div style={{ marginTop: 2, fontSize: 11, color: "var(--ink-500)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  x{item.qty}{displayText(item.detail, "") ? ` - ${displayText(item.detail, "")}` : ""}
                </div>
              </div>
              <div style={{ fontSize: 12, fontWeight: 850, color: "var(--ink-900)", alignSelf: "center" }}>
                {item.amount != null ? moneyFmt(item.amount) : ""}
              </div>
              <div style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                <button
                  type="button"
                  onClick={() => changeQty(item, -1)}
                  disabled={isAdjusting || item.source === "ticket" || item.key === "booking"}
                  title={item.source === "ticket" ? "This line cannot be adjusted here" : "Decrease quantity"}
                  style={{
                    width: 24,
                    height: 24,
                    borderRadius: 7,
                    border: "1.5px solid var(--ink-200)",
                    background: "white",
                    cursor: isAdjusting || item.source === "ticket" || item.key === "booking" ? "not-allowed" : "pointer",
                    opacity: item.source === "ticket" || item.key === "booking" ? 0.45 : 1,
                    fontWeight: 900,
                  }}
                >
                  -
                </button>
                <button
                  type="button"
                  onClick={() => changeQty(item, 1)}
                  disabled={isAdjusting || item.source === "ticket" || item.key === "booking"}
                  title={item.source === "ticket" ? "This line cannot be adjusted here" : "Increase quantity"}
                  style={{
                    width: 24,
                    height: 24,
                    borderRadius: 7,
                    border: "1.5px solid var(--ink-200)",
                    background: "white",
                    cursor: isAdjusting || item.source === "ticket" || item.key === "booking" ? "not-allowed" : "pointer",
                    opacity: item.source === "ticket" || item.key === "booking" ? 0.45 : 1,
                    fontWeight: 900,
                  }}
                >
                  +
                </button>
              </div>
            </div>
          ))}
        </div>
        <button
          type="button"
          className="a-btn a-btn--ghost a-btn--sm"
          onClick={onAddItem}
          style={{ width: "100%", justifyContent: "center", marginTop: 8 }}
        >
          <Icon name="plus" size={14} /> Add item
        </button>
      </div>

      <div style={{ display: "grid", gap: 8, marginBottom: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 13, fontWeight: 700 }}>
          <span>Subtotal</span>
          <span>{moneyFmt(subtotal)}</span>
        </div>
        {discount > 0 && (
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 13, fontWeight: 700, color: "#137A35" }}>
            <span>Discount</span>
            <span>-{moneyFmt(discount)}</span>
          </div>
        )}
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 13, fontWeight: 700 }}>
          <span>Tax</span>
          <span>{moneyFmt(tax)}</span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 13, fontWeight: 700 }}>
          <span>Amount paid</span>
          <span>{moneyFmt(amountPaid)}</span>
        </div>
        <div style={{ borderTop: "1px dashed var(--ink-200)", paddingTop: 8, display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline" }}>
          <span style={{ fontSize: 14, fontWeight: 800 }}>Balance due</span>
          <span style={{ fontSize: 22, fontWeight: 950, fontFamily: "var(--font-display, inherit)" }}>
            {moneyFmt(balanceDue)}
          </span>
        </div>
      </div>

      {!isPaid && (
        <>
        <button
          type="button"
          className="a-btn a-btn--ghost a-btn--sm"
          disabled
          style={{
            width: "100%",
            justifyContent: "center",
            marginBottom: 8,
            cursor: "not-allowed",
            opacity: 0.85,
          }}
        >
          <Icon name="gift" size={16} /> Promo code
        </button>
        <button
          type="button"
          className="a-btn a-btn--primary"
          onClick={canTakePayment ? onTakePayment : undefined}
          disabled={!canTakePayment}
          style={{
            width: "100%",
            justifyContent: "center",
            marginTop: 12,
            padding: "14px 18px",
            fontSize: 16,
            opacity: canTakePayment ? 1 : 0.65,
            cursor: canTakePayment ? "pointer" : "not-allowed",
          }}
        >
          <Icon name="credit-card" size={20} />
          Take payment &middot; {moneyFmt(balanceDue)}
        </button>
        </>
      )}
    </div>
  );
}

function OrderAddItemModal({ bookingId, onAdd, onClose }) {
  const [tab, setTab] = useState("recommended");
  const [search, setSearch] = useState("");
  const [qtyByVariation, setQtyByVariation] = useState({});
  const { data, isFetching } = useGetOrderAdjustmentCatalogQuery({
    bookingId,
    search: tab === "all" ? search : "",
  });
  const recommended = data?.data?.recommended || [];
  const products = data?.data?.products || [];
  const rows = tab === "recommended" ? recommended : products;

  const pickQty = (variationId) => Math.max(1, Number(qtyByVariation[variationId] || 1));
  const changeQty = (variationId, delta) => {
    setQtyByVariation((prev) => ({
      ...prev,
      [variationId]: Math.max(1, Number(prev[variationId] || 1) + delta),
    }));
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        background: "rgba(0,0,0,0.42)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 18,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 620,
          maxHeight: "82vh",
          background: "white",
          border: "2px solid var(--ink-800)",
          borderRadius: 16,
          boxShadow: "0 8px 0 var(--ink-800)",
          padding: 18,
          display: "flex",
          flexDirection: "column",
          minHeight: 0,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 12 }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 900, color: "var(--ink-900)" }}>Add item</div>
            <div style={{ fontSize: 12, color: "var(--ink-500)", marginTop: 2 }}>
              Add extras or stock items to this booking order.
            </div>
          </div>
          <button type="button" onClick={onClose} style={{ all: "unset", cursor: "pointer", padding: 4 }}>
            <Icon name="x" size={18} />
          </button>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 10 }}>
          {[
            ["recommended", "Party extras"],
            ["all", "All products"],
          ].map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              style={{
                border: tab === key ? "2px solid var(--aero-orange-500)" : "1.5px solid var(--ink-200)",
                borderRadius: 10,
                background: tab === key ? "var(--aero-orange-50)" : "white",
                padding: "9px 10px",
                fontWeight: 900,
                cursor: "pointer",
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === "all" && (
          <div style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            border: "1.5px solid var(--ink-200)",
            borderRadius: 10,
            padding: "9px 10px",
            marginBottom: 10,
          }}>
            <Icon name="search" size={15} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search products..."
              style={{ all: "unset", flex: 1, fontSize: 13, fontWeight: 700 }}
            />
          </div>
        )}

        <div style={{ overflowY: "auto", display: "grid", gap: 8, minHeight: 0 }}>
          {isFetching ? (
            <div style={{ padding: 22, textAlign: "center", color: "var(--ink-500)" }}>Loading...</div>
          ) : rows.length === 0 ? (
            <div style={{ padding: 22, textAlign: "center", color: "var(--ink-500)" }}>
              {tab === "recommended" ? "No party extras are configured for this booking." : "No products found."}
            </div>
          ) : (
            rows.map((item) => {
              const qty = pickQty(item.variationId);
              return (
                <div
                  key={`${item.activityId}-${item.variationId}`}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "minmax(0, 1fr) auto auto",
                    gap: 10,
                    alignItems: "center",
                    padding: "10px 12px",
                    border: "1.5px solid var(--ink-200)",
                    borderRadius: 12,
                    background: "var(--ink-25)",
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 900, color: "var(--ink-900)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {displayText(item.activityName, "Item")}
                    </div>
                    <div style={{ marginTop: 2, fontSize: 12, color: "var(--ink-500)" }}>
                      {displayText(item.variationName, "Option")} - {moneyFmt(item.price)}
                    </div>
                  </div>
                  <div style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                    <button type="button" onClick={() => changeQty(item.variationId, -1)} className="a-btn a-btn--ghost a-btn--sm">-</button>
                    <span style={{ minWidth: 18, textAlign: "center", fontWeight: 900 }}>{qty}</span>
                    <button type="button" onClick={() => changeQty(item.variationId, 1)} className="a-btn a-btn--ghost a-btn--sm">+</button>
                  </div>
                  <button
                    type="button"
                    className="a-btn a-btn--primary a-btn--sm"
                    onClick={async () => {
                      await onAdd(item.variationId, qty);
                      onClose();
                    }}
                  >
                    Add
                  </button>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

// Picker of today's open sessions to move a late/expired booking into.
function ReslotModal({ activityId, variationId, activityName, busy, onPick, onClose }) {
  const today = localIsoDate();
  const { data, isFetching, error } = useGetAvailabilityQuery(
    { date: today, activityId },
    { skip: !activityId }
  );
  const sessionsData = data?.data || data || {};
  const sessions = Array.isArray(sessionsData.sessions) ? sessionsData.sessions : [];

  const now = new Date();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const toMin = (v) => {
    const [h, m] = String(v).split(":").map(Number);
    return Number.isFinite(h) ? h * 60 + (Number.isFinite(m) ? m : 0) : null;
  };
  // Resolve the concrete slotId for the booking's variation in a session.
  const slotIdForSession = (session) => {
    const vars = session.variations || [];
    const v =
      vars.find((x) => String(x.variationId) === String(variationId) && !isVariationUnavailable(x)) ||
      vars.find((x) => !isVariationUnavailable(x));
    if (!v) return null;
    const ids = getVariationSlotIds(v);
    return ids.length ? Number(ids[0]) : null;
  };
  const options = sessions
    .map((s) => ({ session: s, slotId: slotIdForSession(s) }))
    .filter((o) => o.slotId && isSessionBookable(o.session))
    .filter((o) => {
      // Only slots that START at or after the current time — never a slot
      // already in progress or past (e.g. at 14:48 the list begins at 14:50,
      // not 13:50). An unknown start time is shown rather than hidden.
      const start = toMin(getStartTime(o.session));
      return start == null ? true : start >= nowMinutes;
    })
    .sort((a, b) => (toMin(getStartTime(a.session)) ?? 0) - (toMin(getStartTime(b.session)) ?? 0));

  return (
    <div role="dialog" aria-modal="true" style={{ position: "fixed", inset: 0, zIndex: 1200, background: "rgba(26,24,20,.62)", display: "flex", alignItems: "center", justifyContent: "center", padding: 18 }}>
      <div style={{ width: "min(560px, 100%)", maxHeight: "calc(100vh - 36px)", background: "#F6F1E8", border: "2px solid var(--ink-900)", borderRadius: 14, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div style={{ padding: "16px 18px", borderBottom: "1.5px solid var(--ink-200)", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
          <div>
            <div className="eyebrow">Move to available slot</div>
            <div style={{ fontSize: 18, fontWeight: 900, marginTop: 2 }}>{activityName} · {formatShortDate(today)}</div>
          </div>
          <button type="button" className="a-btn a-btn--ghost a-btn--sm" onClick={onClose}>
            <Icon name="x" size={14} /> Close
          </button>
        </div>
        <div style={{ padding: 16, overflowY: "auto" }}>
          {isFetching ? (
            <div style={{ color: "var(--ink-500)", padding: 12 }}>Loading today's slots…</div>
          ) : error ? (
            <div style={{ color: "var(--color-danger)", padding: 12 }}>Couldn't load availability.</div>
          ) : options.length === 0 ? (
            <div style={{ color: "var(--ink-500)", padding: 12 }}>No open slots left today for this activity.</div>
          ) : (
            <div style={{ display: "grid", gap: 10 }}>
              {options.map(({ session, slotId }) => (
                <button
                  key={slotId}
                  type="button"
                  disabled={busy}
                  onClick={() => onPick(slotId)}
                  style={{ all: "unset", cursor: busy ? "wait" : "pointer", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, background: "#fff", border: "1.5px solid var(--ink-200)", borderRadius: 12, padding: "14px 16px" }}
                >
                  <div style={{ fontWeight: 900, color: "var(--ink-900)" }}>{timeRangeFromSession(session)}</div>
                  <div style={{ fontSize: 12, color: "var(--ink-600)", fontWeight: 700 }}>
                    {Number(session.capacityRemaining || 0)} {session.availabilityLabel || "spots left"}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function CheckInPaymentModal({
  booking,
  balanceDue,
  amount,
  method,
  note,
  discount,
  isSubmitting,
  complete,
  onAmountChange,
  onMethodChange,
  onNoteChange,
  onDiscountChange,
  onSubmit,
  onGiftCardSubmit,
  gcRedeeming,
  onPrintReceipt,
  onEmailReceipt,
  isSendingReceipt,
  onClose,
}) {
  const [couponCode, setCouponCode] = useState("");
  const [manualDiscount, setManualDiscount] = useState("");
  const [managerOpen, setManagerOpen] = useState(false);
  const [receiptEmail, setReceiptEmail] = useState("");
  const [gcCode, setGcCode] = useState("");
  const [gcPin, setGcPin] = useState("");
  const [gcCard, setGcCard] = useState(null);
  const [validateDiscountCode, { isFetching: validatingCoupon }] = useLazyValidateDiscountCodeQuery();
  const [lookupGiftCard, { isFetching: gcLooking }] = useLazyLookupGiftCardQuery();
  const settings = useEffectiveSettings();
  // Pre-fill the receipt email from any address on the booking; for a
  // walk-in with none, the cashier types one on the complete view.
  useEffect(() => {
    setReceiptEmail(booking?.guestEmail || booking?.guest?.guestEmail || "");
  }, [booking?.bookingId, booking?.guestEmail, booking?.guest?.guestEmail]);
  const discountAmount = roundMoney(Math.min(Number(discount?.amount || 0), balanceDue));
  const payableBalance = roundMoney(Math.max(0, balanceDue - discountAmount));
  const tendered = Number(amount) || 0;
  const isCash = method === "cash";
  const isGiftCard = method === "gift_card";
  const gcBalance = roundMoney(Number(gcCard?.currentBalance || 0));
  const gcApply = isGiftCard && gcCard ? roundMoney(Math.min(payableBalance, gcBalance)) : 0;
  const recordAmount = isCash ? Math.min(payableBalance, tendered) : isGiftCard ? gcApply : tendered;
  const remaining = Math.max(0, payableBalance - recordAmount);
  const changeDue = isCash ? Math.max(0, tendered - payableBalance) : 0;

  const handleGcLookup = async () => {
    const code = gcCode.trim();
    const pin = gcPin.trim();
    if (!code || !pin) { toast.error("Enter gift card code and PIN."); return; }
    try {
      const res = await lookupGiftCard({ code, pin }).unwrap();
      const card = res?.data;
      if (!card) { toast.error("Card not found."); return; }
      if (String(card.status || "").toLowerCase() !== "active") { toast.error(`Card is ${card.status || "unavailable"}.`); return; }
      if (Number(card.currentBalance || 0) <= 0) { toast.error("Card has no balance."); return; }
      setGcCard(card);
      toast.success(`Gift card balance ${moneyFmt(card.currentBalance)}`);
    } catch (err) {
      toast.error(err?.data?.message || err?.data?.error || "Gift card lookup failed.");
    }
  };
  const taxAmount = Number(booking?.taxAmount ?? booking?.tax ?? 0) || 0;
  // Pre-tax subtotal. Prefer the explicit subtotal field; never fall back to
  // totalAmount (it already INCLUDES tax — doing so made the modal show the
  // tax-inclusive total as the "Order Total" and then add Plus Tax again,
  // double-counting tax). If only a total is known, back tax out of it.
  const subTotal = roundMoney(
    Math.max(
      0,
      Number(
        booking?.subtotalAmount ??
        booking?.subTotal ??
        booking?.subtotal ??
        (booking?.totalAmount != null ? Number(booking.totalAmount) - taxAmount : balanceDue)
      ) || 0
    )
  );
  const existingDiscount = Number(booking?.discountAmount || 0) || 0;
  const promoCartLines = useMemo(() => buildBookingPromoCartLines(booking), [booking]);
  const methods = [
    { value: "cash", label: "Cash", icon: "banknote", bg: "#F23B20" },
    { value: "card", label: "Credit / Debit", icon: "credit-card", bg: "#FF8A00" },
    { value: "gift_card", label: "Gift Card", icon: "gift", bg: "#1687F5" },
    { value: "check", label: "Check", icon: "receipt", bg: "#D8D8D8", fg: "#111" },
  ];
  const quickCash = [1, 5, 10, 20, 50, 100];
  const coinTender = [
    { label: "Loonie", value: 1 },
    { label: "Toonie", value: 2 },
    { label: "Dime", value: 0.1 },
    { label: "Qtt", value: 0.25 },
  ];
  const keypad = ["7", "8", "9", "4", "5", "6", "1", "2", "3", "0", "00", "."];
  const applyAmount = (next) => onAmountChange(String(next));
  const addTender = (value) => {
    const next = roundMoney((Number(amount) || 0) + value);
    onAmountChange(next.toFixed(2));
  };
  const handleMethodChange = (nextMethod) => {
    onMethodChange(nextMethod);
    onAmountChange(nextMethod === "cash" || nextMethod === "gift_card" ? "" : payableBalance.toFixed(2));
    if (nextMethod !== "gift_card") setGcCard(null);
  };
  const appendDigit = (digit) => {
    const current = String(amount || "");
    if (digit === "." && current.includes(".")) return;
    const next = current === "0" && digit !== "." ? digit : `${current}${digit}`;
    onAmountChange(next);
  };
  const applyCoupon = async () => {
    const code = couponCode.trim();
    if (!code) {
      toast.error("Enter coupon code.");
      return;
    }
    try {
      const res = await validateDiscountCode({
        code,
        subtotalAmount: subTotal || balanceDue,
        cartLines: promoCartLines,
        guestId: booking?.guestId || null,
      }).unwrap();
      const promo = res?.data || {};
      const rawValue = Number(promo.value || 0);
      const calculated = promo.amount !== undefined && promo.amount !== null
        ? roundMoney(Math.min(payableBalance, Number(promo.amount) || 0))
        : Number(promo.discountType) === 1
          ? roundMoney(Math.min(payableBalance, (balanceDue * rawValue) / 100, Number(promo.maxValue || Infinity)))
          : roundMoney(Math.min(payableBalance, rawValue));
      if (calculated <= 0) {
        toast.error("Coupon has no value for this balance.");
        return;
      }
      onDiscountChange({
        amount: calculated,
        label: promo.name || `Coupon ${code}`,
        code: promo.code || code,
        source: "coupon",
      });
      onAmountChange(method === "cash" ? "" : roundMoney(Math.max(0, balanceDue - calculated)).toFixed(2));
      toast.success(`Coupon applied: ${moneyFmt(calculated)}`);
    } catch (err) {
      toast.error(err?.data?.message || err?.data?.error || "Coupon not valid.");
    }
  };
  const requestManagerDiscount = () => {
    const amt = roundMoney(Math.min(Number(manualDiscount), balanceDue));
    if (!amt || amt <= 0) {
      toast.error("Enter discount amount.");
      return;
    }
    setManagerOpen(true);
  };

  return (
    <div role="dialog" aria-modal="true" style={{
      position: "fixed", inset: 0, zIndex: 1200,
      background: "rgba(26, 24, 20, 0.62)",
      display: "flex", alignItems: "center", justifyContent: "center", padding: 18,
    }}>
      <div style={{
        width: "min(980px, 100%)", maxHeight: "calc(100vh - 24px)", background: "#F6F1E8",
        border: "2px solid var(--ink-900)", borderRadius: 14,
        boxShadow: "0 20px 70px rgba(0,0,0,0.35)", overflow: "auto",
      }}>
        <div style={{ padding: "16px 18px", borderBottom: "1.5px solid var(--ink-200)", display: "flex", justifyContent: "space-between", gap: 12 }}>
          <div>
            <div style={{ fontSize: 11, color: "var(--aero-orange-600)", fontWeight: 800, fontFamily: "var(--font-mono)" }}>
              {displayText(booking.bookingNumber, "Booking")}
            </div>
            <div style={{ fontSize: 20, fontWeight: 900, color: "var(--ink-900)", marginTop: 2 }}>
              {complete ? "Payment complete" : "Take payment"}
            </div>
          </div>
          <button type="button" className="a-btn a-btn--ghost a-btn--sm" onClick={onClose}>
            <Icon name="x" size={14} /> Close
          </button>
        </div>

        {complete ? (
          <div style={{ padding: 18 }}>
            <div style={{
              border: "1.5px solid #8AD5A3", background: "#EAF8EF",
              borderRadius: 12, padding: 16, color: "#137A35",
              fontWeight: 900, display: "flex", alignItems: "center", gap: 10,
            }}>
              <Icon name="check-circle-2" size={20} />
              {moneyFmt(complete.amountPaid)} paid
            </div>
            {complete.discountAmount > 0 && (
              <div style={{ marginTop: 12, border: "1.5px solid var(--ink-200)", borderRadius: 10, padding: 10, fontSize: 13, fontWeight: 800, color: "var(--ink-700)" }}>
                Discount applied: {moneyFmt(complete.discountAmount)} {complete.discountLabel ? `(${complete.discountLabel})` : ""}
              </div>
            )}
            {complete.paymentMethod === "cash" && (
              <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <div style={{ border: "1.5px solid var(--ink-200)", borderRadius: 10, padding: 12 }}>
                  <div style={{ fontSize: 10, fontWeight: 900, color: "var(--ink-500)", textTransform: "uppercase", letterSpacing: "0.08em" }}>Cash received</div>
                  <div style={{ fontSize: 22, fontWeight: 900, color: "var(--ink-900)", marginTop: 4 }}>{moneyFmt(complete.tenderedAmount)}</div>
                </div>
                <div style={{ border: "2px solid #B83210", background: "#FFF3EE", borderRadius: 10, padding: 12 }}>
                  <div style={{ fontSize: 10, fontWeight: 900, color: "#B83210", textTransform: "uppercase", letterSpacing: "0.08em" }}>Return change</div>
                  <div style={{ fontSize: 22, fontWeight: 900, color: "#B83210", marginTop: 4 }}>{moneyFmt(complete.changeDue)}</div>
                </div>
              </div>
            )}
            {complete.drawerOpened && (
              <div style={{ marginTop: 12, border: "1.5px solid var(--ink-200)", borderRadius: 10, padding: 10, display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 800, color: "var(--ink-700)" }}>
                <Icon name="archive" size={16} />
                Cash drawer signal sent.
              </div>
            )}
            <div style={{ marginTop: 14, fontSize: 13, color: "var(--ink-600)", lineHeight: 1.5 }}>
              Booking is checked in and payment is recorded.
            </div>
            {/* Email receipt — type any address (walk-ins have none on file). */}
            <div style={{ marginTop: 14 }}>
              <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--ink-500)", marginBottom: 6 }}>
                Email receipt
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  value={receiptEmail}
                  onChange={(e) => setReceiptEmail(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") onEmailReceipt(receiptEmail); }}
                  placeholder="customer@email.com"
                  style={{ flex: 1, fontSize: 14, padding: "10px 12px", border: "1.5px solid var(--ink-300)", borderRadius: 8 }}
                />
                <button type="button" className="a-btn a-btn--secondary" onClick={() => onEmailReceipt(receiptEmail)} disabled={isSendingReceipt} style={{ justifyContent: "center" }}>
                  <Icon name="mail" size={15} /> {isSendingReceipt ? "Sending..." : "Send"}
                </button>
              </div>
            </div>
            <div style={{ marginTop: 12 }}>
              <button type="button" className="a-btn a-btn--secondary" onClick={onPrintReceipt} style={{ width: "100%", justifyContent: "center" }}>
                <Icon name="printer" size={15} /> Print
              </button>
            </div>
            <button type="button" className="a-btn a-btn--primary" onClick={onClose} style={{ width: "100%", justifyContent: "center", marginTop: 18 }}>
              Done
            </button>
          </div>
        ) : (
          <div style={{ padding: 8, display: "grid", gridTemplateColumns: "130px minmax(260px, 1fr) minmax(280px, 340px)", gap: 12 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {methods.map((m) => {
                const active = method === m.value;
                return (
                  <button key={m.value} type="button" onClick={() => handleMethodChange(m.value)} style={{
                    border: active ? "3px solid var(--ink-900)" : "1.5px solid var(--ink-400)",
                    background: m.bg,
                    borderRadius: 6, padding: "14px 8px", fontWeight: 900,
                    color: m.fg || "white", minHeight: 58,
                    cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 7,
                  }}>
                    <Icon name={m.icon} size={16} />
                    {m.label}
                  </button>
                );
              })}
              <div style={{ height: 18 }} />
              <button type="button" onClick={applyCoupon} disabled={validatingCoupon} style={{ border: "1.5px solid var(--ink-500)", background: "#F529C8", color: "white", borderRadius: 6, padding: "13px 8px", fontWeight: 900, cursor: "pointer" }}>
                Customer Coupon
              </button>
              <button type="button" onClick={requestManagerDiscount} style={{ border: "1.5px solid var(--ink-500)", background: "#FF78A5", color: "#111", borderRadius: 6, padding: "13px 8px", fontWeight: 900, cursor: "pointer" }}>
                Manager Discount
              </button>
              <button type="button" onClick={() => {
                const amt = roundMoney(Math.min(Number(manualDiscount), balanceDue));
                if (amt <= 0) return toast.error("Enter discount amount.");
                if (settings?.enableCustomDiscount === false) {
                  return toast.error("Custom discounts are disabled for this terminal.");
                }
                // Above the cashier's allowance (and not explicitly waived),
                // an employee discount needs manager approval — same gate as
                // the Manager Discount button.
                const limit = Number(settings?.cashierDiscountAmountLimit) || 0;
                const needsManager =
                  settings?.allowCustomDiscountWithoutPin !== true && limit > 0 && amt > limit;
                if (needsManager) {
                  toast.message(`Discounts over ${moneyFmt(limit)} need manager approval.`);
                  setManagerOpen(true);
                  return;
                }
                onDiscountChange({ amount: amt, label: "Employee discount", source: "employee" });
                onAmountChange(method === "cash" ? "" : roundMoney(Math.max(0, balanceDue - amt)).toFixed(2));
              }} style={{ border: "1.5px solid var(--ink-500)", background: "#F8287D", color: "white", borderRadius: 6, padding: "13px 8px", fontWeight: 900, cursor: "pointer" }}>
                Employee Discount
              </button>
              <button type="button" className="a-btn a-btn--secondary" onClick={onClose} style={{ marginTop: "auto", justifyContent: "center", minHeight: 46 }}>
                Continue Ordering
              </button>
            </div>

            <div>
              <textarea
                value={note}
                onChange={(e) => onNoteChange(e.target.value)}
                placeholder="Payment note"
                style={{ width: "100%", height: 76, resize: "vertical", border: "1.5px solid var(--ink-400)", background: "white", borderRadius: 4, padding: 10, outline: 0, boxSizing: "border-box", marginBottom: 8 }}
              />
              <div style={{ background: "#FFFDD1", border: "1.5px solid var(--ink-400)", padding: 12, fontSize: 14, fontWeight: 800 }}>
                <TotalLine label="Order Total" value={moneyFmt(subTotal)} />
                <TotalLine label="Existing Discounts" value={moneyFmt(existingDiscount)} />
                <TotalLine label="POS Discount" value={moneyFmt(discountAmount)} tone={discountAmount > 0 ? "#F45B0A" : undefined} />
                <div style={{ borderTop: "3px solid var(--ink-900)", margin: "8px 0" }} />
                <TotalLine label="Sub Total" value={moneyFmt(Math.max(0, subTotal - existingDiscount - discountAmount))} />
                <TotalLine label="Plus Tax" value={moneyFmt(taxAmount)} />
                <div style={{ borderTop: "3px solid var(--ink-900)", margin: "8px 0" }} />
                <TotalLine label="Grand Total" value={moneyFmt(balanceDue)} tone="#08A5E8" />
                <TotalLine label="Tender Due" value={moneyFmt(payableBalance)} tone="#F45B0A" />
                <TotalLine label="Tendered" value={moneyFmt(tendered)} />
                <TotalLine label={isCash ? "Change" : "Balance Remaining"} value={moneyFmt(isCash ? changeDue : remaining)} tone={isCash && changeDue > 0 ? "#B83210" : "#08A5E8"} />
                {discount?.label && (
                  <div style={{ marginTop: 8, display: "flex", gap: 8, alignItems: "center", justifyContent: "space-between", fontSize: 12 }}>
                    <span>{discount.label}</span>
                    <button type="button" className="a-btn a-btn--ghost a-btn--sm" onClick={() => onDiscountChange(null)}>
                      Clear
                    </button>
                  </div>
                )}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 8 }}>
                <button type="button" className="a-btn a-btn--secondary" onClick={() => applyAmount(payableBalance.toFixed(2))} style={{ justifyContent: "center" }}>
                  Exact Change
                </button>
                <button type="button" className="a-btn a-btn--secondary" onClick={() => { onAmountChange(""); onDiscountChange(null); setCouponCode(""); setManualDiscount(""); }} style={{ justifyContent: "center" }}>
                  Clear Payments
                </button>
              </div>
              <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                <input value={couponCode} onChange={(e) => setCouponCode(e.target.value)} placeholder="Coupon code" style={{ border: "1.5px solid var(--ink-300)", borderRadius: 8, padding: 10 }} />
                <input value={manualDiscount} onChange={(e) => setManualDiscount(e.target.value)} type="number" min="0" step="0.01" placeholder="Discount $" style={{ border: "1.5px solid var(--ink-300)", borderRadius: 8, padding: 10 }} />
              </div>
            </div>

            <div style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
              {isGiftCard ? (
                <div style={{ flex: 1, display: "grid", gap: 10, alignContent: "start" }}>
                  <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--ink-500)" }}>Gift card</div>
                  {!gcCard ? (
                    <>
                      <input value={gcCode} onChange={(e) => setGcCode(e.target.value.toUpperCase())} onKeyDown={(e) => { if (e.key === "Enter") handleGcLookup(); }} placeholder="Card code" autoComplete="off" style={{ fontSize: 15, padding: "12px 14px", border: "1.5px solid var(--ink-300)", borderRadius: 8, fontFamily: "var(--font-mono)", fontWeight: 800 }} />
                      <input value={gcPin} onChange={(e) => setGcPin(e.target.value.replace(/\D/g, ""))} onKeyDown={(e) => { if (e.key === "Enter") handleGcLookup(); }} placeholder="PIN" inputMode="numeric" maxLength={6} type="password" autoComplete="off" style={{ fontSize: 15, padding: "12px 14px", border: "1.5px solid var(--ink-300)", borderRadius: 8 }} />
                      <button type="button" className="a-btn a-btn--secondary" onClick={handleGcLookup} disabled={gcLooking || !gcCode.trim() || !gcPin.trim()} style={{ justifyContent: "center", minHeight: 48 }}>
                        <Icon name="search" size={16} /> {gcLooking ? "Looking…" : "Look up card"}
                      </button>
                    </>
                  ) : (
                    <div style={{ border: "1.5px solid var(--ink-300)", borderRadius: 10, padding: 12, background: "white", display: "grid", gap: 6 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontFamily: "var(--font-mono)", fontWeight: 900 }}>
                        <span>{gcCard.code}</span>
                        <button type="button" onClick={() => setGcCard(null)} title="Use a different card" style={{ all: "unset", cursor: "pointer", color: "var(--ink-500)" }}><Icon name="x" size={14} /></button>
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}><span>Card balance</span><span style={{ fontWeight: 800 }}>{moneyFmt(gcBalance)}</span></div>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}><span>Applies to order</span><span style={{ fontWeight: 900, color: "#137A35" }}>{moneyFmt(gcApply)}</span></div>
                      {remaining > 0 && <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "#B83210" }}><span>Balance remaining</span><span style={{ fontWeight: 800 }}>{moneyFmt(remaining)}</span></div>}
                    </div>
                  )}
                </div>
              ) : (
              <>
              <div style={{ flex: 1, minHeight: 138, background: "#E9F3F6", border: "1.5px solid var(--ink-300)", marginBottom: 8, padding: 8, fontSize: 13, fontWeight: 800 }}>
                <div style={{ display: "flex", justifyContent: "space-between", color: "#0A75D9" }}>
                  <span>{method === "cash" ? "Cash" : methods.find((m) => m.value === method)?.label || method}</span>
                  <span>{moneyFmt(tendered)}</span>
                </div>
                {discountAmount > 0 && (
                  <div style={{ display: "flex", justifyContent: "space-between", color: "#F45B0A", marginTop: 6 }}>
                    <span>{discount?.label || "Discount"}</span>
                    <span>-{moneyFmt(discountAmount)}</span>
                  </div>
                )}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr) 1fr 1fr", gap: 4 }}>
                {keypad.map((key) => (
                  <button key={key} type="button" onClick={() => appendDigit(key)} style={{ minHeight: 54, border: "1px solid var(--ink-200)", background: "white", borderRadius: 7, fontSize: 22, fontWeight: 900, cursor: "pointer" }}>
                    {key}
                  </button>
                ))}
                {quickCash.map((cash) => (
                  <button key={cash} type="button" onClick={() => isCash ? addTender(cash) : applyAmount(cash.toFixed(2))} style={{ minHeight: 54, border: "1.5px solid #51B800", background: "#65E600", borderRadius: 7, fontSize: 20, fontWeight: 900, cursor: "pointer" }}>
                    ${cash}
                  </button>
                ))}
                {coinTender.map((coin) => (
                  <button key={coin.label} type="button" onClick={() => isCash ? addTender(coin.value) : applyAmount(coin.value.toFixed(2))} style={{ minHeight: 54, border: "1.5px solid #A96D00", background: "#D99316", color: "#111", borderRadius: 7, fontSize: 15, fontWeight: 900, cursor: "pointer" }}>
                    {coin.label}
                  </button>
                ))}
                <button type="button" onClick={() => onAmountChange("")} style={{ minHeight: 54, border: "1px solid var(--ink-200)", background: "white", borderRadius: 7, fontSize: 20, fontWeight: 900, cursor: "pointer" }}>
                  Clear
                </button>
                <button type="button" onClick={() => onAmountChange(String(amount || "").slice(0, -1))} style={{ minHeight: 54, border: "1px solid var(--ink-200)", background: "white", borderRadius: 7, fontSize: 18, fontWeight: 900, cursor: "pointer" }}>
                  <Icon name="delete" size={18} />
                </button>
              </div>
              </>
              )}
              <button type="button" className="a-btn a-btn--primary"
                onClick={isGiftCard ? () => onGiftCardSubmit?.({ code: gcCode, pin: gcPin, amount: gcApply }) : onSubmit}
                disabled={isSubmitting || gcRedeeming || (isGiftCard && !gcCard)}
                style={{ width: "100%", justifyContent: "center", minHeight: 52, marginTop: 8, fontSize: 16 }}>
                <Icon name="check" size={16} />
                {(isSubmitting || gcRedeeming) ? "Recording..." : isGiftCard ? `Pay ${moneyFmt(gcApply)} by gift card` : "Complete The Order"}
              </button>
            </div>
          </div>
        )}
      </div>
      <ManagerOverridePrompt
        open={managerOpen}
        title="Approve manager discount"
        description={`Apply ${moneyFmt(Math.min(Number(manualDiscount), balanceDue))} discount to ${displayText(booking.bookingNumber, "booking")}.`}
        action="pos_manager_discount"
        targetType="booking"
        targetId={booking.bookingId}
        payload={{ amount: roundMoney(Math.min(Number(manualDiscount), balanceDue)) }}
        defaultReason="POS check-in manager discount"
        onCancel={() => setManagerOpen(false)}
        onApprove={(audit) => {
          const amt = roundMoney(Math.min(Number(manualDiscount), balanceDue));
          onDiscountChange({ amount: amt, label: "Manager discount", source: "manager", managerName: audit?.managerName });
          onAmountChange(method === "cash" ? "" : roundMoney(Math.max(0, balanceDue - amt)).toFixed(2));
          setManagerOpen(false);
        }}
      />
    </div>
  );
}

function TotalLine({ label, value, tone }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, color: tone || "var(--ink-900)", margin: "3px 0" }}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}

// BoundHolderChip — pill showing the currently-bound participant with a
// small × that unbinds them from this ticket (without removing the participant
// from the booking). After unbind, the row's HolderPicker reappears so the
// cashier can pick a different person — that's the "replace" flow.
function BoundHolderChip({ participant, onUnbind, busy }) {
  return (
    <div style={{ marginTop: 6, display: "inline-flex", alignItems: "center", gap: 4 }}>
      <span style={{ fontSize: 10, fontWeight: 800, color: "var(--ink-500)", textTransform: "uppercase", letterSpacing: "0.06em", marginRight: 4 }}>
        Holder
      </span>
      <span style={{
        display: "inline-flex", alignItems: "center", gap: 5,
        padding: "4px 4px 4px 10px",
        borderRadius: 999,
        background: "var(--aero-orange-50, #FFF1E8)",
        border: "1.5px solid var(--aero-orange-500, #F45B0A)",
        fontSize: 11, fontWeight: 700, color: "var(--aero-orange-700, #B8400A)",
      }}>
        {participant.isMinor && <span style={{ fontSize: 9, opacity: 0.7 }}>👶</span>}
        {displayText(participant.displayName, "Guest")}
        {onUnbind && (
          <button
            type="button"
            disabled={busy}
            onClick={onUnbind}
            title="Unlink this holder — pick a different person for this ticket"
            style={{
              all: "unset",
              cursor: busy ? "wait" : "pointer",
              width: 16, height: 16, marginLeft: 2,
              display: "inline-flex", alignItems: "center", justifyContent: "center",
              borderRadius: 999,
              background: "rgba(244,91,10,0.15)",
              color: "var(--aero-orange-700)",
            }}
            onMouseEnter={(e) => { if (!busy) e.currentTarget.style.background = "rgba(244,91,10,0.30)"; }}
            onMouseLeave={(e) => { if (!busy) e.currentTarget.style.background = "rgba(244,91,10,0.15)"; }}
          >
            <Icon name="x" size={9} stroke={3} />
          </button>
        )}
      </span>
    </div>
  );
}

// HolderPicker — surfaces waiver-eligible booking participants as one-tap
// chips so the cashier doesn't have to open the search modal for the common
// case (1–4 candidates already attached via signed waivers).
function HolderPicker({ candidates, onPick, onSearch, busy }) {
  const [showAll, setShowAll] = React.useState(false);

  if (!candidates || candidates.length === 0) {
    return (
      <div style={{
        marginTop: 6,
        display: "inline-flex", alignItems: "center", gap: 8,
        padding: "5px 10px",
        background: "var(--color-warning-soft, #FEF3C7)",
        border: "1.5px solid var(--color-warning, #F59E0B)",
        borderRadius: 8,
        fontSize: 11, fontWeight: 700, color: "#8B6100",
      }}>
        <Icon name="alert-triangle" size={11} />
        No matching waiver
        <button
          type="button"
          onClick={onSearch}
          style={{
            all: "unset", cursor: "pointer", marginLeft: 4,
            padding: "2px 8px", borderRadius: 6,
            background: "white", color: "var(--ink-900)",
            fontSize: 11, fontWeight: 700,
            border: "1.5px solid var(--ink-300)",
          }}
        >
          Find waiver
        </button>
      </div>
    );
  }

  const visible = showAll ? candidates : candidates.slice(0, 4);
  const hiddenCount = Math.max(0, candidates.length - visible.length);
  const isSingle = candidates.length === 1;

  return (
    <div style={{
      marginTop: 6,
      display: "flex", alignItems: "center", flexWrap: "wrap", gap: 6,
    }}>
      <span style={{ fontSize: 10, fontWeight: 800, color: "var(--ink-500)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
        {isSingle ? "Suggested" : "Pick holder"}
      </span>
      {visible.map((p) => (
        <button
          key={p.bookingParticipantId}
          type="button"
          disabled={busy}
          onClick={() => onPick(p.bookingParticipantId)}
          title={p.isMinor ? "Minor — covered by waiver" : "Adult — covered by waiver"}
          style={{
            all: "unset", cursor: busy ? "wait" : "pointer",
            display: "inline-flex", alignItems: "center", gap: 5,
            padding: "4px 10px", borderRadius: 999,
            background: isSingle ? "var(--aero-orange-50, #FFF1E8)" : "white",
            border: `1.5px solid ${isSingle ? "var(--aero-orange-500)" : "var(--ink-300)"}`,
            fontSize: 11, fontWeight: 700,
            color: isSingle ? "var(--aero-orange-700)" : "var(--ink-800)",
          }}
          onMouseEnter={(e) => {
            if (busy) return;
            e.currentTarget.style.borderColor = "var(--aero-orange-500)";
            e.currentTarget.style.background = "var(--aero-orange-50)";
          }}
          onMouseLeave={(e) => {
            if (busy) return;
            e.currentTarget.style.borderColor = isSingle ? "var(--aero-orange-500)" : "var(--ink-300)";
            e.currentTarget.style.background = isSingle ? "var(--aero-orange-50)" : "white";
          }}
        >
          {p.isMinor && <span style={{ fontSize: 9, opacity: 0.7 }}>👶</span>}
          {displayText(p.displayName, "Guest")}
        </button>
      ))}
      {hiddenCount > 0 && (
        <button
          type="button"
          onClick={() => setShowAll(true)}
          style={{
            all: "unset", cursor: "pointer",
            padding: "4px 10px", borderRadius: 999,
            background: "transparent",
            border: "1.5px dashed var(--ink-300)",
            fontSize: 11, fontWeight: 700, color: "var(--ink-600)",
          }}
        >
          +{hiddenCount} more
        </button>
      )}
      <button
        type="button"
        onClick={onSearch}
        style={{
          all: "unset", cursor: "pointer",
          padding: "4px 10px", borderRadius: 999,
          background: "transparent",
          fontSize: 11, fontWeight: 600, color: "var(--ink-500)",
        }}
        title="Search all waivers (out of booking)"
      >
        Other…
      </button>
    </div>
  );
}

// ── WaiverLookupModal — search signed waivers for this location and
//    link the picked one as a participant on the current booking ──
function WaiverLookupModal({ bookingId, onClose, onLinked }) {
  const [query, setQuery] = useState("");
  // When a chosen waiver covers a signer + minors, we expand it into a
  // person chooser so the cashier links only who's actually jumping.
  const [chooser, setChooser] = useState(null); // { sig, names } | null
  const [selectedPeople, setSelectedPeople] = useState(new Set());
  const [trigger, { data, isFetching }] = useLazySearchWaiversQuery();
  const [linkFromWaiver, { isLoading: linking }] = useLinkParticipantFromWaiverMutation();

  const closeModal = () => {
    setQuery("");
    setChooser(null);
    setSelectedPeople(new Set());
    onClose?.();
  };

  // People on a waiver: signer (key "signer") + each minor ("minor:N").
  const peopleOf = (sig) => {
    const signerName = sig.guest?.guestName || sig.name || sig.signedByName || sig.signedBy || "Signer";
    const minors = Array.isArray(sig.minors) ? sig.minors : [];
    return [
      { key: "signer", label: signerName, kind: "Adult" },
      ...minors.map((m, i) => ({ key: `minor:${i}`, label: m?.name || m?.firstName || `Minor ${i + 1}`, kind: "Minor" })),
    ];
  };

  const linkPeople = async (sig, peopleKeys) => {
    const waiverSignatureId = sig.signatureId ?? sig.id;
    if (!peopleKeys || peopleKeys.length === 0) {
      toast.error("Pick at least one person to add.");
      return;
    }
    const toastId = toast.loading("Linking waiver...");
    try {
      const res = await linkFromWaiver({ bookingId, waiverSignatureId, people: peopleKeys }).unwrap();
      await onLinked?.(res);
      closeModal();
      const n = res?.data?.created || 0;
      const covered = res?.data?.covered || 0;
      if (n > 0) toast.success(`Linked ${n} guest${n === 1 ? "" : "s"}`, { id: toastId });
      else if (covered > 0) toast.success("Attached waiver coverage", { id: toastId });
      else toast.success("Already linked", { id: toastId });
    } catch (err) {
      toast.error(err?.data?.error || "Could not link", { id: toastId });
    }
  };

  React.useEffect(() => {
    const t = setTimeout(() => {
      if (query.trim().length >= 2) trigger({ search: query.trim(), limit: 50 });
    }, 250);
    return () => clearTimeout(t);
  }, [query, trigger]);

  const results = React.useMemo(() => {
    if (query.trim().length < 2) return [];
    const rows = data?.data || [];
    const bySignature = new Map();
    for (const row of rows) {
      const signatureId = row.signatureId ?? row.id;
      if (!signatureId) continue;
      const existing = bySignature.get(signatureId);
      if (!existing || row.holderType === "adult") {
        bySignature.set(signatureId, row);
      }
    }
    return Array.from(bySignature.values());
  }, [data, query]);

  const handlePick = (sig) => {
    const minorCount = Array.isArray(sig.minors) ? sig.minors.length : Number(sig.minorCount || 0);
    // A waiver covering only the signer → link them directly (one tap).
    // A waiver that also covers minors → let the cashier choose who's
    // actually checking in, so we don't add the guardian AND every minor.
    if (minorCount === 0) {
      linkPeople(sig, ["signer"]);
      return;
    }
    setChooser({ sig });
    setSelectedPeople(new Set()); // nothing pre-selected — cashier decides
  };

  const togglePerson = (key) => {
    setSelectedPeople((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <div
      onClick={closeModal}
      style={{
        position: "fixed", inset: 0, zIndex: 100, background: "rgba(0,0,0,0.4)",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 540, maxHeight: "82vh",
          background: "white", borderRadius: 18,
          border: "2px solid var(--ink-800)", boxShadow: "0 8px 0 var(--ink-800)",
          padding: 22, display: "flex", flexDirection: "column",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <h2 style={{ margin: 0, fontFamily: "var(--font-display)", fontSize: 20, fontWeight: 800, color: "var(--ink-900)" }}>
            {chooser ? "Who's checking in?" : "Find a waiver"}
          </h2>
          <button
            type="button"
            onClick={closeModal}
            style={{ all: "unset", cursor: "pointer", color: "var(--ink-500)", padding: 4 }}
            title="Close"
          >
            <Icon name="x" size={18} />
          </button>
        </div>

        {chooser && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ fontSize: 12, color: "var(--ink-600)" }}>
              This waiver covers more than one person. Add only who's actually checking in.
            </div>
            <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gap: 8 }}>
              {peopleOf(chooser.sig).map((person) => {
                const checked = selectedPeople.has(person.key);
                return (
                  <li key={person.key}>
                    <button
                      type="button"
                      onClick={() => togglePerson(person.key)}
                      style={{
                        all: "unset", cursor: "pointer", display: "flex", alignItems: "center", gap: 10,
                        width: "100%", boxSizing: "border-box", padding: "12px 14px",
                        border: `1.5px solid ${checked ? "var(--aero-orange-500)" : "var(--ink-200)"}`,
                        borderRadius: 10, background: checked ? "var(--aero-orange-50)" : "white",
                      }}
                    >
                      <span style={{
                        width: 20, height: 20, borderRadius: 6,
                        border: `1.5px solid ${checked ? "var(--aero-orange-500)" : "var(--ink-300)"}`,
                        background: checked ? "var(--aero-orange-500)" : "white",
                        display: "inline-flex", alignItems: "center", justifyContent: "center", color: "white",
                      }}>
                        {checked && <Icon name="check" size={13} stroke={3} />}
                      </span>
                      <span style={{ flex: 1, fontWeight: 700, color: "var(--ink-900)" }}>{person.label}</span>
                      <span style={{ fontSize: 11, fontWeight: 700, color: "var(--ink-500)" }}>{person.kind}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
            <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
              <button type="button" className="a-btn a-btn--ghost" onClick={() => { setChooser(null); setSelectedPeople(new Set()); }} style={{ justifyContent: "center" }}>
                <Icon name="arrow-left" size={14} /> Back
              </button>
              <button
                type="button"
                className="a-btn a-btn--primary"
                disabled={linking || selectedPeople.size === 0}
                onClick={() => linkPeople(chooser.sig, [...selectedPeople])}
                style={{ flex: 1, justifyContent: "center" }}
              >
                <Icon name="user-plus" size={14} /> {linking ? "Linking…" : `Link selected (${selectedPeople.size})`}
              </button>
            </div>
          </div>
        )}

        {!chooser && (
        <>
        <div style={{
          display: "flex", alignItems: "center", gap: 8,
          padding: "10px 12px", background: "var(--ink-25)",
          border: "1.5px solid var(--ink-200)", borderRadius: 12, marginBottom: 12,
        }}>
          <Icon name="search" size={16} style={{ color: "var(--ink-500)" }} />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Name, email or phone…"
            style={{ all: "unset", flex: 1, fontSize: 14, fontWeight: 600 }}
          />
        </div>

        <div style={{ overflowY: "auto", flex: 1, marginBottom: 4 }}>
          {query.trim().length < 2 ? (
            <div style={{ padding: 24, textAlign: "center", fontSize: 13, color: "var(--ink-500)" }}>
              Type at least 2 characters to search.
            </div>
          ) : isFetching ? (
            <div style={{ padding: 24, textAlign: "center", fontSize: 13, color: "var(--ink-500)" }}>
              Searching…
            </div>
          ) : results.length === 0 ? (
            <div style={{ padding: 24, textAlign: "center", fontSize: 13, color: "var(--ink-500)" }}>
              No matching waivers. The guest will need to sign one first.
            </div>
          ) : (
            <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 6 }}>
              {results.map((sig) => {
                const signatureId = sig.signatureId ?? sig.id;
                const displayName =
                  sig.guest?.guestName ||
                  sig.name ||
                  sig.signedByName ||
                  sig.signedBy ||
                  "Guest";
                const contact =
                  sig.guest?.guestEmail ||
                  sig.email ||
                  sig.guest?.guestPhone ||
                  sig.phone ||
                  "—";
                const minorCount = Array.isArray(sig.minors)
                  ? sig.minors.length
                  : Number(sig.minorCount || 0);
                const expired = sig.expiredAt && new Date(sig.expiredAt) < new Date();
                return (
                  <li key={signatureId}>
                    <button
                      type="button"
                      disabled={linking}
                      onClick={() => handlePick(sig)}
                      style={{
                        all: "unset", cursor: linking ? "wait" : "pointer", display: "block", width: "100%", boxSizing: "border-box",
                        padding: "10px 12px",
                        border: "1.5px solid var(--ink-200)",
                        borderRadius: 10, background: "white",
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.borderColor = "var(--aero-orange-500)")}
                      onMouseLeave={(e) => (e.currentTarget.style.borderColor = "var(--ink-200)")}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <div>
                          <div style={{ fontWeight: 700, fontSize: 14, color: "var(--ink-900)" }}>
                            {displayName}
                          </div>
                          <div style={{ fontSize: 11, color: "var(--ink-500)", marginTop: 2 }}>
                            {contact}
                            {minorCount > 0 && <span> · {minorCount} minor{minorCount === 1 ? "" : "s"}</span>}
                            {sig.signedAt && <span> · signed {new Date(sig.signedAt).toLocaleDateString()}</span>}
                          </div>
                        </div>
                        {expired ? (
                          <StatusPill tone="danger">Expired</StatusPill>
                        ) : (
                          <Icon name="chevron-right" size={16} style={{ color: "var(--ink-400)" }} />
                        )}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div style={{ fontSize: 11, color: "var(--ink-500)", textAlign: "center", marginTop: 8 }}>
          Picking a waiver creates a participant on this booking. Existing waivers
          tied to the booking auto-link at sign-time — use this only when a guest's
          waiver wasn't auto-attached.
        </div>
        </>
        )}
      </div>
    </div>
  );
}

function MiniStat({ label, value, tone }) {
  const fg = {
    warning: "#8B6100",
    success: "var(--color-success)",
    default: "var(--ink-700)",
  }[tone] || "var(--ink-700)";
  const bg = {
    warning: "var(--color-warning-soft)",
    success: "var(--color-success-soft)",
    default: "var(--ink-50)",
  }[tone] || "var(--ink-50)";
  return (
    <div style={{ background: bg, padding: "8px 10px", borderRadius: 10 }}>
      <div style={{ fontSize: 10, fontWeight: 800, color: fg, textTransform: "uppercase", letterSpacing: "0.06em" }}>
        {label}
      </div>
      <div style={{ fontSize: 18, fontWeight: 800, color: fg, marginTop: 2, fontVariantNumeric: "tabular-nums" }}>
        {value}
      </div>
    </div>
  );
}

// ── Inline name-entry form for bookings with no named participants ──
// Shows N text inputs (one per ticket), saves them as BookingParticipant
// rows so the cashier can then check each guest in individually.
function NameGuestsForm({ bookingId, totalGuests, existingParticipants = [], onSaved }) {
  const [names, setNames] = useState(() =>
    Array.from({ length: Math.max(1, Number(totalGuests) || 1) }, () => ({ displayName: "", isMinor: false }))
  );
  const [upsert, { isLoading }] = useUpsertParticipantsMutation();

  const updateName = (idx, patch) =>
    setNames((prev) => prev.map((n, i) => (i === idx ? { ...n, ...patch } : n)));

  const pasteNames = (startIndex, text) => {
    const pasted = String(text || "")
      .split(/[\n,;]+/)
      .map((name) => name.trim().replace(/\s+/g, " "))
      .filter(Boolean);
    if (pasted.length <= 1) return false;
    setNames((prev) => {
      const next = [...prev];
      pasted.forEach((displayName, offset) => {
        const index = startIndex + offset;
        if (next[index]) next[index] = { ...next[index], displayName };
        else next.push({ displayName, isMinor: false });
      });
      return next;
    });
    return true;
  };

  const handleSave = async () => {
    const filled = names
      .map((row) => ({ ...row, displayName: row.displayName.trim().replace(/\s+/g, " ") }))
      .filter((n) => n.displayName.length > 0);
    if (filled.length === 0) {
      toast.error("Type at least one guest name");
      return;
    }
    const existingNames = new Set(existingParticipants.map((participant) => normalizeGuestName(displayText(participant.displayName, ""))));
    const seen = new Set();
    const duplicate = filled.find((row) => {
      const key = normalizeGuestName(row.displayName);
      if (!key) return false;
      if (existingNames.has(key) || seen.has(key)) return true;
      seen.add(key);
      return false;
    });
    if (duplicate) {
      toast.error(`${duplicate.displayName} is already on this booking`);
      return;
    }
    const promise = upsert({ bookingId, participants: filled }).unwrap();
    toast.promise(promise, {
      loading: "Saving names…",
      success: () => { onSaved?.(); return `Added ${filled.length} guest${filled.length === 1 ? "" : "s"}`; },
      error: (err) => err?.data?.error || "Save failed",
    });
  };

  return (
    <div style={{
      padding: 12, background: "var(--ink-25)",
      border: "1.5px dashed var(--ink-300)", borderRadius: 10,
    }}>
      <div style={{ fontSize: 12, color: "var(--ink-700)", lineHeight: 1.5, marginBottom: 10 }}>
        No named guests yet. Type a name for each ticket, then save to enable
        per-guest check-in. (Or use <strong>"All"</strong> above to check in everyone anonymously.)
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 10 }}>
        {names.map((row, idx) => (
          <div key={idx} style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <span style={{
              fontSize: 11, fontWeight: 800, color: "var(--ink-500)",
              fontFamily: "var(--font-mono)", width: 22,
            }}>{idx + 1}.</span>
            <input
              value={row.displayName}
              onChange={(e) => updateName(idx, { displayName: e.target.value })}
              onPaste={(e) => {
                if (pasteNames(idx, e.clipboardData.getData("text"))) e.preventDefault();
              }}
              placeholder={`Guest ${idx + 1} name`}
              style={{
                flex: 1, padding: "8px 10px",
                borderRadius: 8, border: "1.5px solid var(--ink-200)",
                fontSize: 13, fontWeight: 600, color: "var(--ink-900)",
                background: "white", outline: "none",
              }}
            />
            <label
              title="Mark as minor"
              style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, color: "var(--ink-600)", cursor: "pointer" }}
            >
              <input
                type="checkbox"
                checked={row.isMinor}
                onChange={(e) => updateName(idx, { isMinor: e.target.checked })}
              />
              minor
            </label>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 6 }}>
        <button
          type="button"
          onClick={() => setNames((prev) => [...prev, { displayName: "", isMinor: false }])}
          className="a-btn a-btn--ghost a-btn--sm"
          style={{ flex: 1, justifyContent: "center" }}
        >
          <Icon name="plus" size={12} /> Add row
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={isLoading}
          className="a-btn a-btn--primary a-btn--sm"
          style={{ flex: 2, justifyContent: "center" }}
        >
          <Icon name="save" size={12} /> Save names
        </button>
      </div>
    </div>
  );
}
