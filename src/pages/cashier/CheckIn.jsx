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
  useUpsertParticipantsMutation,
} from "../../features/bookings/bookingApi";
import {
  useGetBookingTicketsQuery,
  useCheckInAllTicketsMutation,
  useRedeemTicketMutation,
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
        <aside style={{ width: 720, overflowY: "auto", padding: "16px 22px", background: "var(--ink-25)" }}>
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
  // Tickets are the source of truth — one row per redeemable line.
  const { data: ticketsData, isLoading: ticketsLoading, refetch: refetchTickets } =
    useGetBookingTicketsQuery(booking.bookingId, { skip: !booking.bookingId });
  const { refetch: refetchStatus } = useGetCheckInStatusQuery(booking.bookingId, { skip: !booking.bookingId });
  const [redeemTicket, { isLoading: redeeming }] = useRedeemTicketMutation();
  const [checkInAll, { isLoading: checkingInAll }] = useCheckInAllTicketsMutation();
  const [selectedCodes, setSelectedCodes] = useState(new Set());
  const [hideCheckedIn, setHideCheckedIn] = useState(false);

  const tickets = ticketsData?.data || [];
  const summary = ticketsData?.summary || {};
  const redeemedCount = (summary.redeemed ?? 0);
  const totalCount = summary.total ?? tickets.length;
  const remaining = Math.max(0, totalCount - redeemedCount);

  const visibleTickets = useMemo(
    () => (hideCheckedIn ? tickets.filter((t) => t.status !== "redeemed") : tickets),
    [tickets, hideCheckedIn]
  );

  const allSelectableCodes = useMemo(
    () => visibleTickets.filter((t) => t.status === "issued").map((t) => t.ticketCode),
    [visibleTickets]
  );
  const allSelected = allSelectableCodes.length > 0 && allSelectableCodes.every((c) => selectedCodes.has(c));

  const toggleSelect = (code) => {
    setSelectedCodes((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code); else next.add(code);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (allSelected) setSelectedCodes(new Set());
    else setSelectedCodes(new Set(allSelectableCodes));
  };

  const refresh = () => { refetchTickets(); refetchStatus(); onCheckedIn?.(); };

  const handleRedeemOne = async (code) => {
    const terminal = getTerminal();
    const promise = redeemTicket({
      ticketCode: code,
      terminalDeviceId: terminal?.deviceId || null,
      gateOrZone: terminal?.deviceName || "Cashier check-in",
    }).unwrap();
    toast.promise(promise, {
      loading: "Redeeming…",
      success: () => { refresh(); return "Redeemed"; },
      error: (err) => err?.data?.error || err?.data?.reason || "Redeem failed",
    });
  };

  const handleRedeemSelected = async () => {
    if (selectedCodes.size === 0) return;
    const terminal = getTerminal();
    const codes = [...selectedCodes];
    let ok = 0; let fail = 0;
    for (const code of codes) {
      try {
        await redeemTicket({
          ticketCode: code,
          terminalDeviceId: terminal?.deviceId || null,
          gateOrZone: terminal?.deviceName || "Cashier check-in",
        }).unwrap();
        ok++;
      } catch { fail++; }
    }
    setSelectedCodes(new Set());
    refresh();
    toast.success(`Redeemed ${ok}${fail ? ` · ${fail} failed` : ""}`);
  };

  const handleRedeemAll = async () => {
    const terminal = getTerminal();
    const promise = checkInAll({
      bookingId: booking.bookingId,
      terminalDeviceId: terminal?.deviceId || null,
      gateOrZone: terminal?.deviceName || "Cashier check-in",
    }).unwrap();
    toast.promise(promise, {
      loading: "Redeeming all…",
      success: (res) => { refresh(); return `Redeemed ${res?.succeeded ?? 0} of ${res?.attempted ?? 0}`; },
      error: (err) => err?.data?.error || "Redeem failed",
    });
  };

  return (
    <div>
      {/* Booking header */}
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--aero-orange-600)", fontWeight: 700, letterSpacing: "0.05em" }}>
          {booking.bookingNumber}
        </div>
        <div style={{ fontFamily: "var(--font-display, inherit)", fontSize: 22, fontWeight: 800, color: "var(--ink-900)", letterSpacing: "-0.02em", marginTop: 2 }}>
          {booking.bookingName || "Walk-in"}
        </div>
        <div style={{ fontSize: 13, color: "var(--ink-500)", marginTop: 4 }}>
          {booking.activityName} · {booking.totalGuests || totalCount} pax · {booking.timeRange || "—"}
        </div>
      </div>

      {/* Toolbar — ROLLER-style: select all + hide checked-in + batch redeem */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        gap: 12, marginBottom: 10, padding: "10px 12px",
        background: "white", border: "1.5px solid var(--ink-200)", borderRadius: 12,
      }}>
        <label style={{ display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: 12, fontWeight: 600, color: "var(--ink-700)" }}>
          <input type="checkbox" checked={allSelected} onChange={toggleSelectAll} />
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
          onClick={selectedCodes.size > 0 ? handleRedeemSelected : handleRedeemAll}
          disabled={(selectedCodes.size === 0 && remaining === 0) || redeeming || checkingInAll}
          className="a-btn a-btn--primary a-btn--sm"
          style={{ minWidth: 110, justifyContent: "center" }}
        >
          <Icon name="check" size={13} stroke={3} />
          {selectedCodes.size > 0 ? `Redeem (${selectedCodes.size})` : `All (${remaining})`}
        </button>
      </div>

      {/* Ticket list — ROLLER-style flat rows with per-row redeem */}
      {ticketsLoading ? (
        <div style={{ fontSize: 13, color: "var(--ink-500)", padding: 12 }}>Loading tickets…</div>
      ) : visibleTickets.length === 0 ? (
        <div style={{ fontSize: 13, color: "var(--ink-500)", padding: 16, textAlign: "center", background: "white", borderRadius: 10 }}>
          {tickets.length === 0 ? "No tickets minted for this booking yet." : "All tickets redeemed."}
        </div>
      ) : (
        <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 6 }}>
          {visibleTickets.map((t, i) => {
            const isRedeemed = t.status === "redeemed" || t.status === "partially_redeemed";
            const isSelected = selectedCodes.has(t.ticketCode);
            const time = t.validFrom
              ? new Date(t.validFrom).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
              : null;
            const dur = (t.validFrom && t.validUntil)
              ? Math.round((new Date(t.validUntil) - new Date(t.validFrom)) / (1000 * 60 * 60))
              : null;
            return (
              <li
                key={t.ticketId}
                style={{
                  display: "flex", alignItems: "center", gap: 10,
                  padding: "10px 12px", borderRadius: 10,
                  background: isRedeemed ? "var(--ink-50)" : "white",
                  border: isSelected ? "2px solid var(--aero-orange-500)" : "1.5px solid var(--ink-200)",
                  opacity: isRedeemed ? 0.7 : 1,
                }}
              >
                <input
                  type="checkbox"
                  checked={isSelected}
                  disabled={isRedeemed}
                  onChange={() => toggleSelect(t.ticketCode)}
                  style={{ width: 16, height: 16, cursor: isRedeemed ? "not-allowed" : "pointer", flexShrink: 0 }}
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
                    {t.product?.name || t.activity?.name || activityNameFromBooking(booking)}
                    {t.variation?.name && <span style={{ marginLeft: 6, fontWeight: 600, color: "var(--ink-600)" }}>· {t.variation.name}</span>}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--ink-500)", display: "flex", gap: 8, marginTop: 2 }}>
                    <span style={{ fontFamily: "var(--font-mono)", fontWeight: 700, color: "var(--aero-orange-600)" }}>
                      {t.ticketCode}
                    </span>
                    {t.participant?.displayName && <span>· {t.participant.displayName}</span>}
                    {time && <span>· {time}{dur ? ` (${dur}h)` : ""}</span>}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => !isRedeemed && handleRedeemOne(t.ticketCode)}
                  disabled={isRedeemed || redeeming}
                  title={isRedeemed ? "Already redeemed" : "Redeem this ticket"}
                  style={{
                    width: 36, height: 36, flexShrink: 0,
                    borderRadius: 8, border: "1.5px solid",
                    borderColor: isRedeemed ? "var(--color-success)" : "var(--ink-200)",
                    background: isRedeemed ? "var(--color-success)" : "white",
                    color: isRedeemed ? "white" : "var(--ink-700)",
                    cursor: isRedeemed ? "default" : "pointer",
                    display: "flex", alignItems: "center", justifyContent: "center",
                  }}
                >
                  <Icon name="check" size={16} stroke={3} />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {/* Inline name-entry form when this booking has no named participants
          but we still want to attach names to tickets. */}
      {!ticketsLoading && tickets.length === 0 && (
        <NameGuestsForm
          bookingId={booking.bookingId}
          totalGuests={booking.totalGuests || 0}
          onSaved={refresh}
        />
      )}
    </div>
  );
}

function activityNameFromBooking(b) {
  return b?.activityName || "Item";
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
function NameGuestsForm({ bookingId, totalGuests, onSaved }) {
  const [names, setNames] = useState(() =>
    Array.from({ length: Math.max(1, Number(totalGuests) || 1) }, () => ({ displayName: "", isMinor: false }))
  );
  const [upsert, { isLoading }] = useUpsertParticipantsMutation();

  const updateName = (idx, patch) =>
    setNames((prev) => prev.map((n, i) => (i === idx ? { ...n, ...patch } : n)));

  const handleSave = async () => {
    const filled = names.filter((n) => n.displayName.trim().length > 0);
    if (filled.length === 0) {
      toast.error("Type at least one guest name");
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
