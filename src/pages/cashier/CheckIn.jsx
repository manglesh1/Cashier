// CheckIn — cashier check-in screen.
// Lists today's confirmed reservations, lets the cashier search by
// name/email/phone/booking number, and one-tap-checks-in the whole
// party via the checkInAllTickets endpoint (which iterates the booking's
// pending tickets, mints redemption events, and respects waiver/expiry
// rules — the exact same path the Redeem screen takes).

import React, { useMemo, useState } from "react";
import { toast } from "sonner";
import { Icon } from "./Icon";
import { StatusPill } from "./StatusPill";
import { useGetAllBookingQuery } from "../../features/bookings/bookingApi";
import {
  useGetBookingTicketsQuery,
  useCheckInAllTicketsMutation,
} from "../../features/tickets/ticketApi";
import { useDebounceSearch } from "../../hooks/useDebounceSearch";

const today = new Date().toISOString().slice(0, 10);

const fmtTime = (range) => (range || "").split(/[–-]/)[0].trim() || "—";

export function CheckIn() {
  const { searchTerm, inputValue, setDebouncedSearch } = useDebounceSearch(400);
  const [selected, setSelected] = useState(null);

  const { data, isLoading, refetch } = useGetAllBookingQuery({
    page: 1,
    limit: 100,
    search: searchTerm,
    dateFrom: today,
    dateTo: today,
    status: ["confirmed", "pending"],
    paymentStatus: [],
    productId: [],
  });

  const bookings = data?.data || [];
  const stats = data?.stats || {};

  const partition = useMemo(() => {
    const now = new Date();
    return bookings
      .map((b) => ({
        ...b,
        _arrival: parseTime(b.timeRange),
        _waiverComplete: !b.waiverRequired || (b.signedWaivers ?? 0) >= (b.totalGuests ?? 0),
        _isPaid: String(b.paymentStatus || "").toLowerCase() === "paid",
      }))
      .sort((a, b) => (a._arrival || 9e15) - (b._arrival || 9e15))
      .map((b) => ({
        ...b,
        _isUpcoming: b._arrival && b._arrival > now,
        _isLate: b._arrival && b._arrival < now,
      }));
  }, [bookings]);

  const totalToday = stats.total ?? bookings.length;
  // Cheap proxy for "checked in" — bookings whose all participants are checked in.
  // Real number would require a separate aggregate endpoint; this is good enough.
  const checkedInCount = bookings.filter((b) => (b.checkedInGuests ?? 0) >= (b.totalGuests ?? 0) && (b.totalGuests ?? 0) > 0).length;

  return (
    <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
      {/* Search bar */}
      <div style={{ padding: "16px 28px", borderBottom: "1px solid var(--ink-100)", display: "flex", gap: 12, alignItems: "center" }}>
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
          }}
        >
          <Icon name="search" size={20} stroke={2} style={{ color: "var(--ink-500)" }} />
          <input
            value={inputValue}
            onChange={(e) => setDebouncedSearch(e.target.value)}
            placeholder="Search by name, email, phone, or booking ID…"
            style={{ all: "unset", flex: 1, fontSize: 16 }}
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
      <div style={{ padding: "16px 28px", display: "flex", gap: 28, flexShrink: 0, borderBottom: "1px solid var(--ink-100)" }}>
        <Stat label="Booked today" value={totalToday} />
        <Stat label="Checked in" value={checkedInCount} fg="var(--color-success)" />
        <Stat label="Pending arrival" value={Math.max(0, totalToday - checkedInCount)} />
      </div>

      {/* Body — list (left) + selected detail (right) */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden", minHeight: 0 }}>
        <div style={{ flex: 1, overflowY: "auto", padding: "16px 28px", borderRight: "1px solid var(--ink-100)" }}>
          {isLoading ? (
            <div style={{ padding: 32, textAlign: "center", color: "var(--ink-500)" }}>Loading…</div>
          ) : partition.length === 0 ? (
            <div style={{ padding: 32, textAlign: "center", color: "var(--ink-500)" }}>
              No reservations match.
            </div>
          ) : (
            partition.map((b) => (
              <BookingRow
                key={b.bookingMasterId}
                b={b}
                isSelected={selected?.bookingMasterId === b.bookingMasterId}
                onClick={() => setSelected(b)}
              />
            ))
          )}
        </div>
        <aside style={{ width: 360, overflowY: "auto", padding: "16px 22px" }}>
          {selected ? (
            <SelectedBookingDetail booking={selected} onCheckedIn={() => { refetch(); }} />
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

function Stat({ label, value, fg }) {
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 800, color: "var(--ink-500)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
        {label}
      </div>
      <div
        className="display-num"
        style={{
          fontFamily: "var(--font-display, inherit)",
          fontSize: 26,
          fontWeight: 800,
          color: fg || "var(--ink-900)",
          marginTop: 2,
        }}
      >
        {value}
      </div>
    </div>
  );
}

function BookingRow({ b, isSelected, onClick }) {
  const tone = b._waiverComplete ? "success" : "danger";
  const waiverLabel = b._waiverComplete
    ? "Ready"
    : `${b.totalGuests - (b.signedWaivers || 0)} waiver${b.totalGuests - (b.signedWaivers || 0) === 1 ? "" : "s"} missing`;

  return (
    <div
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 14,
        padding: "14px 16px",
        marginBottom: 10,
        background: isSelected ? "var(--aero-orange-50)" : "#fff",
        border: isSelected ? "2px solid var(--aero-orange-500)" : "1.5px solid var(--ink-200)",
        borderRadius: 14,
        cursor: "pointer",
      }}
    >
      <div
        style={{
          fontFamily: "var(--font-mono)",
          fontWeight: 700,
          fontSize: 13,
          color: b._isLate ? "var(--color-danger)" : b._isUpcoming ? "var(--aero-orange-600)" : "var(--ink-700)",
          minWidth: 56,
        }}
      >
        {fmtTime(b.timeRange)}
      </div>
      <div style={{ flex: 1, lineHeight: 1.3, minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 15, color: "var(--ink-900)" }}>
          {b.bookingName || "Walk-in"}
        </div>
        <div style={{ fontSize: 12, color: "var(--ink-500)", marginTop: 2 }}>
          {b.bookingNumber} · {b.totalGuests || 0} pax · {b.productName || "—"}
        </div>
      </div>
      <StatusPill tone={tone}>{waiverLabel}</StatusPill>
      {!b._isPaid && <StatusPill tone="danger">Unpaid</StatusPill>}
      <Icon name="chevron-right" size={20} style={{ color: "var(--ink-400)" }} />
    </div>
  );
}

function EmptyDetail() {
  return (
    <div style={{ padding: 24, textAlign: "center", color: "var(--ink-500)" }}>
      <Icon name="user-round" size={42} style={{ color: "var(--ink-200)", marginBottom: 12 }} />
      <div style={{ fontWeight: 700, color: "var(--ink-700)", marginBottom: 4 }}>Select a reservation</div>
      <div style={{ fontSize: 13 }}>Tap a row on the left to see details, waiver status, and check the party in.</div>
    </div>
  );
}

function SelectedBookingDetail({ booking, onCheckedIn }) {
  const { data: ticketsData, isLoading: ticketsLoading, refetch: refetchTickets } =
    useGetBookingTicketsQuery(booking.bookingMasterId, { skip: !booking.bookingMasterId });
  const [checkInAll, { isLoading: checkingIn }] = useCheckInAllTicketsMutation();

  const tickets = ticketsData?.data || [];
  const summary = ticketsData?.summary || {};
  const issuedRemaining = summary.issued ?? 0;

  const handleCheckIn = async () => {
    if (!booking?.bookingMasterId) return;
    const promise = checkInAll({ bookingMasterId: booking.bookingMasterId, gateOrZone: "Cashier check-in" }).unwrap();
    toast.promise(promise, {
      loading: "Checking in…",
      success: (res) => {
        refetchTickets();
        onCheckedIn?.();
        return res?.succeeded > 0
          ? `Checked in ${res.succeeded} of ${res.attempted}`
          : "Nothing to check in (already redeemed)";
      },
      error: (err) => err?.data?.error || "Check-in failed",
    });
  };

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--aero-orange-600)", fontWeight: 700, letterSpacing: "0.05em" }}>
          {booking.bookingNumber}
        </div>
        <div style={{ fontFamily: "var(--font-display, inherit)", fontSize: 22, fontWeight: 800, color: "var(--ink-900)", letterSpacing: "-0.02em", marginTop: 2 }}>
          {booking.bookingName || "Walk-in"}
        </div>
        <div style={{ fontSize: 13, color: "var(--ink-500)", marginTop: 4 }}>
          {booking.productName} · {booking.totalGuests || 0} pax · {booking.timeRange || "—"}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 16 }}>
        <MiniStat label="Issued" value={summary.issued ?? 0} tone="warning" />
        <MiniStat label="Redeemed" value={summary.redeemed ?? 0} tone="success" />
      </div>

      {!booking._waiverComplete && (
        <div
          style={{
            padding: "10px 12px",
            background: "var(--color-warning-soft)",
            border: "1.5px solid var(--color-warning)",
            borderRadius: 10,
            fontSize: 12,
            color: "#8B6100",
            marginBottom: 12,
            fontWeight: 600,
          }}
        >
          ⚠ {booking.totalGuests - (booking.signedWaivers || 0)} waiver{booking.totalGuests - (booking.signedWaivers || 0) === 1 ? "" : "s"} missing
        </div>
      )}

      <button
        type="button"
        onClick={handleCheckIn}
        disabled={checkingIn || issuedRemaining === 0}
        className="a-btn a-btn--primary"
        style={{ width: "100%", justifyContent: "center" }}
      >
        <Icon name="check" size={16} stroke={3} />
        {issuedRemaining === 0 ? "All checked in" : `Check in ${issuedRemaining} ticket${issuedRemaining === 1 ? "" : "s"}`}
      </button>

      {/* Tickets list */}
      <div style={{ marginTop: 18 }}>
        <div className="eyebrow" style={{ marginBottom: 8 }}>Tickets</div>
        {ticketsLoading ? (
          <div style={{ fontSize: 13, color: "var(--ink-500)" }}>Loading tickets…</div>
        ) : tickets.length === 0 ? (
          <div style={{ fontSize: 13, color: "var(--ink-500)" }}>No tickets minted for this booking.</div>
        ) : (
          <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 6 }}>
            {tickets.slice(0, 12).map((t) => (
              <li
                key={t.ticketId}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 8,
                  padding: "8px 10px",
                  borderRadius: 8,
                  background: t.status === "redeemed" ? "var(--color-success-soft)" : "var(--ink-25)",
                  border: "1px solid var(--ink-100)",
                  fontSize: 12,
                }}
              >
                <span style={{ fontFamily: "var(--font-mono)", fontWeight: 700, color: "var(--aero-orange-600)" }}>
                  {t.ticketCode}
                </span>
                <span
                  style={{
                    fontWeight: 700,
                    fontSize: 10,
                    padding: "2px 7px",
                    borderRadius: 999,
                    background: t.status === "redeemed" ? "var(--color-success)" : "var(--color-warning)",
                    color: "white",
                    textTransform: "uppercase",
                  }}
                >
                  {t.status}
                </span>
              </li>
            ))}
            {tickets.length > 12 && (
              <li style={{ fontSize: 11, color: "var(--ink-500)", padding: "6px 10px" }}>
                +{tickets.length - 12} more
              </li>
            )}
          </ul>
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
