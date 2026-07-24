// GuestProfile — cashier customer lookup + profile detail.
// Search 2+ chars, select a customer, then load the same compact customer
// detail API used by the main Movira Customers page.

import React, { useCallback, useMemo, useState } from "react";
import { Icon } from "./Icon";
import { StatusPill } from "./StatusPill";
import {
  useGetCustomerByIdQuery,
  useLazyLookupCustomersQuery,
} from "../../features/customers/customersApi";
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

const fmtDate = (value, fallback = "-") => {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "2-digit",
    year: "numeric",
  });
};

const PALETTE = ["#F45B0A", "#6A40F5", "#18B8C9", "#1F9D55", "#D6361A", "#E9A100"];
const colorFor = (name) =>
  PALETTE[(String(name || "?").charCodeAt(0) + String(name || "").length) % PALETTE.length];

const idOf = (item) => item?.customerId || item?.guestId || item?.id || null;
const bookingItemsOf = (customer) =>
  Array.isArray(customer?.bookingItems)
    ? customer.bookingItems
    : Array.isArray(customer?.bookings)
      ? customer.bookings
      : [];

function initials(name) {
  return String(name || "?")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((n) => n[0])
    .join("")
    .toUpperCase();
}

function fullAddress(customer) {
  return [
    customer?.address || customer?.customerAddress || customer?.guestAddress,
    customer?.city,
    customer?.province,
    customer?.country,
    customer?.postcode,
  ]
    .filter(Boolean)
    .join(", ");
}

export function GuestProfile() {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(null);
  const [lookupCustomers] = useLazyLookupCustomersQuery();

  const selectedId = idOf(selected);
  const {
    data: detailResponse,
    isFetching: isDetailLoading,
    isError: isDetailError,
    error: detailError,
  } = useGetCustomerByIdQuery(
    { id: selectedId, compact: true },
    { skip: !selectedId }
  );

  const customer = detailResponse?.data || selected;

  const searchGuests = useCallback(
    (search) => lookupCustomers({ query: search, limit: 18 }).unwrap(),
    [lookupCustomers]
  );

  return (
    <div className="cashier-guest" style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div
        style={{
          padding: "14px 22px",
          borderBottom: "1px solid var(--ink-100)",
          background: "linear-gradient(180deg, rgba(255,255,255,0.96), rgba(255,255,255,0.88))",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
          <div style={{ minWidth: 180 }}>
            <div className="cashier-profile-eyebrow">Customer lookup</div>
            <div style={{ fontWeight: 900, color: "var(--ink-900)", lineHeight: 1.1 }}>
              Open guest profile
            </div>
          </div>
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
      </div>

      <div className="cashier-guest__shell">
        <aside className="cashier-guest__rail">
          {selected ? (
            <GuestRow
              g={customer}
              isSelected
              onClick={() => setSelected(selected)}
              isLoading={isDetailLoading}
            />
          ) : (
            <EmptyPanel
              icon="search"
              title="Search first"
              text="Select a customer from the dropdown to open the full profile."
            />
          )}
        </aside>

        <main className="cashier-guest__main">
          {!selected ? (
            <EmptyProfile />
          ) : isDetailError ? (
            <ErrorProfile error={detailError} />
          ) : (
            <GuestDetail customer={customer} isLoading={isDetailLoading} />
          )}
        </main>
      </div>
    </div>
  );
}

function GuestRow({ g, isSelected, onClick, isLoading }) {
  const name = customerNameOf(g);
  const email = customerEmailOf(g);
  const phone = customerPhoneOf(g);
  const id = idOf(g);
  return (
    <button
      type="button"
      onClick={onClick}
      className={`cashier-guest-row ${isSelected ? "is-selected" : ""}`.trim()}
    >
      <span
        className="cashier-guest-row__avatar"
        style={{ background: colorFor(name) }}
      >
        {initials(name)}
      </span>
      <span className="cashier-guest-row__body">
        <span className="cashier-guest-row__name">
          <span>{name || "Customer"}</span>
          {isLoading ? <span className="cashier-guest-row__sync">Syncing</span> : null}
        </span>
        <span className="cashier-guest-row__meta">
          {email || phone || `Customer #${id}`}
        </span>
      </span>
    </button>
  );
}

function GuestDetail({ customer, isLoading }) {
  const name = customerNameOf(customer);
  const email = customerEmailOf(customer);
  const phone = customerPhoneOf(customer);
  const id = idOf(customer);
  const address = fullAddress(customer);
  const bookings = useMemo(() => bookingItemsOf(customer), [customer]);
  const latestBooking = bookings[0];
  const outstanding = customer?.totalOutstandingBalance ??
    bookings.reduce((sum, booking) => sum + Number(booking.balance || 0), 0);

  const flags = Array.isArray(customer?.flags) ? customer.flags : [];
  const notes = Array.isArray(customer?.notes) ? customer.notes : [];

  return (
    <div className="cashier-customer-detail">
      <section className="cashier-customer-hero">
        <div className="cashier-customer-hero__main">
          <div
            className="cashier-customer-hero__avatar"
            style={{ background: colorFor(name) }}
          >
            {initials(name)}
          </div>
          <div style={{ minWidth: 0 }}>
            <div className="cashier-customer-hero__titleline">
              <h1>{name || "Customer"}</h1>
              {Number(customer?.bookingCount || bookings.length) > 0 ? (
                <StatusPill tone="success">Returning customer</StatusPill>
              ) : (
                <StatusPill tone="warning">New customer</StatusPill>
              )}
            </div>
            <div className="cashier-customer-hero__sub">
              Customer since {fmtDate(customer?.createdAt)} · #{id || "-"}
              {isLoading ? " · refreshing profile" : ""}
            </div>
          </div>
        </div>

        <div className="cashier-customer-info-grid">
          <Info icon="mail" label="Email" value={email} />
          <Info icon="phone" label="Phone" value={phone} />
          <Info icon="map-pin" label="Address" value={address} />
          <Info icon="user-round" label="Gender" value={customer?.gender} />
        </div>
      </section>

      <section className="cashier-customer-stats">
        <Stat icon="shopping-bag" label="Total bookings" value={customer?.bookingCount ?? bookings.length ?? 0} />
        <Stat icon="check-circle" label="Visits" value={customer?.visitCount ?? 0} />
        <Stat icon="dollar-sign" label="Total spend" value={fmtMoney(customer?.totalSpend)} tone="success" />
        <Stat icon="tag" label="Total discount" value={fmtMoney(customer?.totalDiscount)} />
        <Stat icon="calendar" label="Last visit" value={fmtDate(customer?.lastVisitAt || customer?.lastBookingAt || latestBooking?.date)} />
        <Stat icon="credit-card" label="Outstanding" value={fmtMoney(outstanding)} tone={Number(outstanding) > 0 ? "danger" : "success"} />
      </section>

      <section className="cashier-customer-grid">
        <Panel
          title="Recent bookings"
          action={bookings.length ? `${bookings.length} shown` : ""}
          className="cashier-customer-grid__wide"
        >
          {bookings.length ? (
            <ul className="cashier-booking-list">
              {bookings.slice(0, 12).map((booking, index) => (
                <BookingLine key={booking.id || booking.bookingId || booking.bookingNumber || index} booking={booking} />
              ))}
            </ul>
          ) : (
            <PanelEmpty text="No bookings yet for this customer." />
          )}
        </Panel>

        <Panel title="Flags" action={flags.length ? `${flags.length}` : ""}>
          {flags.length ? (
            <div className="cashier-stack">
              {flags.slice(0, 6).map((flag, index) => (
                <NoticeLine
                  key={flag.id || index}
                  tone={flag.tone || flag.kind || "warning"}
                  title={flag.label || flag.title || flag.kind || "Flag"}
                  text={flag.note || flag.description || ""}
                />
              ))}
            </div>
          ) : (
            <PanelEmpty text="No active flags." />
          )}
        </Panel>

        <Panel title="Internal notes" action={notes.length ? `${notes.length}` : ""}>
          {notes.length ? (
            <div className="cashier-stack">
              {notes.slice(0, 6).map((note, index) => (
                <NoticeLine
                  key={note.id || index}
                  title={note.title || "Note"}
                  text={note.body || note.note || note.content || ""}
                />
              ))}
            </div>
          ) : (
            <PanelEmpty text="No internal notes yet." />
          )}
        </Panel>
      </section>
    </div>
  );
}

function Info({ icon, label, value }) {
  return (
    <div className="cashier-customer-info">
      <Icon name={icon} size={15} />
      <div>
        <div className="cashier-profile-eyebrow">{label}</div>
        <div className="cashier-customer-info__value">{value || "-"}</div>
      </div>
    </div>
  );
}

function Stat({ icon, label, value, tone = "default" }) {
  return (
    <div className="cashier-customer-stat">
      <div className="cashier-customer-stat__icon">
        <Icon name={icon} size={17} />
      </div>
      <div>
        <div className="cashier-profile-eyebrow">{label}</div>
        <div className={`cashier-customer-stat__value cashier-customer-stat__value--${tone}`}>
          {value}
        </div>
      </div>
    </div>
  );
}

function Panel({ title, action, children, className = "" }) {
  return (
    <div className={`cashier-customer-panel ${className}`.trim()}>
      <div className="cashier-customer-panel__head">
        <h2>{title}</h2>
        {action ? <span>{action}</span> : null}
      </div>
      <div className="cashier-customer-panel__body">{children}</div>
    </div>
  );
}

function BookingLine({ booking }) {
  const bookingId = booking.id || booking.bookingId;
  const bookingNumber = booking.bookingNumber || bookingId || "-";
  const paymentStatus = booking.paymentStatus || "unpaid";
  const total = booking.total ?? booking.totalAmount ?? 0;
  const balance = booking.balance ?? 0;

  return (
    <li
      className="cashier-booking-line"
      onClick={() => {
        if (bookingId || bookingNumber) {
          window.open(adminBookingDetailUrl(bookingId || bookingNumber), "_blank", "noopener,noreferrer");
        }
      }}
    >
      <div className="cashier-booking-line__icon">
        <Icon name="ticket" size={16} />
      </div>
      <div className="cashier-booking-line__main">
        <strong>{booking.activityName || booking.name || "Booking"}</strong>
        <span>
          #{bookingNumber} · {fmtDate(booking.date || booking.dateOfBooking)} · {booking.customerCount || booking.totalGuests || 1} pax
        </span>
        {Array.isArray(booking.bookedFor) && booking.bookedFor.length ? (
          <small>{booking.bookedFor.join(", ")}</small>
        ) : null}
      </div>
      <StatusPill
        tone={
          paymentStatus === "paid"
            ? "success"
            : paymentStatus === "part-paid" || paymentStatus === "part_paid"
              ? "warning"
              : "danger"
        }
      >
        {String(paymentStatus).replace(/_/g, " ")}
      </StatusPill>
      <div className="cashier-booking-line__money">
        <strong>{fmtMoney(total)}</strong>
        {Number(balance) > 0 ? <span>{fmtMoney(balance)} due</span> : <span>settled</span>}
      </div>
    </li>
  );
}

function NoticeLine({ tone = "default", title, text }) {
  return (
    <div className={`cashier-notice-line cashier-notice-line--${tone}`}>
      <strong>{title}</strong>
      {text ? <span>{text}</span> : null}
    </div>
  );
}

function PanelEmpty({ text }) {
  return <div className="cashier-panel-empty">{text}</div>;
}

function EmptyPanel({ icon, title, text }) {
  return (
    <div className="cashier-empty-panel">
      <Icon name={icon} size={30} />
      <strong>{title}</strong>
      <span>{text}</span>
    </div>
  );
}

function EmptyProfile() {
  return (
    <div className="cashier-empty-profile">
      <Icon name="user-round" size={46} />
      <h2>Pick a customer</h2>
      <p>Search by name, email, or phone. The cashier profile opens with the same customer record used in Movira.</p>
    </div>
  );
}

function ErrorProfile({ error }) {
  return (
    <div className="cashier-empty-profile cashier-empty-profile--error">
      <Icon name="alert-triangle" size={44} />
      <h2>Customer profile could not load</h2>
      <p>{error?.data?.message || error?.data?.error || "Please search again or ask an admin to check this customer."}</p>
    </div>
  );
}
