// BookingDetail — the "Find a booking" screen.
//
// 1. Top: search bar (name / phone / booking ID / ticket code)
// 2. Mid: when a booking is selected, two panels:
//      • Summary card (guest, session, balance, sales channel)
//      • Items list, grouped by Party / Tickets / Add-ons, each card
//        showing redemption + holder coverage chips. "Show codes ▸"
//        and the holder strip expand on demand.
// 3. Sticky footer: Charge / Tip / Reprint / More
//
// Pass 2 of ticket-holder feature: holder strip is read-only here. Bind
// / swap / send-waiver actions land in Pass 3.
import React, { useMemo, useState } from "react";
import { toast } from "sonner";
import { Icon } from "./Icon";
import {
  useGetBookingByIdQuery,
  useGetAllBookingQuery,
} from "../../features/bookings/bookingApi";
import { useGetBookingTicketsQuery } from "../../features/tickets/ticketApi";

// ── Status helpers ────────────────────────────────────────────────
const moneyFmt = (n) => `$${Number(n || 0).toFixed(2)}`;
const sinceLabel = (iso) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
};
const timeOnly = (iso) => {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
};

// Visual chips for status counts
function CountChip({ done, total, labelDone, labelPartial = labelDone, labelNone = labelDone }) {
  const tone = total === 0 ? "muted" : done >= total ? "success" : done > 0 ? "warning" : "muted";
  const colors = {
    success: { bg: "var(--color-success-soft, #DCFCE7)", fg: "var(--color-success, #16A34A)" },
    warning: { bg: "var(--aero-yellow-50, #FFF7DC)", fg: "var(--aero-yellow-700, #A16207)" },
    muted:   { bg: "var(--ink-100, #E5E7EB)", fg: "var(--ink-600, #6B7280)" },
  }[tone];
  const label = done === 0 ? labelNone : done >= total ? labelDone : labelPartial;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 6,
      padding: "3px 10px", borderRadius: 999,
      background: colors.bg, color: colors.fg,
      fontSize: 11, fontWeight: 700,
    }}>
      <span style={{ fontFamily: "var(--font-mono)" }}>{done}/{total}</span>
      {label}
    </span>
  );
}

// ── Entry: search bar + result picker ─────────────────────────────
function SearchBar({ onPick }) {
  const [q, setQ] = useState("");
  const trimmed = q.trim();
  const { data, isFetching } = useGetAllBookingQuery(
    { search: trimmed, limit: 8, page: 1 },
    { skip: trimmed.length < 2 }
  );
  const results = data?.data || [];

  return (
    <div style={{ width: "100%", maxWidth: 820, margin: "0 auto" }}>
      <div style={{ position: "relative" }}>
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by name, phone, email, booking #, or ticket code"
          style={{
            width: "100%", boxSizing: "border-box",
            padding: "16px 20px 16px 48px",
            background: "white",
            border: "2px solid var(--ink-800)",
            borderRadius: 16, boxShadow: "0 4px 0 var(--ink-800)",
            fontSize: 16, fontWeight: 600, color: "var(--ink-900)",
            outline: "none",
          }}
        />
        <Icon name="search" size={20} style={{ position: "absolute", left: 18, top: 18, color: "var(--ink-500)" }} />
      </div>
      {trimmed.length >= 2 && (
        <div style={{
          marginTop: 12, background: "white",
          border: "1.5px solid var(--ink-200)", borderRadius: 14,
          overflow: "hidden",
        }}>
          {isFetching && <div style={{ padding: 16, textAlign: "center", color: "var(--ink-500)" }}>Searching…</div>}
          {!isFetching && results.length === 0 && (
            <div style={{ padding: 24, textAlign: "center", color: "var(--ink-500)" }}>No bookings match.</div>
          )}
          {results.map((r) => (
            <button
              key={r.bookingMasterId}
              type="button"
              onClick={() => onPick(r.bookingMasterId)}
              style={{
                all: "unset", cursor: "pointer", display: "block", width: "100%", boxSizing: "border-box",
                padding: "14px 18px",
                borderBottom: "1px solid var(--ink-100)",
                background: "white",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "var(--ink-25)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "white")}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <div style={{ fontWeight: 700, color: "var(--ink-900)" }}>
                    {r.bookingName || r.guestName || "Walk-in"}
                  </div>
                  <div style={{ fontSize: 12, color: "var(--ink-500)" }}>
                    #{r.bookingNumber || r.bookingMasterId}
                    {r.bookingDate && ` · ${new Date(r.bookingDate).toLocaleDateString()}`}
                    {r.totalAmount != null && ` · ${moneyFmt(r.totalAmount)}`}
                  </div>
                </div>
                <Icon name="chevron-right" size={18} style={{ color: "var(--ink-400)" }} />
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Group tickets by product+productType ──────────────────────────
function groupTickets(tickets = []) {
  const buckets = {
    party: [],
    tickets: [],
    addons: [],
  };
  // Group key: productType|productId|variationId
  const map = new Map();
  for (const t of tickets) {
    const key = `${t.productType}|${t.productId}|${t.variationId || ""}`;
    if (!map.has(key)) {
      map.set(key, {
        key,
        productType: t.productType,
        productId: t.productId,
        productName: t.product?.name || "(unnamed)",
        captureTicketHolder: !!t.product?.captureTicketHolder,
        validFrom: t.validFrom,
        validUntil: t.validUntil,
        items: [],
      });
    }
    map.get(key).items.push(t);
  }
  for (const g of map.values()) {
    if (g.productType === "wristband" || g.productType === "party_inclusion") buckets.party.push(g);
    else if (g.productType === "session_pass") buckets.tickets.push(g);
    else buckets.addons.push(g);
  }
  return buckets;
}

const VERB_BY_TYPE = {
  session_pass:    { issued: "Redeem one",  done: "Redeemed",  pending: "redeemed" },
  wristband:       { issued: "Issue band",  done: "Issued",    pending: "issued" },
  party_inclusion: { issued: "Mark served", done: "Served",    pending: "served" },
  add_on:          { issued: "Mark delivered", done: "Delivered", pending: "delivered" },
  stock_item:      { issued: "Hand over",   done: "Handed over", pending: "handed over" },
};

// ── A single grouped ticket card ──────────────────────────────────
function TicketGroupCard({ group }) {
  const verb = VERB_BY_TYPE[group.productType] || VERB_BY_TYPE.session_pass;
  const total = group.items.length;
  const done = group.items.filter((t) => t.status === "redeemed").length;
  const partial = group.items.filter((t) => t.status === "partially_redeemed").length;
  const named = group.items.filter((t) => t.participantId).length;
  const [showCodes, setShowCodes] = useState(false);
  const [showHolders, setShowHolders] = useState(false);

  const validWindow = (group.validFrom && group.validUntil)
    ? `${timeOnly(group.validFrom)}–${timeOnly(group.validUntil)}`
    : null;

  return (
    <div style={{
      background: "white",
      border: "1.5px solid var(--ink-200)",
      borderRadius: 14,
      padding: "14px 16px",
    }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
        <div style={{
          width: 38, height: 38, borderRadius: 10,
          background: group.productType === "wristband" ? "var(--aero-orange-50)" : "var(--ink-50)",
          color: group.productType === "wristband" ? "var(--aero-orange-700)" : "var(--ink-700)",
          display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
        }}>
          <Icon name={
            group.productType === "wristband" ? "scan-line" :
            group.productType === "session_pass" ? "ticket" :
            group.productType === "party_inclusion" ? "party-popper" :
            group.productType === "add_on" ? "shopping-bag" : "package"
          } size={18} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 14, color: "var(--ink-900)" }}>
            {group.productName} <span style={{ color: "var(--ink-500)", fontWeight: 600 }}>· ×{total}</span>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
            <CountChip
              done={done + partial}
              total={total}
              labelDone={verb.done}
              labelPartial={`${verb.pending}`}
              labelNone={verb.pending}
            />
            {group.captureTicketHolder && (
              <CountChip
                done={named}
                total={total}
                labelDone="named"
                labelNone="unnamed"
              />
            )}
            {validWindow && (
              <span style={{
                display: "inline-flex", alignItems: "center", gap: 4,
                padding: "3px 8px", borderRadius: 999,
                background: "var(--ink-50)", color: "var(--ink-600)",
                fontSize: 11, fontWeight: 600,
              }}>
                <Icon name="clock" size={11} /> {validWindow}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Holder strip — only when capture is on */}
      {group.captureTicketHolder && (
        <div style={{ marginTop: 10 }}>
          <button type="button"
            onClick={() => setShowHolders((s) => !s)}
            style={{
              all: "unset", cursor: "pointer",
              fontSize: 11, fontWeight: 700,
              color: "var(--brand-primary, var(--aero-orange-700))",
              display: "inline-flex", alignItems: "center", gap: 4,
            }}>
            <Icon name={showHolders ? "chevron-down" : "chevron-right"} size={12} />
            Holders ({named}/{total})
          </button>
          {showHolders && (
            <div style={{
              marginTop: 8, padding: 10,
              background: "var(--ink-25)", borderRadius: 10,
              display: "flex", flexWrap: "wrap", gap: 6,
            }}>
              {group.items.map((t, i) => (
                <span key={t.ticketId || i} style={{
                  display: "inline-flex", alignItems: "center", gap: 4,
                  padding: "4px 10px", borderRadius: 999,
                  background: t.participantId ? "white" : "transparent",
                  border: t.participantId ? "1.5px solid var(--ink-200)" : "1.5px dashed var(--ink-300)",
                  fontSize: 11, fontWeight: 600,
                  color: t.participantId ? "var(--ink-800)" : "var(--ink-500)",
                }}>
                  {t.participantId
                    ? <>
                        <Icon name="user-round" size={11} />
                        {t.participant?.displayName || `Guest ${t.participantId}`}
                        {t.participant?.isMinor && <span style={{ fontSize: 9, opacity: 0.7 }}>(minor)</span>}
                      </>
                    : <><Icon name="user-x" size={11} /> Unnamed</>}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Codes accordion — for diagnosis / manual redemption */}
      <div style={{ marginTop: 8 }}>
        <button type="button"
          onClick={() => setShowCodes((s) => !s)}
          style={{
            all: "unset", cursor: "pointer",
            fontSize: 11, fontWeight: 700, color: "var(--ink-500)",
            display: "inline-flex", alignItems: "center", gap: 4,
          }}>
          <Icon name={showCodes ? "chevron-down" : "chevron-right"} size={12} />
          Show codes
        </button>
        {showCodes && (
          <div style={{
            marginTop: 8, padding: 10, background: "var(--ink-25)", borderRadius: 10,
            display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 6,
          }}>
            {group.items.map((t) => (
              <div key={t.ticketId} style={{
                fontFamily: "var(--font-mono)", fontSize: 11, fontWeight: 700,
                color: t.status === "redeemed" ? "var(--ink-400)" : "var(--ink-800)",
                textDecoration: t.status === "redeemed" ? "line-through" : "none",
                padding: "4px 8px", background: "white",
                border: "1px solid var(--ink-200)", borderRadius: 6,
              }}>{t.ticketCode}</div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Items list — three sections ───────────────────────────────────
function ItemsList({ tickets }) {
  const groups = useMemo(() => groupTickets(tickets), [tickets]);

  const Section = ({ title, items, defaultOpen = true }) => {
    const [open, setOpen] = useState(defaultOpen);
    const total = items.reduce((s, g) => s + g.items.length, 0);
    if (items.length === 0) return null;
    return (
      <div style={{ marginTop: 16 }}>
        <button type="button"
          onClick={() => setOpen((o) => !o)}
          style={{
            all: "unset", cursor: "pointer",
            display: "flex", alignItems: "center", gap: 8,
            fontSize: 12, fontWeight: 800, letterSpacing: "0.04em",
            color: "var(--ink-700)", textTransform: "uppercase",
            marginBottom: 8,
          }}>
          <Icon name={open ? "chevron-down" : "chevron-right"} size={14} />
          {title} <span style={{ color: "var(--ink-400)" }}>({total})</span>
        </button>
        {open && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {items.map((g) => <TicketGroupCard key={g.key} group={g} />)}
          </div>
        )}
      </div>
    );
  };

  return (
    <div>
      <Section title="Party" items={groups.party} />
      <Section title="Tickets" items={groups.tickets} />
      <Section title="Add-ons" items={groups.addons} />
    </div>
  );
}

// ── Booking summary card (middle pane) ────────────────────────────
function BookingSummary({ booking }) {
  if (!booking) return null;
  const guest = booking.guest || {};
  const owing = Number(booking.totalAmount || 0) - Number(booking.amountPaid || 0);
  const copy = (text) => { navigator.clipboard?.writeText(text); toast.success("Copied"); };

  return (
    <aside style={{
      width: 320, flexShrink: 0,
      background: "white",
      border: "1.5px solid var(--ink-200)",
      borderRadius: 16,
      padding: 18,
      alignSelf: "flex-start",
      position: "sticky", top: 16,
    }}>
      <div style={{ fontFamily: "var(--font-display)", fontSize: 22, fontWeight: 800, color: "var(--ink-900)", lineHeight: 1.2 }}>
        {booking.bookingName || guest.guestName || "Walk-in"}
      </div>
      <div style={{ fontSize: 12, color: "var(--ink-500)", marginTop: 4 }}>
        #{booking.bookingNumber || booking.bookingMasterId}
        {booking.bookingDate && ` · ${new Date(booking.bookingDate).toLocaleDateString()}`}
      </div>

      {(guest.guestPhone || guest.guestEmail) && (
        <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px dashed var(--ink-200)" }}>
          {guest.guestPhone && (
            <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "var(--ink-700)" }}>
              <Icon name="phone" size={13} /> {guest.guestPhone}
              <button type="button" onClick={() => copy(guest.guestPhone)} style={{ all: "unset", cursor: "pointer", color: "var(--ink-400)", marginLeft: "auto" }}>
                <Icon name="copy" size={12} />
              </button>
            </div>
          )}
          {guest.guestEmail && (
            <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "var(--ink-700)", marginTop: 6 }}>
              <Icon name="mail" size={13} />
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{guest.guestEmail}</span>
              <button type="button" onClick={() => copy(guest.guestEmail)} style={{ all: "unset", cursor: "pointer", color: "var(--ink-400)" }}>
                <Icon name="copy" size={12} />
              </button>
            </div>
          )}
        </div>
      )}

      <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px dashed var(--ink-200)" }}>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", color: "var(--ink-500)", textTransform: "uppercase", marginBottom: 6 }}>Balance</div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "var(--ink-600)" }}>
          <span>Paid</span><span className="display-num">{moneyFmt(booking.amountPaid)}</span>
        </div>
        <div style={{
          marginTop: 6, padding: "8px 10px", borderRadius: 10,
          background: owing > 0 ? "var(--aero-yellow-50, #FFF7DC)" : "var(--color-success-soft, #DCFCE7)",
          color: owing > 0 ? "var(--aero-yellow-700, #A16207)" : "var(--color-success, #16A34A)",
          display: "flex", justifyContent: "space-between", fontWeight: 800,
        }}>
          <span>{owing > 0 ? "Owing" : "Paid in full"}</span>
          <span className="display-num">{moneyFmt(Math.max(0, owing))}</span>
        </div>
      </div>

      {booking.salesChannel && (
        <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px dashed var(--ink-200)", fontSize: 12, color: "var(--ink-500)" }}>
          <strong style={{ color: "var(--ink-700)" }}>Channel:</strong> {booking.salesChannel}
        </div>
      )}
    </aside>
  );
}

// ── Status header — the "next action" strip ───────────────────────
function StatusHeader({ booking, ticketSummary }) {
  const total = ticketSummary?.total || 0;
  const redeemed = ticketSummary?.redeemed || 0;
  const owing = Math.max(0, Number(booking?.totalAmount || 0) - Number(booking?.amountPaid || 0));

  return (
    <div style={{
      background: "white",
      border: "2px solid var(--ink-800)",
      borderRadius: 18,
      boxShadow: "0 4px 0 var(--ink-800)",
      padding: 18,
    }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        <CountChip done={redeemed} total={total} labelDone="all redeemed" labelPartial="redeemed" labelNone="redeemed" />
        <span style={{
          padding: "3px 10px", borderRadius: 999,
          background: owing > 0 ? "var(--aero-yellow-50, #FFF7DC)" : "var(--color-success-soft, #DCFCE7)",
          color: owing > 0 ? "var(--aero-yellow-700, #A16207)" : "var(--color-success, #16A34A)",
          fontSize: 11, fontWeight: 700,
        }}>
          {owing > 0 ? `${moneyFmt(owing)} owing` : "Paid in full"}
        </span>
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
        {owing > 0 && (
          <button type="button" className="a-btn a-btn--primary"
            style={{ flex: "1 1 auto", justifyContent: "center", padding: "12px 16px", fontSize: 14 }}>
            <Icon name="credit-card" size={16} /> Take payment {moneyFmt(owing)}
          </button>
        )}
        {redeemed < total && (
          <button type="button" className="a-btn a-btn--ghost"
            style={{ flex: "1 1 auto", justifyContent: "center", padding: "12px 16px", fontSize: 14 }}>
            <Icon name="check" size={16} /> Check in {total - redeemed}
          </button>
        )}
        <button type="button" className="a-btn a-btn--ghost"
          style={{ justifyContent: "center", padding: "12px 16px", fontSize: 14 }}>
          <Icon name="printer" size={16} /> Reprint
        </button>
      </div>
    </div>
  );
}

// ── Main screen ───────────────────────────────────────────────────
export default function BookingDetail() {
  const [bookingMasterId, setBookingMasterId] = useState(null);

  const { data: bookingData, isFetching: isLoadingBooking } =
    useGetBookingByIdQuery(bookingMasterId, { skip: !bookingMasterId });
  const { data: ticketsData, isFetching: isLoadingTickets } =
    useGetBookingTicketsQuery(bookingMasterId, { skip: !bookingMasterId });

  const booking = bookingData?.data || bookingData;
  const tickets = ticketsData?.data || [];
  const summary = ticketsData?.summary;

  // No booking yet → search-only view
  if (!bookingMasterId) {
    return (
      <div style={{ padding: 24, flex: 1, overflow: "auto", background: "var(--ink-25)" }}>
        <div style={{ textAlign: "center", marginBottom: 28 }}>
          <Icon name="search" size={42} style={{ color: "var(--ink-400)" }} />
          <h2 style={{ fontFamily: "var(--font-display)", fontSize: 26, fontWeight: 800, color: "var(--ink-900)", marginTop: 8 }}>
            Find a booking
          </h2>
          <p style={{ fontSize: 13, color: "var(--ink-500)", marginTop: 4 }}>
            Search by guest name, phone, email, booking number, or ticket code.
          </p>
        </div>
        <SearchBar onPick={setBookingMasterId} />
      </div>
    );
  }

  return (
    <div style={{ padding: 16, flex: 1, overflow: "auto", background: "var(--ink-25)", display: "flex", flexDirection: "column", gap: 12 }}>
      {/* Top bar — "back to search" */}
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <button type="button"
          onClick={() => setBookingMasterId(null)}
          className="a-btn a-btn--ghost a-btn--sm">
          <Icon name="arrow-left" size={14} /> Search
        </button>
        {(isLoadingBooking || isLoadingTickets) && (
          <span style={{ fontSize: 11, color: "var(--ink-500)" }}>Loading…</span>
        )}
      </div>

      <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
        <BookingSummary booking={booking} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <StatusHeader booking={booking} ticketSummary={summary} />
          <ItemsList tickets={tickets} />
        </div>
      </div>
    </div>
  );
}
