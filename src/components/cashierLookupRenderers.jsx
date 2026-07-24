import React from "react";
import { Icon } from "../pages/cashier/Icon";
import { moneyFmt, roundMoney } from "../lib/money";

export const responseDataItems = (response) => response?.data || [];

export const bookingSuggestionItems = (response) =>
  responseDataItems(response).filter((item) => item?.type === "booking" && item?.bookingId);

export const customerSuggestionItems = (response) =>
  responseDataItems(response).filter((item) => item?.customerId || item?.guestId || item?.id);

export const lookupItemKey = (item) =>
  item?.id ||
  item?.bookingId ||
  item?.bookingNumber ||
  item?.customerId ||
  item?.guestId ||
  item?.signatureId ||
  item?.email ||
  item?.name;

export const customerNameOf = (item) =>
  item?.customerName || item?.guestName || item?.name || item?.bookingName || "Customer";

export const customerEmailOf = (item) =>
  item?.customerEmail || item?.guestEmail || item?.email || "";

export const customerPhoneOf = (item) =>
  item?.customerPhone || item?.guestPhone || item?.phone || "";

export const customerContactOf = (item) =>
  [customerEmailOf(item), customerPhoneOf(item)].filter(Boolean).join(" · ") ||
  "No contact on file";

export const bookingNumberOf = (item) =>
  item?.bookingNumber || item?.bookingId || "";

export const bookingLabelOf = (item) =>
  item?.label || `Booking ${bookingNumberOf(item)}`.trim();

export const bookingCustomerNameOf = (item) =>
  item?.customerName || item?.bookingName || item?.name || "Walk-in";

export const bookingSecondaryOf = (item) =>
  [
    bookingCustomerNameOf(item),
    customerEmailOf(item),
    customerPhoneOf(item),
    item?.ticketCode ? `Ticket ${item.ticketCode}` : "",
  ]
    .filter(Boolean)
    .join(" · ");

export const bookingWhenOf = (item) => {
  const value = item?.dateOfBooking || item?.createdAt || item?.bookingDate || item?.date;
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
};

export const paidAmountOf = (item) => {
  const direct = item?.amountPaid ?? item?.amountPaidTotal;
  if (direct != null && direct !== "") return roundMoney(Number(direct) || 0);
  const total = Number(item?.totalAmount || 0);
  const balance = Number(item?.balance || 0);
  return roundMoney(Math.max(0, total - balance));
};

export const waiverSuggestionItems = responseDataItems;

export const waiverLabelOf = (item) =>
  item?.customerName || item?.guestName || item?.name || item?.signedBy || "Waiver holder";

export const waiverSecondaryOf = (item) =>
  [
    item?.signedBy && item.signedBy !== item.name ? `Signed by ${item.signedBy}` : "",
    customerEmailOf(item),
    customerPhoneOf(item),
    item?.waiverName,
  ]
    .filter(Boolean)
    .join(" · ") || "No waiver contact on file";

export const waiverExpiryOf = (item) => {
  const value = item?.expiredAt || item?.expiresAt;
  if (!value) return "No expiry";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return `Expires ${date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`;
};

export const readableStatus = (value) =>
  String(value || "")
    .replace(/[_-]/g, " ")
    .trim();

function LookupBadge({ children, tone = "neutral" }) {
  return (
    <span className={`lookup-card-badge lookup-card-badge--${tone}`.trim()}>
      {children}
    </span>
  );
}

export function CustomerLookupOption({ item, badge = "Customer" }) {
  const name = customerNameOf(item);
  return (
    <>
      <span className="lookup-search__avatar customer-lookup__avatar">
        {name.trim().slice(0, 1).toUpperCase() || "C"}
      </span>
      <span className="lookup-search__text">
        <span className="lookup-search__primary customer-lookup__primary">
          <LookupBadge>{badge}</LookupBadge>
          <span>{name}</span>
        </span>
        <span className="lookup-search__secondary">{customerContactOf(item)}</span>
      </span>
    </>
  );
}

export function BookingLookupOption({ item, badge = "Booking" }) {
  return (
    <>
      <span className="lookup-search__avatar booking-lookup__avatar">
        <Icon name="ticket" size={16} />
      </span>
      <span className="lookup-search__text">
        <span className="lookup-search__primary booking-lookup__primary">
          <LookupBadge tone="booking">{badge}</LookupBadge>
          <span>{bookingLabelOf(item)}</span>
        </span>
        <span className="lookup-search__secondary booking-lookup__secondary">
          {bookingSecondaryOf(item) || "No customer details on file"}
        </span>
        {(item?.status || item?.paymentStatus || bookingWhenOf(item)) && (
          <span className="lookup-search__tertiary">
            {[readableStatus(item?.paymentStatus), readableStatus(item?.status), bookingWhenOf(item)]
              .filter(Boolean)
              .join(" · ")}
          </span>
        )}
      </span>
    </>
  );
}

export function RefundBookingLookupOption({ item }) {
  const paid = paidAmountOf(item);
  return (
    <>
      <span className="lookup-search__avatar booking-lookup__avatar">
        <Icon name="undo-2" size={16} />
      </span>
      <span className="lookup-search__text">
        <span className="lookup-search__primary booking-lookup__primary">
          <LookupBadge tone="booking">Sale</LookupBadge>
          <span>{bookingLabelOf(item)}</span>
        </span>
        <span className="lookup-search__secondary">
          {bookingCustomerNameOf(item)} · {bookingWhenOf(item) || "Date not set"}
        </span>
        <span className="lookup-search__tertiary">
          {paid > 0 ? `${moneyFmt(paid)} paid` : "No payment recorded"}
        </span>
      </span>
    </>
  );
}

export function WaiverLookupOption({ item }) {
  const status = readableStatus(item?.waiverStatus) || "Active";
  return (
    <>
      <span className="lookup-search__avatar waiver-lookup__avatar">
        <Icon name={item?.isMinor ? "user-round" : "shield-check"} size={16} />
      </span>
      <span className="lookup-search__text">
        <span className="lookup-search__primary waiver-lookup__primary">
          <LookupBadge tone="waiver">Waiver</LookupBadge>
          <span>{waiverLabelOf(item)}</span>
        </span>
        <span className="lookup-search__secondary">{waiverSecondaryOf(item)}</span>
        <span className="lookup-search__tertiary">
          {[status, waiverExpiryOf(item)].filter(Boolean).join(" · ")}
        </span>
      </span>
    </>
  );
}
