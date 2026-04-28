// CheckIn — cashier check-in screen.
// Lists today's confirmed bookings, lets the cashier search by
// name/email/phone/booking number, and one-tap-checks-in the whole
// party via the checkInAllTickets endpoint (which iterates the booking's
// pending tickets, mints redemption events, and respects waiver/expiry
// rules — the exact same path the Redeem screen takes).

import React, { useMemo, useState } from "react";
import { toast } from "sonner";
import { Icon } from "./Icon";
import { StatusPill } from "./StatusPill";
import {
  useGetAllBookingQuery,
  useGetCheckInStatusQuery,
  useCheckInParticipantsMutation,
  useUndoParticipantCheckInMutation,
} from "../../features/bookings/bookingApi";
import {
  useGetBookingTicketsQuery,
  useCheckInAllTicketsMutation,
} from "../../features/tickets/ticketApi";
import { useDebounceSearch } from "../../hooks/useDebounceSearch";
import { getTerminal } from "../../lib/terminal";

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
    activityId: [],
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
              No bookings match.
            </div>
          ) : (
            partition.map((b) => (
              <BookingRow
                key={b.bookingId}
                b={b}
                isSelected={selected?.bookingId === b.bookingId}
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
          {b.bookingNumber} · {b.totalGuests || 0} pax · {b.activityName || "—"}
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
      <div style={{ fontWeight: 700, color: "var(--ink-700)", marginBottom: 4 }}>Select a booking</div>
      <div style={{ fontSize: 13 }}>Tap a row on the left to see details, waiver status, and check the party in.</div>
    </div>
  );
}

function SelectedBookingDetail({ booking, onCheckedIn }) {
  const { data: status, isLoading: statusLoading, refetch: refetchStatus } =
    useGetCheckInStatusQuery(booking.bookingId, { skip: !booking.bookingId });
  const [checkInBatch, { isLoading: batchPosting }] = useCheckInParticipantsMutation();
  const [undoCheckIn, { isLoading: undoing }] = useUndoParticipantCheckInMutation();
  const [checkInAll, { isLoading: checkingInAll }] = useCheckInAllTicketsMutation();
  const [selectedIds, setSelectedIds] = useState(new Set());

  const participants = status?.data?.participants || [];
  const checkedInCount = participants.filter((p) => !!p.checkedInAt).length;
  const totalCount = participants.length || (booking.totalGuests || 0);
  const remaining = Math.max(0, totalCount - checkedInCount);

  const toggleSelect = (id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleCheckInSelected = async () => {
    if (selectedIds.size === 0) return;
    const promise = checkInBatch({
      bookingId: booking.bookingId,
      participantIds: [...selectedIds],
    }).unwrap();
    toast.promise(promise, {
      loading: `Checking in ${selectedIds.size}…`,
      success: (res) => {
        setSelectedIds(new Set());
        refetchStatus();
        onCheckedIn?.();
        const n = res?.data?.updated?.length ?? selectedIds.size;
        return `Checked in ${n} guest${n === 1 ? "" : "s"}`;
      },
      error: (err) => err?.data?.error || "Check-in failed",
    });
  };

  const handleCheckInAll = async () => {
    const terminal = getTerminal();
    const promise = checkInAll({
      bookingId: booking.bookingId,
      terminalDeviceId: terminal?.deviceId || null,
      gateOrZone: terminal?.deviceName || "Cashier check-in",
    }).unwrap();
    toast.promise(promise, {
      loading: "Checking in everyone…",
      success: (res) => {
        refetchStatus();
        onCheckedIn?.();
        return res?.succeeded > 0
          ? `Checked in ${res.succeeded} of ${res.attempted}`
          : "Nothing to check in";
      },
      error: (err) => err?.data?.error || "Check-in failed",
    });
  };

  const handleUndo = async (participantId) => {
    const promise = undoCheckIn({ bookingId: booking.bookingId, participantId }).unwrap();
    toast.promise(promise, {
      loading: "Undoing…",
      success: () => { refetchStatus(); onCheckedIn?.(); return "Check-in reversed"; },
      error: (err) => err?.data?.error || "Undo failed",
    });
  };

  return (
    <div>
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--aero-orange-600)", fontWeight: 700, letterSpacing: "0.05em" }}>
          {booking.bookingNumber}
        </div>
        <div style={{ fontFamily: "var(--font-display, inherit)", fontSize: 22, fontWeight: 800, color: "var(--ink-900)", letterSpacing: "-0.02em", marginTop: 2 }}>
          {booking.bookingName || "Walk-in"}
        </div>
        <div style={{ fontSize: 13, color: "var(--ink-500)", marginTop: 4 }}>
          {booking.activityName} · {totalCount} pax · {booking.timeRange || "—"}
        </div>
      </div>

      {/* Roster headline + bulk actions */}
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        marginBottom: 10,
      }}>
        <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: "0.04em", textTransform: "uppercase", color: "var(--ink-700)" }}>
          Roster · {checkedInCount}/{totalCount}
        </div>
        {remaining > 0 && (
          <button
            type="button"
            onClick={handleCheckInAll}
            disabled={checkingInAll}
            className="a-btn a-btn--ghost a-btn--sm"
            title="Check in every remaining guest"
          >
            <Icon name="check-check" size={13} /> All
          </button>
        )}
      </div>

      {/* Roster list */}
      {statusLoading ? (
        <div style={{ fontSize: 13, color: "var(--ink-500)", padding: 12 }}>Loading roster…</div>
      ) : participants.length === 0 ? (
        <div style={{
          fontSize: 12, color: "var(--ink-500)",
          padding: 14, background: "var(--ink-25)", borderRadius: 10, lineHeight: 1.5,
        }}>
          No named participants on this booking yet. Use <strong>"All"</strong> above to check in
          all anonymous tickets, or have the guest sign a waiver to populate the roster.
        </div>
      ) : (
        <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 6 }}>
          {participants.map((p) => {
            const checkedIn = !!p.checkedInAt;
            const isSelected = selectedIds.has(p.bookingParticipantId);
            return (
              <li
                key={p.bookingParticipantId}
                onClick={() => !checkedIn && toggleSelect(p.bookingParticipantId)}
                style={{
                  display: "flex", alignItems: "center", gap: 10,
                  padding: "10px 12px", borderRadius: 10,
                  cursor: checkedIn ? "default" : "pointer",
                  background: checkedIn ? "var(--color-success-soft)"
                            : isSelected ? "var(--aero-orange-50)" : "#fff",
                  border: checkedIn ? "1.5px solid var(--color-success)"
                        : isSelected ? "2px solid var(--aero-orange-500)" : "1.5px solid var(--ink-200)",
                }}
              >
                <div
                  style={{
                    width: 24, height: 24, borderRadius: 6, flexShrink: 0,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    background: checkedIn ? "var(--color-success)" : isSelected ? "var(--aero-orange-500)" : "var(--ink-100)",
                    color: "#fff",
                  }}
                >
                  {checkedIn ? <Icon name="check" size={14} stroke={3} />
                   : isSelected ? <Icon name="check" size={14} stroke={3} />
                   : null}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 13, color: "var(--ink-900)" }}>
                    {p.displayName || `Guest ${p.bookingParticipantId}`}
                    {p.isMinor && <span style={{ marginLeft: 6, fontSize: 10, color: "var(--ink-500)", fontWeight: 600 }}>(minor)</span>}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--ink-500)" }}>
                    {checkedIn
                      ? `Checked in ${new Date(p.checkedInAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`
                      : p.waiverStatus === "valid"
                      ? "Waiver valid"
                      : <span style={{ color: "var(--color-danger)" }}>Waiver missing</span>}
                  </div>
                </div>
                {checkedIn && (
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); handleUndo(p.bookingParticipantId); }}
                    disabled={undoing}
                    style={{
                      all: "unset", cursor: "pointer",
                      fontSize: 11, fontWeight: 700,
                      color: "var(--ink-500)",
                      padding: "4px 8px", borderRadius: 6,
                    }}
                    title="Undo check-in"
                  >
                    Undo
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {/* Sticky-ish action bar for batch */}
      {selectedIds.size > 0 && (
        <button
          type="button"
          onClick={handleCheckInSelected}
          disabled={batchPosting}
          className="a-btn a-btn--primary"
          style={{ width: "100%", justifyContent: "center", marginTop: 14 }}
        >
          <Icon name="check" size={16} stroke={3} />
          Check in {selectedIds.size} selected
        </button>
      )}
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
