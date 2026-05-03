// CheckIn — cashier check-in screen.
// Lists today's confirmed bookings, lets the cashier search by
// name/email/phone/booking number, and one-tap-checks-in the whole
// party via the checkInAllTickets endpoint (which iterates the booking's
// pending tickets, mints redemption events, and respects waiver/expiry
// rules — the exact same path the Redeem screen takes).

import React, { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Icon } from "./Icon";
import { StatusPill } from "./StatusPill";
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
} from "../../features/bookings/bookingApi";
import {
  useGetBookingTicketsQuery,
  useCheckInAllTicketsMutation,
  useRedeemTicketMutation,
  useBindTicketHolderMutation,
} from "../../features/tickets/ticketApi";
import { useLazyValidateDiscountCodeQuery } from "../../features/discount/discountApi";
import ManagerOverridePrompt from "../../components/ManagerOverridePrompt";
import { useDebounceSearch } from "../../hooks/useDebounceSearch";
import { getTerminal } from "../../lib/terminal";
import { adminBookingDetailUrl } from "../../lib/adminLink";

const localIsoDate = (date = new Date()) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};
const today = localIsoDate();
const moneyFmt = (value) => `$${(Number(value) || 0).toFixed(2)}`;
const roundMoney = (value) => Number((Number(value) || 0).toFixed(2));

const fmtTime = (range) => (range || "").split(/[–-]/)[0].trim() || "—";

function triggerCashDrawer({ bookingId, terminal }) {
  const payload = {
    bookingId,
    terminalDeviceId: terminal?.deviceId || null,
    terminalName: terminal?.deviceName || terminal?.name || null,
    openedAt: new Date().toISOString(),
  };
  window.dispatchEvent(new CustomEvent("cashier:open-cash-drawer", { detail: payload }));
  try {
    localStorage.setItem("cashier:lastDrawerOpen", JSON.stringify(payload));
  } catch {
    // best effort only
  }
}

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
  const [recordPayment, { isLoading: recordingPayment }] = useRecordPaymentMutation();
  const [sendBookingConfirmation, { isLoading: sendingReceipt }] = useSendBookingConfirmationMutation();

  const tickets = ticketsData?.data || [];
  const summary = ticketsData?.summary || {};
  const redeemedCount = (summary.redeemed ?? 0);
  const totalCount = summary.total ?? tickets.length;
  const remaining = Math.max(0, totalCount - redeemedCount);
  const balanceDue = Math.max(0, Number(booking.balance || 0));
  const isFullyCheckedIn = totalCount > 0 && redeemedCount >= totalCount;
  const canTakePayment = isFullyCheckedIn && balanceDue > 0;
  const [waiverModalOpen, setWaiverModalOpen] = useState(false);
  const [removeParticipant] = useRemoveParticipantMutation();

  const refresh = () => {
    refetchTickets();
    refetchStatus();
    onCheckedIn?.();
  };

  useEffect(() => {
    if (!editorOpen) return undefined;

    const handleMessage = (event) => {
      if (event?.data?.type !== "movira:booking-editor-close") return;
      setEditorOpen(false);
      refresh();
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [editorOpen]);

  // Booking-wide pool of waiver-eligible holders. The candidate set per
  // ticket is this pool minus participants already bound to other tickets.
  const allParticipants = checkInData?.data?.participants || [];

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

  const handleBind = async (ticketCode, participantId) => {
    const promise = bindHolder({
      ticketCode,
      participantId,
      bookingId: booking.bookingId,
    }).unwrap();
    toast.promise(promise, {
      loading: "Linking holder…",
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

  const allSelectableCodes = useMemo(
    () => visibleTickets
      .filter((t) => t.status === "issued")
      // Exclude tickets blocked by missing waiver — server would reject these
      .filter((t) => !(t.requiresWaiver && !t.participantId))
      .map((t) => t.ticketCode),
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
    const terminal = getTerminal();
    const promise = redeemTicket({
      ticketCode: code,
      terminalDeviceId: terminal?.deviceId || null,
      gateOrZone: terminal?.deviceName || "Cashier check-in",
      allowEarlyCheckIn: true,
    }).unwrap();
    toast.promise(promise, {
      loading: "Redeeming…",
      success: () => { refresh(); return "Redeemed"; },
      error: (err) => err?.data?.error || err?.data?.reason || "Redeem failed",
    });
  };

  // Tickets whose product requires a waiver but no participant is bound.
  // These are blocked at redeem time both server-side (returns
  // requires_waiver) and here in the UI (button disabled). The cashier
  // must use HolderPicker / "Add from waiver" before they can check in.
  const waiverBlocked = useMemo(
    () => tickets.filter(
      (t) =>
        t.requiresWaiver &&
        !t.participantId &&
        t.status !== "redeemed" &&
        t.status !== "partially_redeemed"
    ),
    [tickets]
  );

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
          allowEarlyCheckIn: true,
        }).unwrap();
        ok++;
      } catch { fail++; }
    }
    setSelectedCodes(new Set());
    refresh();
    toast.success(`Redeemed ${ok}${fail ? ` · ${fail} failed` : ""}`);
  };

  const handleRedeemAll = async () => {
    if (waiverBlocked.length > 0) {
      // Soft-warn (server still enforces). Bulk endpoint already skips these,
      // so this is purely so the cashier knows what won't get checked in.
      toast.warning(
        `${waiverBlocked.length} ticket${waiverBlocked.length === 1 ? "" : "s"} need a waiver — link guests first or use "Add from waiver"`
      );
    }
    const terminal = getTerminal();
    const promise = checkInAll({
      bookingId: booking.bookingId,
      terminalDeviceId: terminal?.deviceId || null,
      gateOrZone: terminal?.deviceName || "Cashier check-in",
      allowEarlyCheckIn: true,
    }).unwrap();
    toast.promise(promise, {
      loading: "Redeeming all…",
      success: (res) => {
        refresh();
        const succ = res?.succeeded ?? 0;
        const att = res?.attempted ?? 0;
        const blocked = (res?.results || []).filter((r) => r.reason === "requires_waiver").length;
        const tail = blocked > 0 ? ` · ${blocked} blocked by waiver` : "";
        return `Redeemed ${succ} of ${att}${tail}`;
      },
      error: (err) => err?.data?.error || "Redeem failed",
    });
  };

  const openPayment = () => {
    setPaymentAmount(balanceDue.toFixed(2));
    setPaymentMethod("card");
    setPaymentNote("");
    setPaymentDiscount(null);
    setPaymentComplete(null);
    setPaymentOpen(true);
  };

  const handleRecordPayment = async () => {
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

    const recordAmount = paymentMethod === "cash" ? payableBalance : tenderedAmount;
    const changeDue = paymentMethod === "cash"
      ? Math.max(0, Number((tenderedAmount - payableBalance).toFixed(2)))
      : 0;
    const terminal = getTerminal();
    const cashRemark = paymentMethod === "cash"
      ? `Cash tendered ${moneyFmt(tenderedAmount)}; change due ${moneyFmt(changeDue)}.`
      : "";

    try {
      let discountRes = null;
      if (discountAmount > 0) {
        discountRes = await recordPayment({
          bookingId: booking.bookingId,
          amountPaid: discountAmount,
          paymentMethod: "complimentary",
          terminalDeviceId: terminal?.deviceId || null,
          remarks: [
            `POS discount applied: ${paymentDiscount?.label || "Discount"}`,
            paymentDiscount?.code ? `Code ${paymentDiscount.code}.` : "",
            paymentDiscount?.managerName ? `Approved by ${paymentDiscount.managerName}.` : "",
          ].filter(Boolean).join(" "),
        }).unwrap();
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
          remarks: [paymentNote || "Payment recorded at POS check-in", cashRemark].filter(Boolean).join(" "),
        }).unwrap();
      }
      if (paymentMethod === "cash" && recordAmount > 0) {
        triggerCashDrawer({ bookingId: booking.bookingId, terminal });
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
      toast.error(err?.data?.message || err?.data?.error || "Could not record payment");
    }
  };

  const handlePrintReceipt = () => {
    window.print();
  };

  const handleEmailReceipt = async () => {
    if (!booking?.bookingId) return;
    const promise = sendBookingConfirmation({ bookingId: booking.bookingId }).unwrap();
    toast.promise(promise, {
      loading: "Sending receipt...",
      success: "Receipt emailed",
      error: (err) => err?.data?.message || err?.data?.error || "Could not email receipt",
    });
  };

  return (
    <div>
      {/* Booking header */}
      <div style={{ marginBottom: 14, display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
        <div style={{ minWidth: 0 }}>
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
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
        gap: 8,
        marginBottom: 10,
      }}>
        <CloseoutPill label="Waivers" value="Ready" tone="success" />
        <CloseoutPill
          label="Check-in"
          value={`${redeemedCount}/${totalCount}`}
          tone={isFullyCheckedIn ? "success" : "warning"}
        />
        <CloseoutPill
          label="Payment"
          value={balanceDue > 0 ? `${moneyFmt(balanceDue)} due` : "Paid"}
          tone={balanceDue > 0 ? "danger" : "success"}
        />
      </div>

      <CheckInSettlementPanel
        balanceDue={balanceDue}
        isFullyCheckedIn={isFullyCheckedIn}
        redeemedCount={redeemedCount}
        totalCount={totalCount}
        onTakePayment={openPayment}
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
          onPrintReceipt={handlePrintReceipt}
          onEmailReceipt={handleEmailReceipt}
          isSendingReceipt={sendingReceipt}
          onClose={() => { setPaymentOpen(false); setPaymentComplete(null); refresh(); }}
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
                Edit {booking.bookingNumber}
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
              title={`Edit booking ${booking.bookingNumber}`}
              src={adminBookingDetailUrl(booking.bookingId, "embedded=1&returnTo=pos-checkin")}
              style={{ width: "100%", flex: 1, minHeight: 0, border: 0, background: "var(--ink-25, #FAF7EE)" }}
            />
          </div>
        </div>
      )}

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
          disabled={(selectedCodes.size === 0 && remaining === 0) || redeeming || checkingInAll}
          className="a-btn a-btn--primary a-btn--sm"
          style={{ minWidth: 110, justifyContent: "center" }}
        >
          <Icon name="check" size={13} stroke={3} />
          {selectedCodes.size > 0 ? `Redeem (${selectedCodes.size})` : `All (${remaining})`}
        </button>
      </div>

      {waiverModalOpen && (
        <WaiverLookupModal
          bookingId={booking.bookingId}
          onClose={() => setWaiverModalOpen(false)}
          onLinked={() => { refresh(); }}
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
            const isRedeemed = t.status === "redeemed" || t.status === "partially_redeemed";
            const isSelected = selectedCodes.has(t.ticketCode);
            // Block redemption when the product requires a waiver but no
            // waiver-bound participant is linked yet. Cashier must use the
            // HolderPicker / "Add from waiver" flow first.
            const needsWaiver = !!t.requiresWaiver && !t.participantId && !isRedeemed;
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
                  disabled={isRedeemed || needsWaiver}
                  onChange={() => toggleSelect(t.ticketCode)}
                  title={needsWaiver ? "Waiver required — link a guest first" : undefined}
                  style={{
                    width: 16, height: 16,
                    cursor: (isRedeemed || needsWaiver) ? "not-allowed" : "pointer",
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
                    {t.product?.name || t.activity?.name || activityNameFromBooking(booking)}
                    {t.variation?.name && <span style={{ marginLeft: 6, fontWeight: 600, color: "var(--ink-600)" }}>· {t.variation.name}</span>}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--ink-500)", display: "flex", gap: 8, marginTop: 2, alignItems: "center", flexWrap: "wrap" }}>
                    <span style={{ fontFamily: "var(--font-mono)", fontWeight: 700, color: "var(--aero-orange-600)" }}>
                      {t.ticketCode}
                    </span>
                    {time && <span>· {time}{dur ? ` (${dur}h)` : ""}</span>}
                    {needsWaiver && (
                      <span style={{
                        display: "inline-flex", alignItems: "center", gap: 4,
                        padding: "2px 6px", borderRadius: 6,
                        background: "#FFF0EA", color: "#B83210",
                        border: "1px solid #FFB199",
                        fontWeight: 700, fontSize: 10,
                      }}>
                        <Icon name="alert-triangle" size={10} stroke={2.5} />
                        Waiver required
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
                      onSearch={() => setWaiverModalOpen(true)}
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
                  onClick={() => !isRedeemed && !needsWaiver && handleRedeemOne(t.ticketCode)}
                  disabled={isRedeemed || redeeming || needsWaiver}
                  title={
                    isRedeemed
                      ? "Already redeemed"
                      : needsWaiver
                        ? "Waiver required — link a guest first"
                        : "Redeem this ticket"
                  }
                  style={{
                    width: 36, height: 36, flexShrink: 0,
                    borderRadius: 8, border: "1.5px solid",
                    borderColor: isRedeemed ? "var(--color-success)" : needsWaiver ? "#FFB199" : "var(--ink-200)",
                    background: isRedeemed ? "var(--color-success)" : needsWaiver ? "#FFF0EA" : "white",
                    color: isRedeemed ? "white" : needsWaiver ? "#B83210" : "var(--ink-700)",
                    cursor: (isRedeemed || needsWaiver) ? "not-allowed" : "pointer",
                    display: "flex", alignItems: "center", justifyContent: "center",
                  }}
                >
                  <Icon name={needsWaiver ? "alert-triangle" : "check"} size={16} stroke={3} />
                </button>
              </li>
            );
          })}
        </ul>
      )}

    </div>
  );
}

function activityNameFromBooking(b) {
  return b?.activityName || "Item";
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
    <div style={{ background: c.bg, border: `1.5px solid ${c.border}`, borderRadius: 10, padding: "8px 10px", minWidth: 0 }}>
      <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--ink-500)" }}>
        {label}
      </div>
      <div style={{ marginTop: 3, fontSize: 13, fontWeight: 900, color: c.fg, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
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
  onTakePayment,
}) {
  const isPaid = balanceDue <= 0;
  const canTakePayment = isFullyCheckedIn && !isPaid;
  const panel = isPaid
    ? {
        icon: "check-circle-2",
        title: "Paid in full",
        body: "No balance remains for this booking.",
        bg: "#EAF8EF",
        border: "#8AD5A3",
        fg: "#137A35",
      }
    : canTakePayment
    ? {
        icon: "credit-card",
        title: "Ready to take payment",
        body: "All guests are checked in. Collect the remaining balance to finish arrival.",
        bg: "var(--aero-orange-50)",
        border: "var(--aero-orange-500)",
        fg: "var(--aero-orange-700)",
      }
    : {
        icon: "clock",
        title: "Payment after check-in",
        body: `${redeemedCount}/${totalCount} guests checked in. Finish check-in before collecting the balance.`,
        bg: "#FFF7E6",
        border: "#F3C96A",
        fg: "#8A5A00",
      };

  return (
    <div
      style={{
        marginBottom: 10,
        padding: 14,
        borderRadius: 14,
        border: `1.5px solid ${panel.border}`,
        background: panel.bg,
        color: panel.fg,
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        <Icon name={panel.icon} size={18} stroke={2.2} style={{ flex: "0 0 auto", marginTop: 1 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 900 }}>{panel.title}</div>
          <div style={{ marginTop: 4, fontSize: 12, lineHeight: 1.45, color: "var(--ink-700)" }}>
            {panel.body}
          </div>
        </div>
        {!isPaid && (
          <div style={{ textAlign: "right", flex: "0 0 auto" }}>
            <div style={{ fontSize: 10, fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.08em" }}>
              Due
            </div>
            <div style={{ marginTop: 2, fontSize: 18, fontWeight: 950, color: "var(--ink-900)" }}>
              {moneyFmt(balanceDue)}
            </div>
          </div>
        )}
      </div>

      {!isPaid && (
        <button
          type="button"
          className={canTakePayment ? "a-btn a-btn--primary" : "a-btn a-btn--secondary"}
          onClick={canTakePayment ? onTakePayment : undefined}
          disabled={!canTakePayment}
          style={{
            width: "100%",
            justifyContent: "center",
            marginTop: 12,
            minHeight: 42,
            fontSize: 14,
            opacity: canTakePayment ? 1 : 0.65,
            cursor: canTakePayment ? "pointer" : "not-allowed",
          }}
        >
          <Icon name="credit-card" size={16} />
          {canTakePayment ? `Take payment ${moneyFmt(balanceDue)}` : "Check in guests first"}
        </button>
      )}
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
  onPrintReceipt,
  onEmailReceipt,
  isSendingReceipt,
  onClose,
}) {
  const [couponCode, setCouponCode] = useState("");
  const [manualDiscount, setManualDiscount] = useState("");
  const [managerOpen, setManagerOpen] = useState(false);
  const [validateDiscountCode, { isFetching: validatingCoupon }] = useLazyValidateDiscountCodeQuery();
  const discountAmount = roundMoney(Math.min(Number(discount?.amount || 0), balanceDue));
  const payableBalance = roundMoney(Math.max(0, balanceDue - discountAmount));
  const tendered = Number(amount) || 0;
  const isCash = method === "cash";
  const recordAmount = isCash ? Math.min(payableBalance, tendered) : tendered;
  const remaining = Math.max(0, payableBalance - recordAmount);
  const changeDue = isCash ? Math.max(0, tendered - payableBalance) : 0;
  const taxAmount = Number(booking?.taxAmount ?? booking?.tax ?? 0) || 0;
  const subTotal = roundMoney(Math.max(0, Number(booking?.subTotal ?? booking?.subtotal ?? booking?.totalAmount ?? balanceDue) || 0));
  const existingDiscount = Number(booking?.discountAmount || 0) || 0;
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
    onAmountChange(nextMethod === "cash" ? "" : payableBalance.toFixed(2));
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
      const res = await validateDiscountCode(code).unwrap();
      const promo = res?.data || {};
      const rawValue = Number(promo.value || 0);
      const calculated = Number(promo.discountType) === 1
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
              {booking.bookingNumber}
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
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 16 }}>
              <button type="button" className="a-btn a-btn--secondary" onClick={onPrintReceipt} style={{ justifyContent: "center" }}>
                <Icon name="printer" size={15} /> Print
              </button>
              <button type="button" className="a-btn a-btn--secondary" onClick={onEmailReceipt} disabled={isSendingReceipt} style={{ justifyContent: "center" }}>
                <Icon name="mail" size={15} /> {isSendingReceipt ? "Sending..." : "Email"}
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
              <button type="button" className="a-btn a-btn--primary" onClick={onSubmit} disabled={isSubmitting} style={{ width: "100%", justifyContent: "center", minHeight: 52, marginTop: 8, fontSize: 16 }}>
                <Icon name="check" size={16} />
                {isSubmitting ? "Recording..." : "Complete The Order"}
              </button>
            </div>
          </div>
        )}
      </div>
      <ManagerOverridePrompt
        open={managerOpen}
        title="Approve manager discount"
        description={`Apply ${moneyFmt(Math.min(Number(manualDiscount), balanceDue))} discount to ${booking.bookingNumber}.`}
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
        {participant.displayName}
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
          {p.displayName}
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
  const [trigger, { data, isFetching }] = useLazySearchWaiversQuery();
  const [linkFromWaiver, { isLoading: linking }] = useLinkParticipantFromWaiverMutation();

  React.useEffect(() => {
    const t = setTimeout(() => {
      if (query.trim().length >= 2) trigger({ search: query.trim(), limit: 12 });
    }, 250);
    return () => clearTimeout(t);
  }, [query, trigger]);

  const results = React.useMemo(() => {
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
  }, [data]);

  const handlePick = async (sig) => {
    const waiverSignatureId = sig.signatureId ?? sig.id;
    const promise = linkFromWaiver({
      bookingId,
      waiverSignatureId,
      includeMinors: true,
    }).unwrap();
    toast.promise(promise, {
      loading: "Linking…",
      success: (res) => {
        onLinked?.();
        onClose();
        const n = res?.data?.created || 0;
        return n > 0 ? `Linked ${n} guest${n === 1 ? "" : "s"}` : "Already linked";
      },
      error: (err) => err?.data?.error || "Could not link",
    });
  };

  return (
    <div
      onClick={onClose}
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
            Find a waiver
          </h2>
          <button
            type="button"
            onClick={onClose}
            style={{ all: "unset", cursor: "pointer", color: "var(--ink-500)", padding: 4 }}
            title="Close"
          >
            <Icon name="x" size={18} />
          </button>
        </div>

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
