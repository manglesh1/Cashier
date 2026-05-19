import React from "react";
import { Icon } from "./Icon";
import { getDefaultCartQuantity } from "./cartPricing";

export function ScheduleRequiredDialog({ item, section, onClose }) {
  if (!item) return null;

  const guestCount = getDefaultCartQuantity(item);
  const optionName = item.variationName || (item.variationOptions || [])[0]?.name || null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 60,
        background: "rgba(0,0,0,0.35)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
      onMouseDown={onClose}
    >
      <div
        style={{
          width: "min(620px, 100%)",
          maxHeight: "min(720px, calc(100vh - 48px))",
          overflow: "auto",
          background: "var(--ink-0)",
          border: "2px solid var(--ink-800)",
          borderRadius: 18,
          boxShadow: "0 8px 0 var(--ink-800)",
          padding: 20,
        }}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
          <div
            style={{
              width: 48,
              height: 48,
              borderRadius: 14,
              background: "var(--aero-orange-50)",
              color: "var(--aero-orange-600)",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              flex: "0 0 auto",
            }}
          >
            <Icon name="calendar-clock" size={25} />
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="eyebrow">Schedule required</div>
            <h2 style={{ margin: "3px 0 4px", fontFamily: "var(--font-display)", fontSize: 26 }}>
              Pick a slot before adding
            </h2>
            <p style={{ margin: 0, color: "var(--ink-600)", lineHeight: 1.45 }}>
              This item reserves live capacity, so it needs a date, available time slot, and resource selection before it can move to the cart.
            </p>
          </div>
          <button type="button" className="a-btn a-btn--ghost a-btn--sm" onClick={onClose}>
            x
          </button>
        </div>

        <div
          style={{
            marginTop: 18,
            border: "1.5px solid var(--ink-200)",
            borderRadius: 14,
            padding: 16,
            display: "grid",
            gap: 12,
            background: "var(--ink-0)",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", gap: 18, alignItems: "flex-start" }}>
            <div>
              <div style={{ fontWeight: 900, fontSize: 18, color: "var(--ink-900)" }}>{item.name}</div>
              <div style={{ marginTop: 3, color: "var(--ink-500)", fontSize: 13 }}>
                {optionName || section?.title || item.productType || "Scheduled product"}
              </div>
            </div>
            <div className="display-num" style={{ fontSize: 22, whiteSpace: "nowrap" }}>
              ${Number(item.price || 0).toFixed(2)}
            </div>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
              gap: 10,
            }}
          >
            <InfoTile label="Guests" value={guestCount} />
            <InfoTile label="Date" value="Required" />
            <InfoTile label="Slot" value="Required" />
          </div>
        </div>

        <div
          style={{
            marginTop: 16,
            padding: "14px 16px",
            borderRadius: 14,
            border: "1.5px solid var(--aero-orange-200)",
            background: "var(--aero-orange-50)",
            color: "var(--ink-800)",
            fontWeight: 700,
            lineHeight: 1.35,
          }}
        >
          Counter items can still go straight to cart. Session and party products stay locked until a live slot is selected, so staff cannot accidentally take payment for an unscheduled booking.
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 18 }}>
          <button type="button" className="a-btn a-btn--primary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function InfoTile({ label, value }) {
  return (
    <div
      style={{
        border: "1.5px solid var(--ink-100)",
        borderRadius: 12,
        padding: "10px 12px",
        background: "var(--ink-50)",
        minWidth: 0,
      }}
    >
      <div className="eyebrow" style={{ fontSize: 10 }}>{label}</div>
      <div style={{ fontWeight: 900, marginTop: 2, color: "var(--ink-900)", overflowWrap: "anywhere" }}>{value}</div>
    </div>
  );
}
