// GuestProfile — search + profile view for the cashier.
// Type 3+ chars (email / phone / name) → dropdown appears → select one →
// see the guest's recent bookings. From here the cashier can jump into
// the admin booking detail to take payment, send a waiver, etc.

import React, { useCallback, useState } from "react";
import { Icon } from "./Icon";
import { StatusPill } from "./StatusPill";
import { useGetAllBookingQuery } from "../../features/bookings/bookingApi";
import { useLazyLookupCustomersQuery } from "../../features/customers/customersApi";
import { LookupSearch } from "../../components/LookupSearch";
import {
  CustomerLookupOption,
  customerContactOf,
  customerEmailOf,
  customerNameOf,
  customerPhoneOf,
} from "../../components/cashierLookupRenderers";
import { adminBookingDetailUrl } from "../../lib/adminLink";

const fmtMoney = (v) => `$${Number(v || 0).toFixed(2)}`;

export function GuestProfile() {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(null);
  const [lookupCustomers] = useLazyLookupCustomersQuery();

  const searchGuests = useCallback(
    (search) => lookupCustomers({ query: search, limit: 18 }).unwrap(),
    [lookupCustomers]
  );

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      {/* Search bar */}
      <div style={{ padding: "16px 28px", borderBottom: "1px solid var(--ink-100)" }}>
        <LookupSearch
          value={query}
          onInputChange={(next) => {
            setQuery(next);
            if (!next.trim()) setSelected(null);
          }}
          onSearch={searchGuests}
          onSelect={(guest) => {
            setSelected(guest);
            setQuery("");
          }}
          placeholder="Search by name, email, or phone"
          minChars={2}
          emptyText="No matching customers found."
          getLabel={customerNameOf}
          getSecondary={customerContactOf}
          renderItem={(person) => <CustomerLookupOption item={person} />}
          className="cashier-lookup--profile"
        />
      </div>

      <div style={{ flex: 1, display: "flex", overflow: "hidden", minHeight: 0 }}>
        {/* Results list */}
        <div style={{ width: 360, overflowY: "auto", borderRight: "1px solid var(--ink-100)", padding: "12px 16px" }}>
          {selected ? (
            <GuestRow
              g={selected}
              isSelected
              onClick={() => setSelected(selected)}
            />
          ) : (
            <div style={{ padding: 28, textAlign: "center", color: "var(--ink-500)", fontSize: 13 }}>
              Search and select a customer to open their profile.
            </div>
          )}
        </div>

        {/* Detail */}
        <div style={{ flex: 1, overflowY: "auto", padding: "20px 28px" }}>
          {selected ? (
            <GuestDetail guest={selected} />
          ) : (
            <div style={{ padding: 28, textAlign: "center", color: "var(--ink-500)" }}>
              <Icon name="user-round" size={42} style={{ color: "var(--ink-200)", marginBottom: 12 }} />
              <div style={{ fontWeight: 700, color: "var(--ink-700)", marginBottom: 4 }}>Pick a customer</div>
              <div style={{ fontSize: 13 }}>Their visit history and active bookings will show here.</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function initials(name) {
  return String(name || "?").split(/\s+/).slice(0, 2).map((n) => n[0]).join("").toUpperCase();
}

const PALETTE = ["#F45B0A", "#6A40F5", "#18B8C9", "#1F9D55", "#D6361A", "#E9A100"];
const colorFor = (name) =>
  PALETTE[(String(name || "?").charCodeAt(0) + String(name || "").length) % PALETTE.length];

function GuestRow({ g, isSelected, onClick }) {
  const name = customerNameOf(g);
  const email = customerEmailOf(g);
  const phone = customerPhoneOf(g);
  const id = g.customerId || g.guestId || g.id;
  return (
    <div
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "12px 14px",
        marginBottom: 8,
        background: isSelected ? "var(--aero-orange-50)" : "white",
        border: isSelected ? "2px solid var(--aero-orange-500)" : "1.5px solid var(--ink-200)",
        borderRadius: 12,
        cursor: "pointer",
      }}
    >
      <div
        style={{
          width: 36, height: 36, borderRadius: 10,
          background: colorFor(name),
          color: "white",
          fontWeight: 800, fontSize: 13,
          display: "flex", alignItems: "center", justifyContent: "center",
          border: "1.5px solid var(--ink-800)",
          flexShrink: 0,
        }}
      >
        {initials(name)}
      </div>
      <div style={{ flex: 1, lineHeight: 1.3, minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 14, color: "var(--ink-900)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name || "—"}</span>
          {g._profileCount > 1 && (
            <span style={{ flexShrink: 0, fontSize: 10, fontWeight: 800, color: "var(--ink-600)", background: "var(--ink-100)", borderRadius: 999, padding: "2px 7px" }}>
              {g._profileCount} profiles
            </span>
          )}
        </div>
        <div style={{ fontSize: 11.5, color: "var(--ink-500)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {email || phone || `Customer #${id}`}
        </div>
      </div>
    </div>
  );
}

function GuestDetail({ guest }) {
  // Pull this guest's recent bookings via the same all-bookings query,
  // filtered by their email or phone (search supports both).
  const name = customerNameOf(guest);
  const email = customerEmailOf(guest);
  const phone = customerPhoneOf(guest);
  const id = guest.customerId || guest.guestId || guest.id;
  const searchKey = email || phone || name || "";
  const { data, isLoading } = useGetAllBookingQuery({
    page: 1,
    limit: 20,
    search: searchKey,
    dateFrom: "",
    dateTo: "",
    status: [],
    paymentStatus: [],
    activityId: [],
  });

  const bookings = data?.data || [];

  return (
    <div>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 18, marginBottom: 22 }}>
        <div
          style={{
            width: 88,
            height: 88,
            borderRadius: 24,
            background: colorFor(name),
            color: "#fff",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontFamily: "var(--font-display, inherit)",
            fontSize: 36,
            fontWeight: 800,
            border: "2px solid var(--ink-800)",
            boxShadow: "0 6px 0 var(--ink-800)",
          }}
        >
          {initials(name)}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1
            style={{
              margin: 0,
              fontFamily: "var(--font-display, inherit)",
              fontSize: 32,
              fontWeight: 800,
              letterSpacing: "-0.02em",
              color: "var(--ink-900)",
            }}
          >
            {name || "—"}
          </h1>
          <div style={{ fontSize: 13, color: "var(--ink-500)", fontFamily: "var(--font-mono, inherit)", marginTop: 6 }}>
            CUS-{id} · {email || "—"}
            {phone && ` · ${phone}`}
          </div>
          {(guest.guestAddress || guest.postcode) && (
            <div style={{ fontSize: 12, color: "var(--ink-500)", marginTop: 4 }}>
              {[guest.guestAddress, guest.postcode].filter(Boolean).join(" · ")}
            </div>
          )}
        </div>
      </div>

      {/* Quick stats */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 20 }}>
        <Tile label="Total visits" value={bookings.length} />
        <Tile
          label="Lifetime spend"
          value={fmtMoney(bookings.reduce((s, b) => s + Number(b.totalAmount || 0), 0))}
        />
        <Tile
          label="Outstanding"
          value={fmtMoney(bookings.reduce((s, b) => s + Number(b.balance || 0), 0))}
          tone={
            bookings.reduce((s, b) => s + Number(b.balance || 0), 0) > 0 ? "danger" : "success"
          }
        />
      </div>

      {/* Bookings */}
      <div
        style={{
          background: "#fff",
          border: "1.5px solid var(--ink-200)",
          borderRadius: 14,
          padding: 18,
        }}
      >
        <h2
          style={{
            margin: "0 0 14px",
            fontFamily: "var(--font-display, inherit)",
            fontSize: 18,
            fontWeight: 800,
            color: "var(--ink-900)",
          }}
        >
          Visit history
        </h2>
        {isLoading ? (
          <div style={{ fontSize: 13, color: "var(--ink-500)" }}>Loading…</div>
        ) : bookings.length === 0 ? (
          <div style={{ fontSize: 13, color: "var(--ink-500)" }}>No bookings yet for this guest.</div>
        ) : (
          <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
            {bookings.map((b, i) => {
              const isCancelled = b.status === "cancelled";
              return (
                <li
                  key={b.bookingId}
                  onClick={() => window.open(adminBookingDetailUrl(b.bookingId), "_blank", "noopener,noreferrer")}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 14,
                    padding: "12px 0",
                    borderBottom: i < bookings.length - 1 ? "1px solid var(--ink-100)" : "none",
                    cursor: "pointer",
                    opacity: isCancelled ? 0.55 : 1,
                  }}
                >
                  <div style={{ flex: 1, lineHeight: 1.3, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 14 }}>
                      {b.activityName || "Booking"}
                    </div>
                    <div style={{ fontSize: 12, color: "var(--ink-500)", marginTop: 2 }}>
                      {b.bookingNumber} · {b.dateOfBooking || "—"} · {b.totalGuests || 0} pax
                    </div>
                  </div>
                  <StatusPill
                    tone={
                      b.paymentStatus === "paid"
                        ? "success"
                        : b.paymentStatus === "part-paid"
                        ? "warning"
                        : "danger"
                    }
                  >
                    {b.paymentStatus || "—"}
                  </StatusPill>
                  <div className="display-num" style={{ fontSize: 18, color: "var(--ink-900)", minWidth: 80, textAlign: "right" }}>
                    {fmtMoney(b.totalAmount)}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

function Tile({ label, value, tone = "default" }) {
  const fg = {
    danger: "var(--color-danger)",
    success: "var(--color-success)",
    default: "var(--ink-900)",
  }[tone];
  return (
    <div
      style={{
        background: "white",
        border: "1.5px solid var(--ink-200)",
        borderRadius: 14,
        padding: "12px 14px",
      }}
    >
      <div
        style={{
          fontSize: 10.5,
          fontWeight: 800,
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          color: "var(--ink-500)",
        }}
      >
        {label}
      </div>
      <div
        className="display-num"
        style={{
          fontFamily: "var(--font-display, inherit)",
          fontSize: 22,
          fontWeight: 800,
          color: fg,
          marginTop: 4,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {value}
      </div>
    </div>
  );
}
