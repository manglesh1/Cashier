// CashierApp — top-level cashier shell. Wires:
//   • CatalogGrid to the device's terminal template (useGetPresetFullQuery)
//   • Cart "Pay" → useCreateBookingMutation (creates a draft booking;
//     payment capture happens in the existing booking-detail flow per the
//     user's instruction to skip on-counter payment for now)
//   • CheckIn / Refund screens to their respective real APIs
// Payment + Shift-close screens remain as visual stubs until the user
// approves their backend additions.

import React, { useMemo, useState, useEffect } from "react";
import Cookies from "js-cookie";
import { useDispatch, useSelector } from "react-redux";
import { Routes, Route, Navigate, useLocation, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { baseApi } from "../../api/baseApi";
// adminLink imports removed — the only consumer (the legacy Payment
// screen) is no longer routed. Re-add when wiring real screens that
// deep-link into the admin app.
import { useLogoutMutation } from "../../features/auth/authApi";
import { logout as logoutAction } from "../../features/auth/authSlice";
import { Header } from "./Header";
import { StatusPill } from "./StatusPill";
import { Icon } from "./Icon";
import { CartPanel } from "./CartPanel";
import { CartWaiverModal } from "./CartWaiverModal";
import CashierPaymentDialog from "./CashierPaymentDialog";
import SellPaymentOverlay from "./SellPaymentOverlay";
import { CashierScreenBoundary } from "./CashierScreenBoundary";
import { CatalogGrid, VariantPickerDialog, buildChosenWithVariant } from "./CatalogGrid";
import { ScheduleRequiredDialog } from "./ScheduleRequiredDialog";
import { CheckIn } from "./CheckIn";
import { GuestProfile } from "./GuestProfile";
// Payment + ShiftClose are visual stubs and are not routed from the
// sidebar (see the `screens` array). The files remain on disk so the
// next dev to wire them has a starting point.
import { Refund } from "./Refund";
import { WaiverDetail } from "./WaiverDetail";
import { Redeem } from "./Redeem";
import BookingDetail from "./BookingDetail";
import {
  buildPaidCheckoutPricingSummary,
  clampCartQuantity,
  getCartLineSubtotal,
  getCheckoutRequirements,
  getDefaultCartQuantity,
  hasScheduleSelection,
  needsScheduleSelection,
} from "./cartPricing";
import {
  useGetAllPosDevicesQuery,
  useGetPresetFullQuery,
  useDeviceHeartbeatMutation,
} from "../../features/pos/posApi";
import {
  useCreateBookingMutation,
  useValidateCartMutation,
  useLazyGetAvailabilityQuery,
  useLazySearchWaiversQuery,
  useLazySearchGuestsQuery,
} from "../../features/bookings/bookingApi";
import { autoScheduleLine, formatDateValue } from "./scheduleHelpers";
import {
  setCartItems,
  setCartCustomer as setCartCustomerAction,
  setWaiversAttached as setWaiversAttachedAction,
  setTicketAssignments as setTicketAssignmentsAction,
  setAppliedBenefits as setAppliedBenefitsAction,
  ensureCheckoutKey,
  rotateCheckoutKey,
  clearCart,
} from "../../features/cart/cartSlice";
import { getTerminal, clearTerminal, updateTerminalSettings } from "../../lib/terminal";
import { attachScannerListener } from "../../lib/scanner";
import {
  startWristbandBridge,
  stopWristbandBridge,
} from "../../lib/wristbandBridge";
import { useEffectiveSettings } from "../../lib/useEffectiveSettings";

// ── Map preset { sections: [{ products: [...] }] } → CatalogGrid sections
const SECTION_TONES = ["orange", "yellow", "neutral", "orange", "yellow"];
const SECTION_ICON_MAP = {
  jump: "ticket",
  pass: "ticket",
  party: "cake",
  addon: "plus-circle",
  add_ons: "plus-circle",
  food: "cookie",
  snack: "cookie",
  drink: "cup-soda",
  merch: "shopping-bag",
};

function pickSectionIcon(name = "") {
  const k = name.toLowerCase();
  for (const key of Object.keys(SECTION_ICON_MAP)) {
    if (k.includes(key)) return SECTION_ICON_MAP[key];
  }
  return "ticket";
}

function pickItemIcon(productType = "") {
  const t = String(productType).toLowerCase();
  if (t.includes("session")) return "user-round";
  if (t.includes("party")) return "cake";
  if (t.includes("voucher")) return "gift";
  if (t.includes("add")) return "plus-circle";
  if (t.includes("stock")) return "shopping-bag";
  return "ticket";
}

function normalizePresetSections(preset) {
  if (!preset?.sections) return [];
  return preset.sections.map((sec, i) => ({
    title: sec.sectionName || sec.name || `Section ${i + 1}`,
    icon: pickSectionIcon(sec.sectionName || sec.name || ""),
    tone: SECTION_TONES[i % SECTION_TONES.length],
    items: (sec.activities || sec.products || sec.items || []).map((p) => {
      const productType = p.productType || p.type;
      const isVoucherPack = productType === "voucher_pack";
      const voucherMeta = isVoucherPack ? p.voucherMeta : null;

      // Voucher pack subtitle = inclusion summary (e.g. "5× Jump Pass + 1× Pizza")
      // or fall back to whatever description the activity has.
      const sub = voucherMeta?.inclusionSummary
        ? voucherMeta.inclusionSummary
        : p.description || p.subtitle || "";

      // Badge precedence:
      //   featured → "POPULAR"
      //   voucher pack with meaningful savings → "SAVE $N"
      //   voucher pack with no/zero savings   → "BUNDLE"
      let badge;
      if (p.featured) {
        badge = "POPULAR";
      } else if (isVoucherPack && voucherMeta?.savings > 0) {
        badge = `SAVE $${Math.round(voucherMeta.savings)}`;
      } else if (isVoucherPack) {
        badge = "BUNDLE";
      }

      return {
        // Preserve every backend identifier we'll need to build a booking payload
        id: p.productItemId || p.id || `${sec.sectionId}-${p.activityId || p.productId}`,
        activityId: p.activityId || p.productId,
        variationId: p.variationId,
        variationName: p.variationName || null,
        variationOptions: (p.variationOptions || []).map((v) => ({
          variationId: v.variationId || v.id,
          name: v.name || v.variationName || v.label || "Option",
          price: Number(v.price ?? p.price ?? p.unitPrice ?? 0),
          pricingMode: v.pricingMode || v.pricingType || p.pricingMode || p.pricingType || null,
          includedGuests: v.includedGuests ?? p.includedGuests ?? null,
          additionalPersonPrice: v.additionalPersonPrice ?? p.additionalPersonPrice ?? null,
          minGuests: v.minGuests ?? v.minimumGuests ?? p.minGuests ?? p.minimumGuests ?? null,
          maxGuests: v.maxGuests ?? v.maximumGuests ?? p.maxGuests ?? p.maximumGuests ?? null,
        })).filter((v) => v.variationId),
        productItemId: p.productItemId,
        productType,
        name: p.displayName || p.activityName || p.productName || p.name || "Untitled",
        sub,
        price: Number(p.price ?? p.unitPrice ?? p.basePrice ?? NaN),
        pricingMode: p.pricingMode || p.pricingType || null,
        includedGuests: p.includedGuests ?? null,
        additionalPersonPrice: p.additionalPersonPrice ?? null,
        minGuests: p.minGuests ?? p.minimumGuests ?? null,
        maxGuests: p.maxGuests ?? p.maximumGuests ?? null,
        icon: pickItemIcon(productType),
        badge,
        featured: p.featured,
        // Activity-level waiver requirement. Drives cart waiver gating.
        requiresWaiver: !!p.requiresWaiver,
        // Voucher pack hint: cart logic skips date/slot picker for these.
        isVoucherPack,
        voucherMeta,
        raw: p,
      };
    }),
  }));
}

const NO_SCHEDULE_CHECKOUT_TYPES = new Set([
  "voucher_pack",
  "membership",
  "gift_card",
]);

// Add-on / impulse items: surfaced in the top-floating "Add to order"
// strip on the Sell screen as soon as the cart has at least one primary
// item. Strip clears automatically when the cart empties (i.e. after
// payment completes and clearCart() fires).
const ADDON_PRODUCT_TYPES = new Set([
  "addon",
  "add_on",
  "add_ons",
  "stock_item",
]);

function productTypeKey(item) {
  return String(item?.productType || "").toLowerCase();
}

function isVoucherPackItem(item) {
  return productTypeKey(item) === "voucher_pack";
}

function isNoScheduleSkuItem(item) {
  return NO_SCHEDULE_CHECKOUT_TYPES.has(productTypeKey(item));
}

function isAddOnItem(item) {
  return ADDON_PRODUCT_TYPES.has(productTypeKey(item));
}

// Sell-screen mode toggle — segmented pill in the page header that
// switches between the two operating contracts the user defined:
//
//   • Check-in: walk-in. Session products auto-pick the nearest open
//               slot today; autoCheckIn fires on payment so participants
//               are admitted in the same transaction.
//   • Booking:  future visit. Session products ALWAYS open the schedule
//               picker (cashier picks date + time). autoCheckIn stays
//               off so the booking lands unredeemed.
//
// The active half is color-coded so the cashier reads the mode at a
// glance without parsing labels: green for "do it now" check-in, blue
// for "plan ahead" booking. Mode persists in localStorage (see the
// useEffect next to the state declaration in CashierApp).
function SellModeToggle({ mode, onChange }) {
  const Half = ({ value, label, icon, activeBg, activeBorder, activeFg }) => {
    const active = mode === value;
    return (
      <button
        type="button"
        onClick={() => onChange(value)}
        title={
          value === "checkin"
            ? "Check-in mode — walk-ins for today's sessions"
            : "Booking mode — future visits, pick the slot"
        }
        style={{
          appearance: "none",
          cursor: "pointer",
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          padding: "5px 12px",
          borderRadius: 999,
          border: active ? `1.5px solid ${activeBorder}` : "1.5px solid transparent",
          background: active ? activeBg : "transparent",
          color: active ? activeFg : "var(--ink-500)",
          fontSize: 12,
          fontWeight: 900,
          letterSpacing: "0.04em",
          textTransform: "uppercase",
        }}
      >
        <Icon name={icon} size={13} stroke={2.5} />
        {label}
      </button>
    );
  };
  return (
    <div
      title={`Sell mode: ${mode === "booking" ? "Booking" : "Check-in"}`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 2,
        padding: 3,
        background: "var(--ink-50)",
        border: "1.5px solid var(--ink-200)",
        borderRadius: 999,
      }}
    >
      <Half
        value="checkin"
        label="Check-in"
        icon="log-in"
        activeBg="#EAF8EF"
        activeBorder="#8AD5A3"
        activeFg="#137A35"
      />
      <Half
        value="booking"
        label="Booking"
        icon="calendar-clock"
        activeBg="#EFF6FF"
        activeBorder="#9DC4F0"
        activeFg="#1D4ED8"
      />
    </div>
  );
}

// Floating "Add to order" popup — closable + drag-to-move panel that
// surfaces every add-on / stock-item in the catalog as a one-tap chip.
// Anchored inside the catalog-column wrapper (position:relative), so the
// drag bounds clamp naturally to that container instead of escaping into
// the sidebar or cart panel.
//
// Lifecycle (no explicit teardown needed):
//   • shows when cart has a non-add-on item AND not user-dismissed
//   • close button hides it until cart clears (next sale)
//   • clearCart() on completed payment resets the dismissed flag
//
// One tap routes through the same addItem path the catalog tiles use,
// so multi-variation add-ons open the same VariantPickerDialog the cashier
// already knows from the main grid.
function AddOnSuggestionPopup({ suggestions, cartCounts, onAdd, position, onMove, onClose }) {
  const panelRef = React.useRef(null);
  const dragRef = React.useRef(null);

  const onPointerDown = (e) => {
    const panel = panelRef.current;
    if (!panel) return;
    const rect = panel.getBoundingClientRect();
    dragRef.current = {
      pointerId: e.pointerId,
      offsetX: e.clientX - rect.left,
      offsetY: e.clientY - rect.top,
      width: rect.width,
      height: rect.height,
    };
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch {}
    e.preventDefault();
  };
  const onPointerMove = (e) => {
    const drag = dragRef.current;
    const panel = panelRef.current;
    if (!drag || !panel || drag.pointerId !== e.pointerId) return;
    const parent = panel.offsetParent;
    if (!parent) return;
    const parentRect = parent.getBoundingClientRect();
    // Compute next top-left relative to the parent, clamp inside it.
    let nextX = e.clientX - parentRect.left - drag.offsetX;
    let nextY = e.clientY - parentRect.top - drag.offsetY;
    nextX = Math.max(8, Math.min(nextX, parentRect.width - drag.width - 8));
    nextY = Math.max(8, Math.min(nextY, parentRect.height - drag.height - 8));
    onMove?.({ x: nextX, y: nextY });
  };
  const onPointerUp = (e) => {
    if (dragRef.current?.pointerId !== e.pointerId) return;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch {}
    dragRef.current = null;
  };

  // Default anchor: top-right corner of the catalog column.
  const style = position
    ? { left: position.x, top: position.y, right: "auto" }
    : { right: 20, top: 70 };

  return (
    <div
      ref={panelRef}
      style={{
        position: "absolute",
        ...style,
        width: 280,
        maxHeight: "60vh",
        background: "white",
        border: "2px solid var(--ink-800)",
        borderRadius: 14,
        boxShadow: "0 8px 0 var(--ink-800)",
        zIndex: 30,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "8px 10px 8px 14px",
          background: "#FFF8EE",
          borderBottom: "1.5px solid #F2CA65",
          cursor: "grab",
          userSelect: "none",
          touchAction: "none",
          flexShrink: 0,
        }}
      >
        <Icon name="plus-circle" size={14} stroke={2.5} style={{ color: "#8A5A00" }} />
        <span style={{
          fontSize: 11, fontWeight: 900, letterSpacing: "0.06em",
          textTransform: "uppercase", color: "#8A5A00", flex: 1,
        }}>
          Add to order
        </span>
        <button
          type="button"
          onClick={onClose}
          title="Hide — re-open from the tab on the right"
          style={{
            all: "unset",
            cursor: "pointer",
            width: 24,
            height: 24,
            borderRadius: 6,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#8A5A00",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(138,90,0,0.12)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
        >
          <Icon name="x" size={14} stroke={3} />
        </button>
      </div>
      <div style={{
        flex: 1,
        minHeight: 0,
        overflowY: "auto",
        overscrollBehavior: "contain",
        padding: "8px 10px",
        display: "flex",
        flexDirection: "column",
        gap: 6,
      }}>
        {suggestions.map(({ item, section }) => {
          const countKey = String(item.activityId || item.id || "");
          const inCart = cartCounts.get(countKey) || 0;
          const hasChoices = (item.variationOptions || []).length > 1;
          const lowestVariationPrice = hasChoices
            ? (item.variationOptions || []).reduce(
                (min, v) => Math.min(min, Number(v.price ?? Infinity)),
                Infinity
              )
            : Number(item.price);
          const priceLabel = Number.isFinite(lowestVariationPrice)
            ? `${hasChoices ? "From " : ""}$${lowestVariationPrice.toFixed(lowestVariationPrice % 1 === 0 ? 0 : 2)}`
            : "";
          return (
            <button
              key={countKey + "::" + (item.id || "")}
              type="button"
              onClick={() => onAdd(item, section)}
              title={item.name}
              style={{
                appearance: "none",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "8px 10px",
                border: inCart > 0 ? "1.5px solid var(--aero-orange-500)" : "1.5px solid var(--ink-200)",
                background: inCart > 0 ? "var(--aero-orange-50, #FFF1E8)" : "white",
                color: inCart > 0 ? "var(--aero-orange-700)" : "var(--ink-900)",
                borderRadius: 10,
                fontSize: 13,
                fontWeight: 700,
                textAlign: "left",
                width: "100%",
                boxSizing: "border-box",
              }}
            >
              <Icon name="plus-circle" size={14} stroke={2.5} />
              <span style={{
                flex: 1, minWidth: 0,
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              }}>
                {item.name}
              </span>
              {priceLabel && (
                <span style={{
                  fontSize: 12,
                  fontWeight: 800,
                  color: inCart > 0 ? "var(--aero-orange-700)" : "var(--ink-600)",
                  flexShrink: 0,
                }}>
                  {priceLabel}
                </span>
              )}
              {inCart > 0 && (
                <span style={{
                  padding: "0 6px",
                  fontSize: 11,
                  fontWeight: 950,
                  background: "var(--aero-orange-500)",
                  color: "white",
                  borderRadius: 999,
                  lineHeight: "16px",
                  flexShrink: 0,
                }}>
                  ×{inCart}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// Collapsed re-open tab — small pill on the right edge of the catalog
// column. Appears only when the cashier has dismissed the popup but
// suggestions are still relevant; one tap restores the popup at its
// last-known position.
function AddOnReopenTab({ onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title="Show add-on suggestions"
      style={{
        position: "absolute",
        right: 0,
        top: 100,
        zIndex: 25,
        appearance: "none",
        cursor: "pointer",
        background: "#FFF8EE",
        border: "1.5px solid #F2CA65",
        borderRight: "none",
        borderTopLeftRadius: 10,
        borderBottomLeftRadius: 10,
        padding: "8px 10px 8px 12px",
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        fontSize: 11,
        fontWeight: 900,
        letterSpacing: "0.06em",
        textTransform: "uppercase",
        color: "#8A5A00",
        boxShadow: "0 3px 0 var(--ink-800)",
      }}
    >
      <Icon name="plus-circle" size={13} stroke={2.5} />
      Add-ons
    </button>
  );
}

function getApiErrorMessage(err, fallback) {
  const errors = Array.isArray(err?.data?.errors) ? err.data.errors : [];
  if (errors.length) {
    return errors
      .map((entry) => (typeof entry === "string" ? entry : entry?.message || entry?.error || ""))
      .filter(Boolean)
      .join(" ");
  }
  return err?.data?.message || err?.data?.error || err?.message || fallback;
}

// Allocate a cart's discount/tax/total across N lines so the sum of the
// line amounts equals the cart amounts exactly. Without this, naïve
// per-line rounding (Math.round each ratio independently) drifts by 1–2¢
// on multi-line carts because each line rounds in its own direction.
//
// Strategy: ratio-based allocation in integer cents for the first N-1
// lines, and the LAST line absorbs whatever's left. So if cart tax is
// $1.00 split 3 ways, the first two lines get $0.33 and the third gets
// $0.34 — total matches.
function allocateCartPricingToLines(lines, cartPricing) {
  const fallbackSubtotal = lines.reduce(
    (s, it) => s + Number(it?.subtotal ?? getCartLineSubtotal(it) ?? 0),
    0
  );
  const cartSubtotal = Number(cartPricing?.subtotal) || fallbackSubtotal || 0;
  const cartDiscountCents = Math.round((Number(cartPricing?.discount?.amount) || 0) * 100);
  const cartTaxCents = Math.round((Number(cartPricing?.tax) || 0) * 100);
  const cartTotalCents = Number.isFinite(Number(cartPricing?.total))
    ? Math.round(Number(cartPricing.total) * 100)
    : Math.round(cartSubtotal * 100) - cartDiscountCents + cartTaxCents;

  let remainingDiscount = cartDiscountCents;
  let remainingTax = cartTaxCents;
  let remainingTotal = cartTotalCents;

  return lines.map((line, idx) => {
    const subtotal = Number(line?.subtotal ?? getCartLineSubtotal(line) ?? 0);
    const isLast = idx === lines.length - 1;
    let discountCents;
    let taxCents;
    let totalCents;
    if (isLast) {
      discountCents = remainingDiscount;
      taxCents = remainingTax;
      totalCents = remainingTotal;
    } else {
      const ratio = cartSubtotal > 0 ? subtotal / cartSubtotal : 0;
      discountCents = Math.round(cartDiscountCents * ratio);
      taxCents = Math.round(cartTaxCents * ratio);
      totalCents = Math.round(cartTotalCents * ratio);
      remainingDiscount -= discountCents;
      remainingTax -= taxCents;
      remainingTotal -= totalCents;
    }
    return {
      subtotalAmount: subtotal,
      discountCode: cartPricing?.discount?.code || null,
      discountName: cartPricing?.discount?.name || null,
      discountType: cartPricing?.discount?.type || null,
      discountValue: cartPricing?.discount?.value || 0,
      discountMaxValue: cartPricing?.discount?.maxValue || 0,
      discountAmount: discountCents / 100,
      taxAmount: taxCents / 100,
      grandTotal: totalCents / 100,
      totalAmount: totalCents / 100,
      // Explicit membership redemptions land on the FIRST (regular) line
      // only — voucher lines are independent bookings that don't get
      // member discounts. lineId is optional; backend auto-picks the
      // matching cart line server-side.
      membershipRedemptions: idx === 0
        ? (Array.isArray(cartPricing?.membershipRedemptions) ? cartPricing.membershipRedemptions : [])
        : [],
    };
  });
}

export function CashierApp() {
  const { user, locations } = useSelector((s) => s.auth);

  // The paired terminal is the source of truth for location scope —
  // bookings, tickets, devices and presets are all filtered by the
  // locationId on the backend (via getLocationFromRequest → cookie). The
  // login flow seeds the cookie from the user's first location, which
  // is wrong when a multi-location user paired to a different location.
  // Force the cookie to match the paired terminal so all subsequent
  // API calls are scoped to the correct location.
  const pairedLocationId = (() => {
    try { return JSON.parse(localStorage.getItem("cashier:terminal") || "null")?.locationId; }
    catch { return null; }
  })();
  if (pairedLocationId && String(Cookies.get("locationId")) !== String(pairedLocationId)) {
    // Visible warning so the next dev to debug "why am I scoped to the
    // wrong location?" can find the override in a few seconds instead
    // of a few hours. Should fire only at terminal pair-mismatch boundaries.
    console.warn(
      `[cashier] locationId cookie (${Cookies.get("locationId")}) does not match paired terminal location (${pairedLocationId}). Overriding cookie.`
    );
    Cookies.set("locationId", pairedLocationId, { expires: 2 / 24 });
  }
  const locationId = Cookies.get("locationId");

  const dispatch = useDispatch();
  const [logoutCall] = useLogoutMutation();
  const handleEndShift = async () => {
    try { await logoutCall().unwrap(); } catch { /* noop */ }
    dispatch(clearCart());
    dispatch(baseApi.util.resetApiState());
    dispatch(logoutAction());
    toast.success("Shift ended. Please clock in for the next cashier session.");
  };

  // Routing: hash routes drive the active screen. CashierApp itself never
  // unmounts on tab change (it's the parent of <Routes>), so all the cart
  // useState below survives navigation between Sell ↔ Check-in ↔ Find etc.
  const navigate = useNavigate();
  const location = useLocation();
  const screen = (location.pathname.split("/")[1] || "sell").toLowerCase();
  const setScreen = (id) => navigate(`/${id}`);
  // ── Persisted cart state (cartSlice + redux-persist) ──────────────
  // Local wrappers below preserve the `setX(prev => ...)` functional-
  // update API the rest of this file uses, so we don't have to touch
  // every call site.
  const cart = useSelector((s) => s.cart);
  const items = cart.items;
  const cartCustomer = cart.cartCustomer;
  const waiversAttached = cart.waiversAttached;
  const ticketAssignments = cart.ticketAssignments;
  const appliedBenefits = cart.appliedBenefits || { promo: null, member: null, vouchers: [], payments: [] };
  const checkoutKey = cart.checkoutKey;
  const setItems = React.useCallback(
    (updater) => dispatch(setCartItems(typeof updater === "function" ? updater(items) : updater)),
    [dispatch, items]
  );
  const setCartCustomer = React.useCallback(
    (updater) => dispatch(setCartCustomerAction(typeof updater === "function" ? updater(cartCustomer) : updater)),
    [dispatch, cartCustomer]
  );
  const setWaiversAttached = React.useCallback(
    (updater) => dispatch(setWaiversAttachedAction(typeof updater === "function" ? updater(waiversAttached) : updater)),
    [dispatch, waiversAttached]
  );
  const setTicketAssignments = React.useCallback(
    (updater) => dispatch(setTicketAssignmentsAction(typeof updater === "function" ? updater(ticketAssignments) : updater)),
    [dispatch, ticketAssignments]
  );
  const setAppliedBenefits = React.useCallback(
    (updater) => dispatch(setAppliedBenefitsAction(typeof updater === "function" ? updater(appliedBenefits) : updater)),
    [dispatch, appliedBenefits]
  );

  const [createdBookingId, setCreatedBookingId] = useState(null);
  // When a sale is committed, the new booking + summary lands here and
  // CashierPaymentDialog opens. Same UX as the check-in screen's "Take
  // payment" modal.
  //
  // Intentionally NOT persisted: a half-open payment dialog should not
  // survive a refresh (network conditions may have changed; the cashier
  // should consciously re-trigger from the cart).
  const [paymentBooking, setPaymentBooking] = useState(null);
  const [cartPricing, setCartPricing] = useState(null);

  // No pendingPaymentBooking cache — the draft is rebuilt from the
  // current cart state on every Take Payment click. Retry-dedupe is
  // handled by the Redux-persisted checkoutKey (see ensureCheckoutKey),
  // which gives all retries of the same checkout the same idempotency
  // key without us needing to freeze the draft payload.

  const [checkoutBlocker, setCheckoutBlocker] = useState(null);
  const [scheduleRequiredItem, setScheduleRequiredItem] = useState(null);
  // Multi-variation add-on tapped from the "Add to order" strip — opens
  // the same VariantPickerDialog the catalog tiles use.
  const [addOnVariantPicker, setAddOnVariantPicker] = useState(null);
  // Sell-screen operating mode (per-tablet, persisted so a reload keeps
  // the cashier in the lane they were in):
  //   "checkin"  → walk-in flow. Session products auto-pick the nearest
  //               open slot today; only fall back to the schedule picker
  //               when nothing's available. autoCheckIn fires on payment.
  //   "booking"  → future-booking flow. Every session product opens the
  //               schedule picker so the cashier can pick a date/time.
  //               autoCheckIn stays off; the booking is created unredeemed.
  const [sellMode, setSellMode] = useState(() => {
    try {
      const cached = localStorage.getItem("cashier:sellMode");
      return cached === "booking" ? "booking" : "checkin";
    } catch { return "checkin"; }
  });
  useEffect(() => {
    try { localStorage.setItem("cashier:sellMode", sellMode); } catch {}
  }, [sellMode]);
  // Floating add-on popup state — position is draggable; dismissed flag
  // hides the panel until the next sale (cleared in completeDraftCheckout
  // when clearCart() runs). Position is held in CashierApp so it survives
  // strip remount when cart-state derivations re-render.
  const [addOnPopupPos, setAddOnPopupPos] = useState(null); // {x, y} or null = default anchor
  const [addOnPopupDismissed, setAddOnPopupDismissed] = useState(false);
  const [member] = useState(null);
  const [waiverModalOpen, setWaiverModalOpen] = useState(false);
  const [waiverModalMode, setWaiverModalMode] = useState("customer");
  const [recipientAssignments, setRecipientAssignments] = useState({});
  const [recipientPicker, setRecipientPicker] = useState(null);

  // Pool of waiver-covered people available for the cart. One waiver
  // contributes the signer plus each minor on it. The order here is
  // the natural assignment order when auto-filling.
  const waiverPool = useMemo(() => {
    const out = [];
    for (const w of waiversAttached) {
      const signer = {
        key: `${w.signatureId}:signer`,
        signatureId: w.signatureId,
        kind: "signer",
        name: w.name,
        primaryName: w.name,
      };
      const minors = Array.isArray(w.minors) ? w.minors : [];
      const minorPeople = [];
      for (let i = 0; i < minors.length; i += 1) {
        minorPeople.push({
          key: `${w.signatureId}:minor:${i}`,
          signatureId: w.signatureId,
          kind: "minor",
          name: minors[i]?.name || `Minor ${i + 1}`,
          primaryName: w.name,
        });
      }
      const people = [signer, ...minorPeople];
      const preferredIndex = people.findIndex(
        (person) => person.key === w.preferredAssignmentKey
      );
      if (preferredIndex > 0) {
        const [preferred] = people.splice(preferredIndex, 1);
        people.unshift(preferred);
      }
      out.push(...people);
    }
    return out;
  }, [waiversAttached]);

  const waiverSpotCount = useMemo(
    () => items.reduce((n, it) => n + (it.requiresWaiver ? it.qty : 0), 0),
    [items]
  );

  // Reconcile assignments whenever the pool or spot count changes.
  // Drops keys for waivers that have been detached, then auto-fills
  // any still-empty spots with the next available pool member.
  // Cashier overrides (manual detach/reassign) survive as long as the
  // referenced person is still in the pool.
  React.useEffect(() => {
    setTicketAssignments((prev) => {
      const validKeys = new Set(waiverPool.map((p) => p.key));
      const next = {};
      const used = new Set();
      for (let i = 0; i < waiverSpotCount; i += 1) {
        const k = prev[i];
        if (k && validKeys.has(k) && !used.has(k)) {
          next[i] = k;
          used.add(k);
        }
      }
      for (let i = 0; i < waiverSpotCount; i += 1) {
        if (next[i]) continue;
        const free = waiverPool.find((p) => !used.has(p.key));
        if (!free) break;
        next[i] = free.key;
        used.add(free.key);
      }
      return next;
    });
  }, [waiverPool, waiverSpotCount]);

  // Auto-attach the customer's existing waiver when:
  //   • a customer is on the cart (cartCustomer)
  //   • the cart has at least one waiver-required spot
  //   • no waivers have been attached yet (waiversAttached is empty)
  //
  // Without this, simple adult-only sales force the cashier through
  // the "Find waiver" search even though the customer already has a
  // completed waiver on file. We do a quick searchWaivers by the
  // customer's email/phone, take the first completed signature, and
  // append it to waiversAttached — the auto-fill effect above then
  // binds it to the spot, flipping the cart from "0 of 1 covered"
  // to "1 of 1 covered" without any cashier action.
  const [triggerWaiverSearch] = useLazySearchWaiversQuery();
  const autoWaiverLookupRef = React.useRef({ guestId: null, inFlight: false });
  React.useEffect(() => {
    const guestId = Number(cartCustomer?.guestId || 0) || null;
    if (!guestId) return;
    if (waiverSpotCount <= 0) return;
    if (waiversAttached.length > 0) return;
    if (autoWaiverLookupRef.current.inFlight) return;
    if (autoWaiverLookupRef.current.guestId === guestId) return;
    // Use the customer's email (preferred) or phone as the search
    // term — searchWaivers does a fuzzy match against signer name,
    // email and phone.
    const term =
      (cartCustomer.contactEmail || cartCustomer.email || "").trim()
      || (cartCustomer.contactPhone || cartCustomer.phone || "").trim()
      || (cartCustomer.name || "").trim();
    if (!term || term.length < 2) return;
    autoWaiverLookupRef.current = { guestId, inFlight: true };
    (async () => {
      try {
        const res = await triggerWaiverSearch({
          search: term,
          limit: 12,
          contactOnly: true,
        }).unwrap();
        const rows = Array.isArray(res?.data) ? res.data : [];
        // Match the customer's guestId precisely — searchWaivers may
        // return overlapping name hits for unrelated guests, and we
        // don't want to attach the wrong person's waiver.
        const hit = rows.find((row) => {
          const rowGuestId = Number(row?.guestId || row?.guest?.guestId || 0) || null;
          return rowGuestId && rowGuestId === guestId;
        });
        if (!hit) return;
        const signatureId = Number(hit.signatureId ?? hit.id);
        if (!Number.isFinite(signatureId) || signatureId <= 0) return;
        const signerName = hit.signedBy
          || hit.signedByName
          || hit.guest?.guestName
          || hit.name
          || cartCustomer.name
          || "Guest";
        const contactEmail = hit.guest?.guestEmail || hit.email || cartCustomer.contactEmail || "";
        const contactPhone = hit.guest?.guestPhone || hit.phone || cartCustomer.contactPhone || "";
        const minorList = Array.isArray(hit.minors) ? hit.minors : [];
        const minorCount = hit.includesMinors === false ? 0 : minorList.length;
        setWaiversAttached((prev) => {
          if (prev.some((w) => Number(w.signatureId) === signatureId)) return prev;
          return [
            ...prev,
            {
              signatureId,
              name: signerName,
              selectedHolderName: signerName,
              contact: contactEmail || contactPhone || "",
              contactEmail,
              contactPhone,
              minorCount,
              coverage: 1 + minorCount,
              preferredAssignmentKey: `${signatureId}:signer`,
              minors: minorList.slice(0, minorCount),
            },
          ];
        });
      } catch {
        // Swallow — cashier can still use "Find waiver" manually.
      } finally {
        autoWaiverLookupRef.current.inFlight = false;
      }
    })();
  }, [cartCustomer, waiverSpotCount, waiversAttached.length, triggerWaiverSearch, setWaiversAttached]);

  const [createBooking, { isLoading: isCreating }] = useCreateBookingMutation();
  const [validateCart, { isLoading: isValidatingCart }] = useValidateCartMutation();
  const [fetchAvailability] = useLazyGetAvailabilityQuery();
  // Walk-in slot auto-pick thresholds (terminal-configurable, default 15).
  const posSettings = useEffectiveSettings();
  // Product id currently being auto-scheduled (nearest-slot lookup in
  // flight) so the catalog tile can show a spinner instead of feeling dead.
  const [autoSchedulingId, setAutoSchedulingId] = useState(null);

  React.useEffect(() => {
    setCheckoutBlocker(null);
  }, [items, cartCustomer, waiversAttached, ticketAssignments]);

  // ── Resolve which template to load ─────────────────────────────────
  // The terminal is paired (PairTerminal page) before the user logs in;
  // the device record comes from localStorage. Falls back to the first
  // device for the location if pairing somehow vanished mid-session.
  const pairedTerminal = getTerminal();
  // /pos/devices needs ?locationId — getLocationFromRequest reads query first.
  // Cashier's token doesn't carry session-style context the way admin does.
  const { data: devicesData } = useGetAllPosDevicesQuery(
    pairedTerminal?.locationId || locationId
  );
  const devices = devicesData?.data || devicesData || [];
  const myDevice = useMemo(() => {
    if (pairedTerminal?.deviceId) {
      const fromList = devices.find(
        (d) => String(d.posDeviceId || d.deviceId) === String(pairedTerminal.deviceId)
      );
      // Fall back to the local pairing snapshot if device list hasn't loaded yet
      return fromList || {
        posDeviceId: pairedTerminal.deviceId,
        deviceId: pairedTerminal.deviceId,
        name: pairedTerminal.deviceName,
        deviceName: pairedTerminal.deviceName,
        locationId: pairedTerminal.locationId,
        locationName: pairedTerminal.locationName,
        templateId: pairedTerminal.templateId,
        posTemplateId: pairedTerminal.templateId,
      };
    }
    return devices.find((d) => String(d.locationId) === String(locationId)) || devices[0] || null;
  }, [devices, locationId, pairedTerminal?.deviceId]);
  const templateId =
    myDevice?.posTemplateId || myDevice?.templateId || myDevice?.presetId || pairedTerminal?.templateId;
  const terminalDeviceId = pairedTerminal?.deviceId || myDevice?.posDeviceId || myDevice?.deviceId;

  // Heartbeat — bump lastSeenAt every 60 s while the cashier app is open. The
  // response carries fresh effective settings, so we refresh the cached
  // terminal settings live; admin edits take effect within a beat (no re-pair).
  const [heartbeat] = useDeviceHeartbeatMutation();
  React.useEffect(() => {
    if (!terminalDeviceId) return;
    const tick = async () => {
      try {
        const res = await heartbeat({ deviceId: terminalDeviceId, appVersion: "0.1.0" }).unwrap();
        if (res?.settings) updateTerminalSettings(res.settings);
      } catch { /* offline / transient — keep last good settings */ }
    };
    tick();
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, [terminalDeviceId, heartbeat]);

  // Attach the global barcode-scanner listener for the duration of the
  // signed-in cashier session. Burst-detection rules out human typing,
  // so this fires only for actual USB-HID scans. Subscribers listen on
  // the `cashier:scan` window event (see Redeem.jsx).
  React.useEffect(() => attachScannerListener(), []);

  // Wristband Sidecar bridge (RFID mode only). Reads bridgePort from
  // the terminal's locally-cached wristbandConfig.rfid; falls back to
  // 7777 if the terminal hasn't synced its venue settings yet. Auto-
  // reconnects with backoff if the sidecar restarts or the tablet
  // wakes from sleep. Idempotent — safe across re-renders.
  React.useEffect(() => {
    let cached;
    try {
      cached = JSON.parse(localStorage.getItem("cashier:terminal") || "null");
    } catch { cached = null; }
    const mode = cached?.settings?.wristbandMode || cached?.wristbandMode || "none";
    if (mode !== "rfid") return;
    const port =
      Number(cached?.settings?.wristbandConfig?.rfid?.bridgePort) ||
      Number(cached?.wristbandConfig?.rfid?.bridgePort) ||
      7777;
    startWristbandBridge({ port });
    return () => stopWristbandBridge();
  }, []);

  const {
    data: presetData,
    isLoading: presetLoading,
    error: presetError,
  } = useGetPresetFullQuery(templateId, { skip: !templateId });

  const sections = useMemo(
    () => normalizePresetSections(presetData?.data || presetData),
    [presetData]
  );

  // ── Cart actions ──────────────────────────────────────────────────
  const buildCartLine = (productItem, section) => {
    const meta = productItem.meta || productItem.sub || section?.title || "";
    // Clean section title kept for re-scheduling (Change time) so the meta
    // label isn't rebuilt from a previous meta — see buildScheduledLine.
    const sectionTitle = productItem.sectionTitle || section?.title || productItem.sub || "";
    const initialQty = clampCartQuantity(
      productItem,
      productItem.qty ?? getDefaultCartQuantity(productItem)
    );

    return {
      id: productItem.id,
      activityId: productItem.activityId,
      variationId: productItem.variationId,
      variationName: productItem.variationName,
      variationOptions: productItem.variationOptions || [],
      productType: productItem.productType,
      name: productItem.name,
      meta,
      sectionTitle,
      price: Number.isFinite(productItem.price) ? productItem.price : 0,
      pricingMode: productItem.pricingMode || null,
      includedGuests: productItem.includedGuests ?? null,
      additionalPersonPrice: productItem.additionalPersonPrice ?? null,
      minGuests: productItem.minGuests ?? null,
      maxGuests: productItem.maxGuests ?? null,
      slotId: productItem.slotId || null,
      selectedDate: productItem.selectedDate || productItem.date || null,
      timeRange: productItem.timeRange || null,
      bundleInclusions: productItem.bundleInclusions || [],
      choiceSelections: productItem.choiceSelections || {},
      resourceSelections: productItem.resourceSelections || {},
      qty: initialQty,
      icon: productItem.icon,
      featured: productItem.featured,
      requiresWaiver: !!productItem.requiresWaiver,
      isVoucherPack: isVoucherPackItem(productItem),
    };
  };

  // Append a finished cart line, merging into an existing identical line
  // (same product + same scheduled slot) by bumping its quantity.
  const pushCartLine = (cartLine) => {
    setItems((prev) => {
      const idx = prev.findIndex((x) => x.id === cartLine.id && x.meta === cartLine.meta);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...next[idx], qty: clampCartQuantity(next[idx], next[idx].qty + 1) };
        return next;
      }
      return [...prev, cartLine];
    });
  };

  // POS quick-checkout: a walk-in wants the soonest slot. Look up today's
  // availability and auto-assign the nearest bookable session/variation/
  // resource so the line drops straight into the cart — no dialog. The
  // cashier can fine-tune via "Change time" on the cart line. We only
  // open the picker as a fallback (nothing free today, no activityId, or
  // an availability lookup error) so a sale is never hard-blocked.
  const autoAssignAndAdd = async (productItem, section) => {
    const activityId = productItem.activityId;
    if (!activityId) {
      setScheduleRequiredItem({ item: productItem, section });
      return;
    }
    const today = formatDateValue(new Date());
    setAutoSchedulingId(productItem.id);
    try {
      const res = await fetchAvailability({ date: today, activityId }, true).unwrap();
      const data = res?.data || res || {};
      const sessions = Array.isArray(data.sessions) ? data.sessions : [];
      const now = new Date();
      const nowMinutes = now.getHours() * 60 + now.getMinutes();
      const graceMinutes = Number.isFinite(Number(posSettings.joinGraceMinutes))
        ? Number(posSettings.joinGraceMinutes)
        : 15;
      const minRemainingMinutes = Number.isFinite(Number(posSettings.minRemainingMinutes))
        ? Number(posSettings.minRemainingMinutes)
        : 0; // 0 = remaining-time rule off (join window only)
      const line = autoScheduleLine({
        item: productItem,
        section,
        sessions,
        selectedDate: today,
        nowMinutes,
        graceMinutes,
        minRemainingMinutes,
      });
      if (!line) {
        toast.message(`No open slot today for ${productItem.name} — pick a time.`);
        setScheduleRequiredItem({ item: productItem, section });
        return;
      }
      pushCartLine(buildCartLine(line, section));
      toast.success(`${line.name} · ${line.timeRange || "scheduled"}`);
    } catch {
      toast.error("Couldn't load availability — pick a time.");
      setScheduleRequiredItem({ item: productItem, section });
    } finally {
      setAutoSchedulingId(null);
    }
  };

  const addItem = (productItem, section) => {
    if (needsScheduleSelection(productItem) && !hasScheduleSelection(productItem)) {
      // Mode fork — see sellMode declaration for the contract.
      //   check-in: walk-in. Auto-assign nearest slot today; fall back to
      //             picker only when nothing's open.
      //   booking : future visit. Always open the picker so the cashier
      //             explicitly chooses date + time.
      if (sellMode === "booking") {
        setScheduleRequiredItem({ item: productItem, section });
        return;
      }
      autoAssignAndAdd(productItem, section);
      return;
    }
    pushCartLine(buildCartLine(productItem, section));
  };

  const editCartItem = (idx) => {
    const item = items[idx];
    if (!item || !needsScheduleSelection(item)) return;
    // Pass the CLEAN section title (not the displayed meta) so re-scheduling
    // rebuilds the label fresh instead of compounding "title - date - time".
    const title = item.sectionTitle || String(item.meta || "").split(" - ")[0] || "";
    setScheduleRequiredItem({ item, section: { title }, editIndex: idx });
  };

  const applyScheduledCartItem = (productItem, section) => {
    const editIndex = scheduleRequiredItem?.editIndex;
    if (Number.isInteger(editIndex)) {
      const cartLine = buildCartLine(productItem, section);
      setItems((prev) => prev.map((item, idx) => (idx === editIndex ? cartLine : item)));
      toast.success(`Updated ${cartLine.name}`);
      return;
    }
    addItem(productItem, section);
  };

  const removeItem = (idx) => {
    setItems((prev) => prev.filter((_, i) => i !== idx));
    setRecipientAssignments({});
  };
  const setQty = (idx, delta) =>
    setItems((prev) => {
      const n = [...prev];
      n[idx] = { ...n[idx], qty: clampCartQuantity(n[idx], n[idx].qty + delta) };
      return n;
    });

  // ── Cart → create booking ─────────────────────────────────────────
  // Builds the same payload shape as BookingConfirmation. Walk-in by
  // default; staff can finish guest details on the booking detail page.
  const completeDraftCheckout = async (payment) => {
    const draft = paymentBooking?.draft;
    if (!draft?.payload) {
      throw new Error("Checkout draft is no longer available.");
    }

    // Gift card pays via the gift-cards/redeem endpoint AFTER the booking
    // exists (it records the payment itself), so we create the booking
    // unpaid here — no payment payload baked in. The card TERMINAL is the
    // same shape: the booking must exist first so the Stripe Terminal
    // PaymentIntent can attach to it (sourceId=bookingId) and the finalizer
    // marks it paid on capture — so we also create it unpaid (no payment).
    const payByGiftCard = payment?.giftCard === true;
    const payByTerminal = payment?.terminal === true;
    const paymentPayload = (payByGiftCard || payByTerminal)
      ? {}
      : {
          amountPaid: Number(payment?.amountPaid || 0),
          paymentMethod: payment?.paymentMethod,
          // Reference (e.g. check number) recorded on the initial payment.
          referenceNumber: payment?.referenceNumber || null,
          paymentDetails: {
            tenderedAmount: Number(payment?.tenderedAmount || 0),
            changeDue: Number(payment?.changeDue || 0),
            terminalDeviceId: payment?.terminalDeviceId || null,
            remarks: payment?.remarks || "",
          },
        };
    const paidPricingSummary = buildPaidCheckoutPricingSummary(
      draft.payload.pricingSummary,
      payment
    );
    let bookingForReceipt = null;
    const recurringPaymentLinks = [];

    // Stable base key for this whole checkout. Sub-keys (":main", ":voucherN")
    // scope individual createBooking calls so a retried multi-booking checkout
    // dedupes per-line, not as a batch.
    const baseKey = checkoutKey || draft.checkoutKey || null;

    if (draft.regularItems.length > 0) {
      const res = await createBooking({
        ...draft.payload,
        pricingSummary: paidPricingSummary,
        ...paymentPayload,
        idempotencyKey: baseKey ? `${baseKey}:main` : undefined,
      }).unwrap();
      const data = res?.data || {};
      const bookingId = data.bookingId || res?.bookingId || res?.bookingMasterId || res?.id;
      setCreatedBookingId(bookingId);
      bookingForReceipt = {
        bookingId,
        bookingNumber: data.bookingNumber || res?.bookingNumber || "",
      };
    }

    let voucherSeq = 0;
    const voucherAllocations = Array.isArray(draft.voucherAllocations) ? draft.voucherAllocations : [];
    for (const item of draft.noScheduleItems) {
      const repeats = Math.max(1, Number(item.qty) || 1);
      for (let i = 0; i < repeats; i += 1) {
        const lineItem = { ...item, qty: 1 };
        const recipient = normalizeRecipientForCheckout(item.recipientUnits?.[i] || item.recipient || null);
        const recipientGuestInfo = recipient
          ? {
              guestId: recipient.guestId || null,
              guestName: recipient.name,
              guestEmail: recipient.contactEmail,
              guestPhone: recipient.contactPhone || "",
            }
          : draft.payload.guestInfo;
        const shouldCarryPayment = !bookingForReceipt;
        // voucherSeq is 1-indexed; allocation array is 0-indexed and ordered
        // identically to this loop. Fall back to a synthetic per-line
        // allocation if (somehow) we're out of sync.
        const allocation = voucherAllocations[voucherSeq] || {
          subtotalAmount: getCartLineSubtotal(lineItem),
          discountAmount: 0,
          taxAmount: 0,
          grandTotal: getCartLineSubtotal(lineItem),
          totalAmount: getCartLineSubtotal(lineItem),
        };
        voucherSeq += 1;
        const res = await createBooking({
          ...draft.payload,
          ...(shouldCarryPayment ? paymentPayload : {}),
          guestInfo: recipientGuestInfo,
          guestName: recipientGuestInfo?.guestName || draft.guestName,
          guestEmail: recipientGuestInfo?.guestEmail || draft.payload.guestEmail,
          guestPhone: recipientGuestInfo?.guestPhone || draft.payload.guestPhone,
          pricingSummary: buildPaidCheckoutPricingSummary(
            allocation,
            shouldCarryPayment ? payment : null
          ),
          sessions: undefined,
          waiverSignatureIds: undefined,
          activityIds: [Number(item.activityId)],
          variationId: item.variationId || null,
          bookingName: `${recipientGuestInfo?.guestName || draft.guestName} - ${item.name}`.trim(),
          deferWaiverEnforcement: true,
          idempotencyKey: baseKey ? `${baseKey}:voucher${voucherSeq}` : undefined,
        }).unwrap();
        const data = res?.data || {};
        const bookingId = data.bookingId || res?.bookingId || res?.bookingMasterId || res?.id;
        if (data.paymentLink || res?.paymentLink) {
          recurringPaymentLinks.push({
            url: data.paymentLink || res.paymentLink,
            name: item.name,
            bookingId,
          });
        } else if (data.paymentUnavailableReason) {
          toast.error(data.paymentUnavailableReason);
        }
        setCreatedBookingId(bookingId);
        if (!bookingForReceipt) {
          bookingForReceipt = {
            bookingId,
            bookingNumber: data.bookingNumber || res?.bookingNumber || "",
          };
        }
      }
    }

    // For the terminal path the booking is still UNPAID here — the card
    // hasn't been tapped yet. The terminal modal shows the approval toast,
    // so don't claim "completed" prematurely.
    if (recurringPaymentLinks.length > 0) {
      const first = recurringPaymentLinks[0];
      const opened = window.open(first.url, "_blank", "noopener,noreferrer");
      toast.success(
        opened
          ? `Recurring checkout opened for ${first.name || "membership"}`
          : "Recurring checkout link created. Open the booking and send the payment request if the popup was blocked."
      );
    } else if (!payByTerminal) {
      toast.success(`Order ${bookingForReceipt?.bookingNumber || ""} completed`);
    }
    return { ...bookingForReceipt, recurringPaymentLinks };
  };

  const handleCheckout = async () => {
    const blockCheckout = (type, message, item = null) => {
      setCheckoutBlocker({ type, message, itemId: item?.id || null, itemName: item?.name || null });
      toast.error(message);
    };
    setCheckoutBlocker(null);

    if (items.length === 0) {
      blockCheckout("empty", "Cart is empty.");
      return;
    }
    if (!locationId) {
      blockCheckout("location", "No location selected for this terminal.");
      return;
    }
    // (Old cache shortcut removed — every click rebuilds the draft
    // from the live cart. The Redux-stored checkoutKey gives all
    // retries of one checkout the same idempotency key, so dedupe
    // still works even though the draft is rebuilt each time.)

    // Mint an idempotency key for this checkout attempt if we don't have
    // one yet. Reused across retries (so the backend can dedupe a double-
    // submit on flaky wifi), rotated on successful completion.
    dispatch(ensureCheckoutKey());

    const primaryGuest = cartCustomer || waiversAttached[0] || null;
    // Sell-screen mode drives the waiver policy:
    //   • check-in → "beforePayment" — guest is here NOW, admission needs
    //                a signed waiver before we take payment.
    //   • booking  → "deferred" — future visit; waiver can be collected
    //                at the gate. Backend also gets deferWaiverEnforcement
    //                in the payload below so it doesn't reject the booking
    //                for missing coverage.
    const checkoutRequirements = getCheckoutRequirements(items, {
      customer: primaryGuest,
      waiverCoverage: Object.values(ticketAssignments).filter(Boolean).length,
      waiverPolicy: sellMode === "booking" ? "deferred" : "beforePayment",
    });
    const indexedItems = items.map((item, cartIndex) => ({ ...item, cartIndex }));
    const noScheduleItems = indexedItems
      .filter(isNoScheduleSkuItem)
      .map((item) => ({
        ...item,
        recipientUnits: Array.from({ length: Math.max(1, Number(item.qty) || 1) }, (_, unitIndex) =>
          normalizeRecipientForCheckout(
            recipientAssignments[`${item.cartIndex}:${unitIndex}`] || primaryGuest
          )
        ),
      }));
    const regularItems = indexedItems.filter((it) => !isNoScheduleSkuItem(it));
    const missingScheduleItems = checkoutRequirements.missingScheduleItems.filter(
      (item) => !isNoScheduleSkuItem(item)
    );
    if (missingScheduleItems.length > 0) {
      const item = missingScheduleItems[0];
      setScheduleRequiredItem({ item, section: { title: item.meta } });
      blockCheckout("schedule", `${item.name} needs a date and slot before payment.`, item);
      return;
    }
    if (checkoutRequirements.missingCustomer) {
      setWaiverModalMode("customer");
      setWaiverModalOpen(true);
      const item = checkoutRequirements.customerRequiredItems[0];
      blockCheckout("customer", "Add the booking customer with name and phone or email before taking payment.", item);
      return;
    }
    if (checkoutRequirements.missingChoices) {
      const item = checkoutRequirements.missingChoiceItems[0];
      if (item) setScheduleRequiredItem({ item, section: { title: item.meta } });
      blockCheckout("choices", `${item?.name || "This item"} needs required choices before payment.`, item);
      return;
    }
    if (checkoutRequirements.missingWaiver) {
      blockCheckout("waiver", "Add signed waiver coverage before taking payment.");
      return;
    }
    const scheduledDates = [
      ...new Set(
        regularItems
          .filter((item) => hasScheduleSelection(item))
          .map((item) => item.selectedDate || item.date)
          .filter(Boolean)
      ),
    ];
    if (scheduledDates.length > 1) {
      blockCheckout("schedule", "Please check out one booking date at a time.");
      return;
    }
    const bookingDate = scheduledDates[0] || formatDateValue(new Date());

    const sessions = regularItems
      .filter((it) => it.activityId)
      .map((it) => ({
        activityId: it.activityId,
        variationId: it.variationId,
        slotId: it.slotId || null,
        quantity: it.qty,
        isAddon: String(it.productType || "").toLowerCase().includes("add"),
        bundleInclusions: it.bundleInclusions || [],
        resourceSelections: it.resourceSelections || {},
        choiceSelections: it.choiceSelections || {},
        guestCount: it.qty,
      }));

    // Only send signature IDs that are actually bound to a ticket.
    // The pool can hold extra people (e.g. cashier added a waiver
    // covering 3 but only 2 spots needed); the backend should only
    // see the waivers we're actually using.
    const usedSignatureIds = Array.from(
      new Set(
        Object.values(ticketAssignments)
          .map((k) => Number(String(k).split(":")[0]))
          .filter((n) => Number.isFinite(n) && n > 0)
      )
    );
    // Walk-in name must be STABLE across retries. The previous code called
    // Math.random() inline, so a double-tap or network retry would create
    // two bookings under "Walk-in A7B2" and "Walk-in 9F3K". Derive from the
    // checkoutKey (which itself is stable across retries) so the same cart
    // attempt always produces the same name.
    const walkInSuffix = (cart.checkoutKey || "anon").slice(-4).toUpperCase();
    const guestName =
      primaryGuest?.name ||
      member?.name ||
      `Walk-in ${walkInSuffix}`;
    const guestEmail = primaryGuest?.contactEmail || member?.email || "";
    const guestPhone = primaryGuest?.contactPhone || member?.phone || "";
    if (noScheduleItems.length > 0 && !guestEmail) {
      blockCheckout("customer", "Select a customer with email before selling vouchers, memberships, or gift cards.");
      return;
    }
    // Build the flat list of lines that will receive their own pricingSummary:
    //   index 0: synthetic "regular" line representing the sum of regularItems
    //            (sent as one booking)
    //   index 1..N: one entry per voucher unit (each becomes its own booking)
    // Allocate cart-level tax/discount across these in a single pass so
    // sum(line amounts) === cart amounts exactly (no penny drift).
    const regularSubtotal = regularItems.reduce(
      (sum, item) => sum + getCartLineSubtotal(item),
      0
    );
    const expandedVoucherLines = noScheduleItems.flatMap((item) => {
      const repeats = Math.max(1, Number(item.qty) || 1);
      return Array.from({ length: repeats }, () => ({
        ...item,
        qty: 1,
        subtotal: getCartLineSubtotal({ ...item, qty: 1 }),
      }));
    });
    const allocationLines = [
      { kind: "regular", subtotal: regularSubtotal },
      ...expandedVoucherLines.map((it) => ({ kind: "voucher", item: it, subtotal: it.subtotal })),
    ];
    const lineAllocations = allocateCartPricingToLines(allocationLines, cartPricing);
    const regularAllocation = lineAllocations[0];
    const voucherAllocations = lineAllocations.slice(1);

    const payload = {
      locationId,
      date: bookingDate,
      bookingDate,
      sessions,
      // Backend (createBooking) recomputes coverage from these IDs and
      // rejects 400 if total spots covered < waiver-required quantity.
      waiverSignatureIds: usedSignatureIds,
      // createBooking expects a guestInfo object (find-or-create the
      // Guest record). Flat top-level fields are also kept for any
      // legacy callers that read them.
      guestInfo: {
        guestName,
        guestEmail,
        guestPhone,
      },
      guestName,
      guestEmail,
      guestPhone,
      bookingName: primaryGuest?.name || member?.name || "Walk-in",
      source: "cashier",
      notes: `Created by ${user?.first_name || user?.name || "cashier"} at terminal ${myDevice?.deviceName || myDevice?.name || "—"}`,
      // Pricing — includes promo code if the cashier applied one in CartPanel.
      // Backend's createBooking re-validates and recomputes; we just supply
      // the chosen discount so the booking record carries the right code.
      pricingSummary: regularAllocation,
      voucherTokens: Array.isArray(cartPricing?.appliedBenefits?.voucherTokens)
        ? cartPricing.appliedBenefits.voucherTokens
        : [],
      // Booking mode: future-visit booking, waiver gets collected at the
      // gate. Tell the backend not to reject for missing waiver coverage.
      // (The cart-side gate is also lifted via waiverPolicy: "deferred"
      // above so checkoutRequirements.missingWaiver stays false.)
      ...(sellMode === "booking" ? { deferWaiverEnforcement: true } : {}),
      // Walk-in flow: customer is paying NOW and walking in NOW. Tell
      // the backend to check in participants AND redeem their tickets
      // in the same transaction as the booking + payment.
      //
      // Sell-screen mode overrides the per-device default:
      //   • "checkin" → autoCheckIn ON (matches the per-device default
      //                 unless the device opts out)
      //   • "booking" → autoCheckIn OFF (future visit; redemption happens
      //                 at the gate later)
      autoCheckIn:
        sellMode === "booking"
          ? false
          : posSettings.autoCheckInOnPurchase !== false,
    };

    let validatedPricing = null;
    try {
      const validateRes = await validateCart({
        locationId,
        guestInfo: payload.guestInfo,
        // Send the chosen discount so the backend prices the same basis.
        pricingSummary: {
          discountAmount: Number(
            (cartPricing?.discount?.amount || 0) + (cartPricing?.memberDiscount || 0)
          ),
        },
        items: items.map((item, idx) => ({
          activityId: item.activityId,
          variationId: item.variationId,
          productType: item.productType,
          name: item.name,
          quantity: item.qty,
          // Line subtotal lets the backend price authoritatively without
          // re-deriving prices, then return the canonical tax + total.
          subtotal: getCartLineSubtotal(item),
          // Stable line key so the backend can attribute applied
          // benefits (vouchers / memberships) to a specific cart line.
          itemKey: `line-${idx}`,
          slotId: item.slotId || null,
          date: item.selectedDate || item.date || bookingDate,
          selectedDate: item.selectedDate || item.date || bookingDate,
          bundleInclusions: item.bundleInclusions || [],
          choiceSelections: item.choiceSelections || {},
        })),
        // Applied voucher tokens — backend resolves coverage via the
        // shared resolveVoucherCoverage utility and returns:
        //   pricing.voucherCoveredAmount
        //   pricing.outstandingAmount  (= totalAmount − voucherCovered)
        voucherTokens: Array.isArray(cartPricing?.appliedBenefits?.voucherTokens)
          ? cartPricing.appliedBenefits.voucherTokens
          : [],
      }).unwrap();
      validatedPricing = validateRes?.pricing || null;
    } catch (err) {
      const msg = getApiErrorMessage(err, "Cart failed validation.");
      blockCheckout("backend_validation", msg);
      return;
    }

    // Charge the backend's authoritative total when available (no tax drift),
    // falling back to the locally-computed cart pricing for older backends.
    const chargeTotal = validatedPricing
      ? Number(validatedPricing.totalAmount)
      : Number(cartPricing?.total ?? 0);
    const chargeSubtotal = validatedPricing
      ? Number(validatedPricing.subtotalAmount)
      : Number(cartPricing?.subtotal ?? 0);
    const chargeTax = validatedPricing
      ? Number(validatedPricing.taxAmount)
      : Number(cartPricing?.tax ?? 0);
    const chargeDiscount = validatedPricing
      ? Number(validatedPricing.discountAmount)
      : Number((cartPricing?.discount?.amount || 0) + (cartPricing?.memberDiscount || 0));
    // Voucher coverage from validate-cart. Drives the payment overlay's
    // balance — when vouchers fully cover the cart, balanceDue = 0 and
    // the cashier just confirms; no cash/card capture needed.
    const voucherCoveredAmount = validatedPricing
      ? Number(validatedPricing.voucherCoveredAmount) || 0
      : 0;
    const balanceDue = Math.max(0, chargeTotal - voucherCoveredAmount);

    const draftPayment = {
      draftSale: true,
      bookingNumber: "DRAFT SALE",
      totalAmount: chargeTotal,
      balanceDue,
      voucherCoveredAmount,
      subTotal: chargeSubtotal,
      taxAmount: chargeTax,
      discountAmount: chargeDiscount,
      discount: cartPricing?.discount || null,
      draft: {
        payload,
        regularItems,
        noScheduleItems,
        guestName,
        // Snapshot the checkout key into the draft so completeDraftCheckout
        // reads from a stable source even if Redux state changes between
        // payment-dialog mount and submit.
        checkoutKey: cart.checkoutKey,
        // Per-voucher pricing allocations precomputed alongside the regular
        // booking so all lines together sum exactly to the cart total (no
        // penny drift). One entry per voucher UNIT (qty expanded), matching
        // the per-unit loop in completeDraftCheckout.
        voucherAllocations,
      },
    };
    setCheckoutBlocker(null);
    setPaymentBooking(draftPayment);
  };

  // Sell catalog. (The earlier "Waves"/"Builder" layouts were demo
  // scaffolding with static data that produced un-checkout-able lines, so
  // they were removed — the live terminal template is the single source.)
  // The existing catalog search input doubles as a universal voucher /
  // entitlement / pack lookup. When the cashier types or scans a token
  // matching the redemption-token shape, CatalogGrid debounces and asks
  // the backend; on a hit, the catalog tiles are replaced with the
  // voucher's inclusions.
  //
  // Design choice: a voucher inclusion is added to the cart as a NORMAL
  // catalog item (same shape, same scheduling, same waiver gating) but
  // priced at $0 and tagged with voucher metadata. We resolve the
  // inclusion to its real catalog productItem by activityId + variationId
  // and pass that through the existing addItem path. This way every
  // downstream concern — requiresWaiver gate, schedule picker, customer
  // attach, ticket issuance — runs through the same code path as a paid
  // sale. The voucherToken / entitlementId on the line tells the
  // backend to decrement instead of charge at checkout.
  const handleAddVoucherInclusion = (inclusion, packContext) => {
    // Attach the voucher's customer to the cart (if any). CartPanel
    // reads {name, contact, contactEmail, contactPhone} — NOT
    // {guestName, guestEmail, ...}. The pack lookup nests guest under
    // `pack.guest`; the single-voucher / single-entitlement lookup
    // puts it on the payload root.
    const guest = packContext?.payload?.pack?.guest
      || packContext?.payload?.guest
      || packContext?.pack?.guest
      || null;
    if (guest?.guestId && !cartCustomer) {
      const gEmail = guest.guestEmail || guest.email || "";
      const gPhone = guest.guestPhone || guest.phone || "";
      setCartCustomer({
        guestId: guest.guestId,
        name: guest.guestName || guest.name || "Guest",
        contact: gEmail || gPhone || "",
        contactEmail: gEmail,
        contactPhone: gPhone,
      });
    }

    const qty = Math.max(1, Number(inclusion.qty) || 1);
    const voucherMeta = {
      isVoucherRedemption: true,
      voucherToken: inclusion.redemptionToken || null,
      voucherKind: inclusion.kind,
      voucherEntitlementId: inclusion.entitlementId || null,
      voucherBookingItemId: inclusion.bookingItemId || null,
    };
    // Stable suffix so two different vouchers for the same activity
    // don't merge into a single cart line (each carries its own
    // redemption token / entitlement id).
    const voucherIdSuffix = `::v:${inclusion.redemptionToken
      || inclusion.entitlementId
      || inclusion.bookingItemId
      || "x"}`;

    // Look up the real catalog productItem by activityId so the cart
    // line inherits requiresWaiver, productType, pricingMode, variation
    // metadata, and any other config from the live terminal template.
    let matchedProduct = null;
    let matchedSection = null;
    for (const section of sections || []) {
      for (const item of section.items || []) {
        if (item.activityId !== inclusion.activityId) continue;
        const vOk = !inclusion.variationId
          || item.variationId === inclusion.variationId
          || (item.variationOptions || []).some(
              (v) => v.variationId === inclusion.variationId
            );
        if (vOk) { matchedProduct = item; matchedSection = section; break; }
      }
      if (matchedProduct) break;
    }

    if (matchedProduct) {
      // If the inclusion picks a specific variation, override the
      // matched product's defaults with that variation's pricing /
      // capacity (we still zero the price below).
      const chosenVariation = inclusion.variationId
        ? (matchedProduct.variationOptions || []).find(
            (v) => v.variationId === inclusion.variationId
          )
        : null;
      const synthetic = {
        ...matchedProduct,
        ...(chosenVariation ? {
          variationId: chosenVariation.variationId,
          variationName: chosenVariation.name,
          pricingMode: chosenVariation.pricingMode || chosenVariation.pricingType || matchedProduct.pricingMode,
          includedGuests: chosenVariation.includedGuests ?? matchedProduct.includedGuests,
          additionalPersonPrice: chosenVariation.additionalPersonPrice ?? matchedProduct.additionalPersonPrice,
          minGuests: chosenVariation.minGuests ?? chosenVariation.minimumGuests ?? matchedProduct.minGuests,
          maxGuests: chosenVariation.maxGuests ?? chosenVariation.maximumGuests ?? matchedProduct.maxGuests,
        } : {}),
        id: `${matchedProduct.id}${voucherIdSuffix}`,
        price: 0,
        qty,
        ...voucherMeta,
        // If the voucher is already bound to a slot, pass it through so
        // the cart line skips the schedule picker.
        ...(inclusion.slotId ? {
          slotId: inclusion.slotId,
          selectedDate: inclusion.slotDate || null,
          timeRange: inclusion.slotTime || null,
        } : {}),
      };
      addItem(synthetic, matchedSection);
    } else {
      // Fallback: the inclusion's activity isn't on this terminal's
      // template (e.g. a Pizza Slice credit on a Parties terminal).
      // Still build a synthetic productItem carrying the backend-supplied
      // requiresWaiver so cart-side gating works.
      const synthetic = {
        id: `voucher${voucherIdSuffix}`,
        activityId: inclusion.activityId,
        variationId: inclusion.variationId || null,
        variationName: inclusion.variationName || inclusion.activityName,
        name: inclusion.activityName || "Voucher inclusion",
        sectionTitle: packContext?.payload?.pack?.name || "Voucher",
        price: 0,
        qty,
        requiresWaiver: !!inclusion.requiresWaiver,
        ...voucherMeta,
        ...(inclusion.slotId ? {
          slotId: inclusion.slotId,
          selectedDate: inclusion.slotDate || null,
          timeRange: inclusion.slotTime || null,
        } : {}),
      };
      addItem(synthetic, { title: packContext?.payload?.pack?.name || "Voucher" });
    }

    toast.success(
      `Added ${qty} × ${inclusion.activityName || "voucher item"}${guest?.guestName ? ` for ${guest.guestName}` : ""}`
    );
  };

  const findCatalogProductForRedeemable = (redeemable) => {
    const activityId = Number(redeemable?.activityId);
    const variationId = Number(redeemable?.variationId);
    if (!Number.isFinite(activityId)) return { product: null, section: null };
    for (const section of sections || []) {
      for (const item of section.items || []) {
        if (Number(item.activityId) !== activityId) continue;
        const matchesVariation =
          !Number.isFinite(variationId) ||
          Number(item.variationId) === variationId ||
          (item.variationOptions || []).some((v) => Number(v.variationId) === variationId);
        if (matchesVariation) return { product: item, section };
      }
    }
    return { product: null, section: null };
  };

  const buildRedeemCartProduct = (redeemable, kind) => {
    const { product, section } = findCatalogProductForRedeemable(redeemable);
    const variationId = Number(redeemable?.variationId);
    const chosenVariation = product && Number.isFinite(variationId)
      ? (product.variationOptions || []).find((v) => Number(v.variationId) === variationId)
      : null;
    const base = product || {
      id: `redeem-${kind}-${redeemable?.membershipId || redeemable?.bookingItemId || redeemable?.entitlementId || redeemable?.redemptionToken || Date.now()}`,
      activityId: redeemable?.activityId || null,
      variationId: redeemable?.variationId || null,
      variationName: redeemable?.variationName || null,
      productType: kind === "entitlement" ? "stock_item" : "session_pass",
      name: redeemable?.activityName || redeemable?.variationName || "Redeem item",
      sub: kind === "membership" ? "Membership benefit" : "Voucher redemption",
      price: Number(redeemable?.price) || 0,
      requiresWaiver: !!redeemable?.requiresWaiver,
    };
    return {
      ...base,
      ...(chosenVariation ? {
        variationId: chosenVariation.variationId,
        variationName: chosenVariation.name,
        pricingMode: chosenVariation.pricingMode || chosenVariation.pricingType || base.pricingMode,
        includedGuests: chosenVariation.includedGuests ?? base.includedGuests,
        additionalPersonPrice: chosenVariation.additionalPersonPrice ?? base.additionalPersonPrice,
        minGuests: chosenVariation.minGuests ?? chosenVariation.minimumGuests ?? base.minGuests,
        maxGuests: chosenVariation.maxGuests ?? chosenVariation.maximumGuests ?? base.maxGuests,
        price: Number(chosenVariation.price ?? base.price ?? 0),
      } : {}),
      id: `${base.id || base.activityId || kind}::redeem:${kind}:${redeemable?.membershipId || redeemable?.bookingItemId || redeemable?.entitlementId || redeemable?.redemptionToken || "x"}`,
      qty: 1,
      isRedeemCheckout: true,
      redeemKind: kind,
      membershipId: redeemable?.membershipId || null,
      voucherToken: redeemable?.redemptionToken || null,
      voucherBookingItemId: redeemable?.bookingItemId || null,
      voucherEntitlementId: redeemable?.entitlementId || null,
      sectionTitle: section?.title || base.sectionTitle || base.sub || "Redeem",
    };
  };

  const firstMembershipBenefitTarget = (membership) => {
    const benefits = Array.isArray(membership?.todaysBenefits) ? membership.todaysBenefits : [];
    for (const benefit of benefits) {
      if (benefit?.target?.activityId || benefit?.target?.variationId) {
        return {
          ...membership,
          activityId: benefit.target.activityId || membership.activityId,
          variationId: benefit.target.variationId || membership.variationId,
          activityName: benefit.label || membership.activityName,
        };
      }
    }
    return membership;
  };

  const handleRedeemCheckout = ({ guest, items: redeemItems = [], autoFinish = false }) => {
    if (!guest?.guestId || redeemItems.length === 0) return;
    const memberships = redeemItems.filter((entry) => entry.kind === "membership").map((entry) => entry.item);
    const vouchers = redeemItems.filter((entry) => entry.kind === "voucher").map((entry) => entry.item);
    const entitlements = redeemItems.filter((entry) => entry.kind === "entitlement").map((entry) => entry.item);
    const primaryMembership = memberships[0] || null;
    const guestEmail = guest.guestEmail || guest.email || "";
    const guestPhone = guest.guestPhone || guest.phone || "";

    setCartCustomer({
      guestId: guest.guestId,
      name: guest.guestName || guest.name || "Guest",
      contact: guestEmail || guestPhone || "",
      contactEmail: guestEmail,
      contactPhone: guestPhone,
    });
    setAppliedBenefits({
      promo: null,
      member: primaryMembership
        ? {
            membershipId: primaryMembership.membershipId,
            activityName: primaryMembership.activityName,
            guestName: guest.guestName || guest.name || primaryMembership.guestName,
            todaysBenefits: primaryMembership.todaysBenefits || [],
          }
        : null,
      vouchers: [
        ...vouchers.map((v) => ({
          token: v.redemptionToken,
          kind: "voucher",
          bookingItemId: v.bookingItemId || null,
          entitlementId: null,
          activityId: v.activityId || null,
          variationId: v.variationId || null,
          price: Number(v.price) || 0,
          expiresAt: v.expiresAt || null,
        })),
        ...entitlements.map((e) => ({
          token: e.redemptionToken,
          kind: "entitlement",
          bookingItemId: null,
          entitlementId: e.entitlementId || null,
          activityId: e.activityId || null,
          variationId: e.variationId || null,
          price: Number(e.price) || 0,
          remainingQty: e.remainingQty || null,
          expiresAt: e.expiresAt || null,
        })),
      ],
      payments: [],
    });

    const products = [
      ...memberships.map((m) => buildRedeemCartProduct(firstMembershipBenefitTarget(m), "membership")),
      ...vouchers.map((v) => buildRedeemCartProduct(v, "voucher")),
      ...entitlements.map((e) => buildRedeemCartProduct(e, "entitlement")),
    ];
    setItems(products.map((product) => buildCartLine(product, { title: product.sectionTitle || "Redeem" })));
    setScreen("sell");
    toast.success(
      autoFinish
        ? "Redeem items loaded. Complete the zero-balance booking from the cart."
        : "Redeem items loaded in Sell. Add extras, then complete payment."
    );
  };

  // ── Top-floating "Add to order" strip ─────────────────────────────
  // Flat list of every add-on / stock-item across all catalog sections,
  // de-duplicated by activityId+variationId. Pre-computed once per
  // preset change so the strip render is just a map.
  const addOnSuggestions = useMemo(() => {
    const seen = new Set();
    const out = [];
    for (const section of sections || []) {
      for (const item of section.items || []) {
        if (!isAddOnItem(item)) continue;
        const key = `${item.activityId || item.id}::${item.variationId || ""}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ item, section });
      }
    }
    return out;
  }, [sections]);

  // The strip should show ONLY when there's a primary (non-addon) item
  // in the cart. Otherwise an empty cart or an all-addon cart shouldn't
  // surface more upsell — the cashier is mid-checkout for a single line.
  const cartHasPrimaryItem = useMemo(
    () => items.some((line) => !isAddOnItem(line)),
    [items]
  );

  // Aggregate cart qty per parent activity (sum across variations) so a
  // multi-variation add-on chip can badge "×3" regardless of whether the
  // 3 are 2 Child socks + 1 Adult or any other split. Cashier sees total
  // committed; per-variation breakdown lives in the cart panel.
  const cartAddOnCounts = useMemo(() => {
    const map = new Map();
    for (const line of items) {
      if (!isAddOnItem(line)) continue;
      const key = String(line.activityId || line.id || "");
      map.set(key, (map.get(key) || 0) + Number(line.qty || 1));
    }
    return map;
  }, [items]);

  // The popup shows when there's a primary item in cart AND suggestions
  // exist AND the cashier hasn't dismissed it this sale.
  const showAddOnPopup =
    cartHasPrimaryItem && addOnSuggestions.length > 0 && !addOnPopupDismissed;
  // Re-show tab (collapsed pill on the right edge) appears only when the
  // cashier dismissed the popup but suggestions are still relevant.
  const showAddOnReopenTab =
    cartHasPrimaryItem && addOnSuggestions.length > 0 && addOnPopupDismissed;

  // Reset dismissal whenever the cart empties — next sale starts fresh.
  React.useEffect(() => {
    if (items.length === 0 && addOnPopupDismissed) {
      setAddOnPopupDismissed(false);
    }
  }, [items.length, addOnPopupDismissed]);

  // Tap handler for an add-on chip. Matches catalog-tile behavior:
  //   • single-variation → straight to cart via addItem
  //   • multi-variation → open the same VariantPickerDialog the catalog uses
  const handleAddOnTap = (item, section) => {
    const options = item.variationOptions || [];
    if (options.length > 1) {
      setAddOnVariantPicker({ item, section });
      return;
    }
    addItem(item, section);
  };

  const catalogMain = (
    // Position-relative wrapper so the floating add-on popup can anchor
    // to the catalog column with `position: absolute`. The popup floats
    // ABOVE the catalog content; it does not steal layout space.
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, minWidth: 0, position: "relative" }}>
      <CatalogGrid
        sections={sections}
        loading={presetLoading}
        error={presetError}
        onAdd={addItem}
        onAddVoucherInclusion={handleAddVoucherInclusion}
        busyItemId={autoSchedulingId}
      />
      {showAddOnPopup && (
        <AddOnSuggestionPopup
          suggestions={addOnSuggestions}
          cartCounts={cartAddOnCounts}
          onAdd={handleAddOnTap}
          position={addOnPopupPos}
          onMove={setAddOnPopupPos}
          onClose={() => setAddOnPopupDismissed(true)}
        />
      )}
      {showAddOnReopenTab && (
        <AddOnReopenTab onClick={() => setAddOnPopupDismissed(false)} />
      )}
    </div>
  );

  // Visible sidebar tabs. "payment" (legacy visual stub — the real Take
  // Payment flow runs through CashierPaymentDialog) and "shift" (till
  // reconciliation stub — only "End shift" is wired, see the bottom
  // sidebar button) are intentionally omitted until they have a real
  // backend. Direct navigation to those routes redirects to /sell via
  // the redirect effect below.
  const screens = [
    { id: "sell", label: "Sell", icon: "ticket" },
    { id: "find", label: "Find", icon: "search" },
    { id: "redeem", label: "Redeem", icon: "qr-code" },
    { id: "checkin", label: "Check-in", icon: "log-in" },
    { id: "guest", label: "Guest", icon: "user-round" },
    { id: "waiver", label: "Waiver", icon: "shield-alert" },
    { id: "refund", label: "Refund", icon: "undo-2" },
  ];

  // Normalize unknown/empty hash routes to /sell. Runs on first mount and
  // any time someone navigates to a path we don't recognise (e.g. a stale
  // bookmark from a renamed screen). replace: true so back-button doesn't
  // bounce them back into the unknown route.
  useEffect(() => {
    const valid = new Set(screens.map((s) => s.id));
    if (!valid.has(screen)) {
      navigate("/sell", { replace: true });
    }
  }, [screen, navigate]);

  // Cart-loss guard. Kiosk address bar is hidden but a stray Ctrl+R or
  // a tablet pull-to-refresh would still nuke the cart. Browser will
  // show its native "Leave site?" prompt when this fires.
  useEffect(() => {
    if (items.length === 0) return undefined;
    const handler = (e) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [items.length]);

  let body;
  let header;

  if (screen === "sell") {
    body = (
      <>
        {catalogMain}
        <CartPanel
          items={items}
          member={member}
          onRemove={removeItem}
          onQty={setQty}
          onEditItem={editCartItem}
          onCheckout={handleCheckout}
          onPricingChange={setCartPricing}
          appliedBenefits={appliedBenefits}
          onAppliedBenefitsChange={setAppliedBenefits}
            variant="default"
            isSubmitting={isCreating || isValidatingCart}
            checkoutBlocker={checkoutBlocker}
            waiversAttached={waiversAttached}
            cartCustomer={cartCustomer}
          onCollectWaivers={(mode = "customer") => {
            setWaiverModalMode(mode);
            setWaiverModalOpen(true);
          }}
          onClearCustomer={() => setCartCustomer(null)}
          onChangeWaivers={setWaiversAttached}
          waiverPool={waiverPool}
          ticketAssignments={ticketAssignments}
          recipientAssignments={recipientAssignments}
          onAssignTicket={(idx, key) =>
            setTicketAssignments((prev) => {
              // Replacing a row: free up whoever was there, and free up
              // anyone else currently holding the new key.
              const next = { ...prev };
              for (const [k, v] of Object.entries(next)) {
                if (v === key) delete next[k];
              }
              next[idx] = key;
              return next;
            })
          }
          onAssignRecipient={(itemIndex, unitIndex) => setRecipientPicker({ itemIndex, unitIndex })}
          onClearRecipient={(itemIndex, unitIndex) =>
            setRecipientAssignments((prev) => {
              const next = { ...prev };
              delete next[`${itemIndex}:${unitIndex}`];
              return next;
            })
          }
          onDetachTicket={(idx) =>
            setTicketAssignments((prev) => {
              const next = { ...prev };
              delete next[idx];
              return next;
            })
          }
        />
        {scheduleRequiredItem && (
          <ScheduleRequiredDialog
            key={`${scheduleRequiredItem.editIndex ?? "new"}:${scheduleRequiredItem.item?.id || ""}:${scheduleRequiredItem.item?.slotId || ""}`}
            item={scheduleRequiredItem.item}
            section={scheduleRequiredItem.section}
            onAdd={applyScheduledCartItem}
            onClose={() => setScheduleRequiredItem(null)}
          />
        )}
        {addOnVariantPicker && (
          <VariantPickerDialog
            item={addOnVariantPicker.item}
            section={addOnVariantPicker.section}
            onClose={() => setAddOnVariantPicker(null)}
            onPick={(item, section, option) => {
              addItem(buildChosenWithVariant(item, option), section);
              setAddOnVariantPicker(null);
            }}
          />
        )}
      </>
    );
    header = (
      <Header
        breadcrumb={(myDevice?.deviceName || myDevice?.name || "TERMINAL").toUpperCase()}
        title="Sell"
        subtitle={new Date().toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric" })}
        right={
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <SellModeToggle mode={sellMode} onChange={setSellMode} />
            <StatusPill tone="success" pulse>Drawer open</StatusPill>
          </div>
        }
      />
    );
  } else if (screen === "find") {
    body = <BookingDetail />;
    header = (
      <Header
        breadcrumb="BOOKINGS · LOOKUP"
        title="Find a booking"
        subtitle="Search · view tickets · take payment"
      />
    );
  } else if (screen === "redeem") {
    body = <Redeem onRedeemCheckout={handleRedeemCheckout} />;
    header = (
      <Header
        breadcrumb="GATE · REDEMPTION"
        title="Scan ticket"
        subtitle="Admit guests — scan a wristband / ticket at the gate"
      />
    );
  } else if (false && screen === "vouchers") {
    body = <VoucherCounter />;
    header = (
      <Header
        breadcrumb="COUNTER · VOUCHERS"
        title="Voucher counter"
        subtitle="Stored value — gift cards, visit packs & memberships"
      />
    );
  } else if (screen === "checkin") {
    body = <CheckIn />;
    // Check-in owns its own integrated top bar (combined title + search +
    // location chip) for event-volume density. The shared Header would
    // burn ~150px on chrome we don't need at the gate.
    header = null;
  } else if (screen === "guest") {
    body = <GuestProfile />;
    header = <Header breadcrumb="GUESTS" title="Guest lookup" />;
  } else if (screen === "waiver") {
    body = <WaiverDetail />;
    header = <Header breadcrumb="COMPLIANCE · WAIVERS" title="Waiver" right={<StatusPill tone="info">Live lookup</StatusPill>} />;
  } else if (screen === "refund") {
    body = <Refund />;
    header = <Header breadcrumb="VOID & REFUND" title="Refund" subtitle="Manager review for > $50" />;
  } else {
    // Unknown / hidden route (e.g. legacy /payment, /shift bookmarks).
    // The redirect effect above will navigate to /sell on next tick;
    // render nothing for the one-frame gap so we don't flash a half-
    // built screen.
    body = null;
    header = null;
  }

  return (
    <div style={{ display: "flex", flex: 1, minWidth: 0, minHeight: 0, height: "100%" }}>
      <aside
        style={{
          width: 88,
          background: "var(--ink-800)",
          color: "#fff",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          padding: "20px 0",
          flexShrink: 0,
          minHeight: 0,
        }}
      >
        <div style={{ marginBottom: 20 }}>
          <svg width={48} height={48} viewBox="0 0 120 120" fill="none">
            <rect x="2" y="2" width="116" height="116" rx="28" fill="#1A1814" />
            <circle cx="60" cy="74" r="30" stroke="#FFCF1F" strokeWidth="6" />
            <path d="M60 24 L86 70 H73.5 L70.5 63 H49.5 L46.5 70 H34 L60 24 Z M54 53 H66 L60 39 L54 53 Z" fill="#F45B0A" />
            <circle cx="60" cy="98" r="5" fill="#6A40F5" />
          </svg>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1, minHeight: 0, width: "100%", padding: "0 8px", overflowY: "auto" }}>
          {screens.map((s) => (
            <button
              key={s.id}
              onClick={() => setScreen(s.id)}
              style={{
                all: "unset",
                cursor: "pointer",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 4,
                // Bumped from 10/6 to 14/10 — sidebar tap targets now
                // exceed the 44px iOS / Android touch minimum (was ~32px,
                // dangerous on tablets).
                padding: "14px 10px",
                minHeight: 56,
                borderRadius: 12,
                background: screen === s.id ? "var(--aero-orange-500)" : "transparent",
                color: screen === s.id ? "#fff" : "rgba(255,255,255,.72)",
              }}
            >
              <Icon name={s.icon} size={22} />
              <span style={{ fontSize: 10, fontWeight: 700 }}>{s.label}</span>
            </button>
          ))}
        </div>
        <button
          onClick={handleEndShift}
          title="End shift"
          style={{
            all: "unset",
            cursor: "pointer",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 4,
            padding: "12px 6px",
            color: "rgba(255,255,255,.6)",
          }}
        >
          <Icon name="log-out" size={22} />
          <span style={{ fontSize: 10, fontWeight: 700 }}>End shift</span>
        </button>
      </aside>
      <main style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0, overflow: "hidden" }}>
        {/* Inject location + terminal name into every Header so the cashier
            always sees which location / lane they're operating from. Falls
            back to the auth locations list when an older paired snapshot
            doesn't carry locationName. */}
        {header && React.cloneElement(header, {
          location: header.props.location ?? (
            myDevice?.locationName ||
            pairedTerminal?.locationName ||
            (locations || []).find((l) => String(l.locationId) === String(pairedTerminal?.locationId || locationId))?.legalBusinessName ||
            (locations || []).find((l) => String(l.locationId) === String(pairedTerminal?.locationId || locationId))?.locationName ||
            (locations || []).find((l) => String(l.locationId) === String(pairedTerminal?.locationId || locationId))?.name
          ),
          terminal: header.props.terminal ?? (myDevice?.deviceName || myDevice?.name),
        })}
        <div
          style={{
            flex: 1,
            display: "flex",
            minWidth: 0,
            minHeight: 0,
            overflow: screen === "sell" ? "hidden" : "auto",
          }}
        >
          <CashierScreenBoundary screenKey={screen}>
            {body}
          </CashierScreenBoundary>
        </div>
      </main>
      <ModalErrorBoundary
        modalKey={`waiver:${waiverModalOpen ? "open" : "closed"}`}
        onError={() => setWaiverModalOpen(false)}
        label="waiver modal"
      >
        <CartWaiverModal
          open={waiverModalOpen}
          mode={waiverModalMode}
          needed={items.reduce((n, it) => n + (it.requiresWaiver ? it.qty : 0), 0)}
          attached={waiversAttached}
          customer={cartCustomer}
          onChange={(next) => {
            setWaiversAttached(next);
            setCartCustomer((current) => current || next[0] || null);
          }}
          onCustomerChange={setCartCustomer}
          onClose={() => setWaiverModalOpen(false)}
        />
      </ModalErrorBoundary>
      <ModalErrorBoundary
        modalKey={`payment:${paymentBooking ? "open" : "closed"}`}
        onError={() => {
          // A crash inside the payment dialog must not leave a half-paid
          // state. Close the dialog so the cashier can re-trigger from
          // the cart, but keep cart items intact so they don't lose work.
          setPaymentBooking(null);
        }}
        label="payment dialog"
      >
        {/* Sell-flow payment overlay. Pre-creates the booking(s) from
            the cart draft, then renders the same CheckInPaymentModal
            used on the Check-in screen so both flows share one
            payment UI. The booking lives in the backend the moment
            the cashier taps Take payment; if they close before
            completing payment, the booking remains unpaid and can be
            finished from Check-in later. */}
        <SellPaymentOverlay
          open={!!paymentBooking}
          draftPayment={paymentBooking}
          onClose={() => setPaymentBooking(null)}
          onComplete={() => {
            // Wipe everything cart-related and rotate the idempotency
            // key so the next checkout gets a fresh one. clearCart() also
            // resets checkoutKey to null; ensureCheckoutKey() will mint
            // a new one at the start of the next checkout attempt.
            dispatch(clearCart());
            setPaymentBooking(null);
            setCreatedBookingId(null);
            setRecipientAssignments({});
          }}
        />
      </ModalErrorBoundary>
      <RecipientPickerModal
        open={!!recipientPicker}
        customer={cartCustomer || waiversAttached[0] || null}
        current={
          recipientPicker
            ? recipientAssignments[`${recipientPicker.itemIndex}:${recipientPicker.unitIndex}`] || cartCustomer || waiversAttached[0] || null
            : null
        }
        onPick={(guest) => {
          if (!recipientPicker) return;
          const recipient = normalizeRecipientForCheckout(guest);
          if (!recipient?.contactEmail) {
            toast.error("Selected member must have an email.");
            return;
          }
          setRecipientAssignments((prev) => ({
            ...prev,
            [`${recipientPicker.itemIndex}:${recipientPicker.unitIndex}`]: recipient,
          }));
          setRecipientPicker(null);
          toast.success(`Attached member: ${recipient.name}`);
        }}
        onUseCustomer={() => {
          if (!recipientPicker) return;
          setRecipientAssignments((prev) => {
            const next = { ...prev };
            delete next[`${recipientPicker.itemIndex}:${recipientPicker.unitIndex}`];
            return next;
          });
          setRecipientPicker(null);
        }}
        onClose={() => setRecipientPicker(null)}
      />
    </div>
  );
}

function normalizeRecipientForCheckout(guest) {
  if (!guest) return null;
  const name = guest.name || guest.guestName || guest.fullName || "";
  const contactEmail = guest.contactEmail || guest.guestEmail || guest.email || "";
  const contactPhone = guest.contactPhone || guest.guestPhone || guest.phone || "";
  return {
    guestId: guest.guestId || null,
    name,
    contact: contactEmail || contactPhone,
    contactEmail,
    contactPhone,
  };
}

function RecipientPickerModal({ open, customer, current, onPick, onUseCustomer, onClose }) {
  const [query, setQuery] = useState("");
  const [triggerSearch, { data, isFetching }] = useLazySearchGuestsQuery();

  useEffect(() => {
    if (!open) return;
    setQuery("");
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const timer = setTimeout(() => {
      if (query.trim().length >= 2) {
        triggerSearch(query.trim());
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [open, query, triggerSearch]);

  if (!open) return null;

  const rows = query.trim().length >= 2 ? (data?.data || []) : [];
  const currentName = current?.name || current?.guestName || "Booking customer";
  const currentEmail = current?.contactEmail || current?.guestEmail || current?.email || "";

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1200,
        background: "rgba(0,0,0,.42)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 18,
      }}
    >
      <div
        onClick={(event) => event.stopPropagation()}
        style={{
          width: 520,
          maxWidth: "100%",
          maxHeight: "82vh",
          background: "white",
          border: "2px solid var(--ink-800)",
          borderRadius: 14,
          boxShadow: "0 8px 0 var(--ink-800)",
          padding: 18,
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 950 }}>Change attached member</div>
            <div style={{ fontSize: 12, color: "var(--ink-500)", marginTop: 3 }}>
              Membership benefits will belong to this person.
            </div>
          </div>
          <button type="button" onClick={onClose} style={{ all: "unset", cursor: "pointer", padding: 4 }}>
            <Icon name="x" size={18} />
          </button>
        </div>

        <div style={{ border: "1.5px solid var(--ink-100)", borderRadius: 10, padding: 10, background: "var(--ink-25)" }}>
          <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".06em", color: "var(--ink-500)", fontWeight: 800 }}>
            Current member
          </div>
          <div style={{ fontWeight: 900, marginTop: 4 }}>{currentName}</div>
          <div style={{ fontSize: 12, color: "var(--ink-500)" }}>{currentEmail || "Email not on file"}</div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8, border: "1.5px solid var(--ink-200)", borderRadius: 10, padding: "11px 12px" }}>
          <Icon name="search" size={16} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search member by name, email, or phone"
            autoFocus
            style={{ all: "unset", flex: 1, fontSize: 14, fontWeight: 700 }}
          />
        </div>

        <div style={{ overflowY: "auto", display: "grid", gap: 8, minHeight: 120 }}>
          {query.trim().length < 2 ? (
            <div style={{ padding: 18, textAlign: "center", color: "var(--ink-500)" }}>Type at least 2 characters.</div>
          ) : isFetching ? (
            <div style={{ padding: 18, textAlign: "center", color: "var(--ink-500)" }}>Searching...</div>
          ) : rows.length === 0 ? (
            <div style={{ padding: 18, textAlign: "center", color: "var(--ink-500)" }}>No matching customers found.</div>
          ) : (
            rows.map((guest) => {
              const normalized = normalizeRecipientForCheckout(guest);
              return (
                <button
                  key={guest.guestId || `${normalized.name}:${normalized.contactEmail}`}
                  type="button"
                  onClick={() => onPick?.(normalized)}
                  style={{
                    all: "unset",
                    cursor: normalized.contactEmail ? "pointer" : "not-allowed",
                    opacity: normalized.contactEmail ? 1 : 0.55,
                    display: "grid",
                    gridTemplateColumns: "32px minmax(0, 1fr) auto",
                    gap: 10,
                    alignItems: "center",
                    border: "1.5px solid var(--ink-150)",
                    borderRadius: 10,
                    padding: "10px 12px",
                  }}
                >
                  <Icon name="user-round" size={18} />
                  <span style={{ minWidth: 0 }}>
                    <span style={{ display: "block", fontWeight: 900, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {normalized.name || "Guest"}
                    </span>
                    <span style={{ display: "block", fontSize: 12, color: "var(--ink-500)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {normalized.contactEmail || normalized.contactPhone || "No email or phone"}
                    </span>
                  </span>
                  <span style={{ fontSize: 12, fontWeight: 900, color: "var(--aero-orange-600)" }}>Attach</span>
                </button>
              );
            })
          )}
        </div>

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button type="button" className="a-btn a-btn--ghost" onClick={onUseCustomer} disabled={!customer?.contactEmail}>
            Use booking customer
          </button>
          <button type="button" className="a-btn a-btn--secondary" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

// Modal-scoped error boundary. Unlike CashierScreenBoundary, this one
// renders NOTHING on error — modals are position: fixed overlays, so a
// crash UI rendered in their slot would float at an arbitrary spot in
// the flex layout. Instead we log, toast, and ask the parent to close
// the modal via onError(); the cashier can re-trigger from the cart.
//
// Resets whenever modalKey changes (i.e. when the modal is re-opened),
// so a one-off crash doesn't permanently disable that modal for the
// rest of the shift.
class ModalErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { errored: false };
  }

  static getDerivedStateFromError() {
    return { errored: true };
  }

  componentDidCatch(error, info) {
    console.error(`Modal failed (${this.props.label || "modal"})`, error, info);
    toast.error(`The ${this.props.label || "modal"} ran into a problem and was closed. Please try again.`);
    queueMicrotask(() => this.props.onError?.(error));
  }

  componentDidUpdate(prevProps) {
    if (prevProps.modalKey !== this.props.modalKey && this.state.errored) {
      this.setState({ errored: false });
    }
  }

  render() {
    if (this.state.errored) return null;
    return this.props.children;
  }
}
