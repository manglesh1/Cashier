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
import { Sidebar } from "./Sidebar";
import { Header } from "./Header";
import { StatusPill } from "./StatusPill";
import { Icon } from "./Icon";
import { CartPanel } from "./CartPanel";
import { CartWaiverModal } from "./CartWaiverModal";
import CashierPaymentDialog from "./CashierPaymentDialog";
import { CashierScreenBoundary } from "./CashierScreenBoundary";
import { CatalogGrid } from "./CatalogGrid";
import { ScheduleRequiredDialog } from "./ScheduleRequiredDialog";
import { CheckIn } from "./CheckIn";
import { GuestProfile } from "./GuestProfile";
// Payment + ShiftClose are visual stubs and are not routed from the
// sidebar (see the `screens` array). The files remain on disk so the
// next dev to wire them has a starting point.
import { Refund } from "./Refund";
import { WaiverDetail } from "./WaiverDetail";
import { Redeem } from "./Redeem";
import { VoucherCounter } from "./VoucherCounter";
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
} from "../../features/bookings/bookingApi";
import { autoScheduleLine, formatDateValue } from "./scheduleHelpers";
import {
  setCartItems,
  setCartCustomer as setCartCustomerAction,
  setWaiversAttached as setWaiversAttachedAction,
  setTicketAssignments as setTicketAssignmentsAction,
  ensureCheckoutKey,
  rotateCheckoutKey,
  clearCart,
} from "../../features/cart/cartSlice";
import { getTerminal, clearTerminal, updateTerminalSettings } from "../../lib/terminal";
import { attachScannerListener } from "../../lib/scanner";
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

function productTypeKey(item) {
  return String(item?.productType || "").toLowerCase();
}

function isVoucherPackItem(item) {
  return productTypeKey(item) === "voucher_pack";
}

function isNoScheduleSkuItem(item) {
  return NO_SCHEDULE_CHECKOUT_TYPES.has(productTypeKey(item));
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

  const [createdBookingId, setCreatedBookingId] = useState(null);
  // When a sale is committed, the new booking + summary lands here and
  // CashierPaymentDialog opens. Same UX as the check-in screen's "Take
  // payment" modal.
  //
  // Intentionally NOT persisted: a half-open payment dialog should not
  // survive a refresh (network conditions may have changed; the cashier
  // should consciously re-trigger from the cart).
  const [paymentBooking, setPaymentBooking] = useState(null);
  const [pendingPaymentBooking, setPendingPaymentBooking] = useState(null);
  const [cartPricing, setCartPricing] = useState(null);
  const [checkoutBlocker, setCheckoutBlocker] = useState(null);
  const [scheduleRequiredItem, setScheduleRequiredItem] = useState(null);
  const [member] = useState(null);
  const [waiverModalOpen, setWaiverModalOpen] = useState(false);
  const [waiverModalMode, setWaiverModalMode] = useState("customer");

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

  const removeItem = (idx) => setItems((prev) => prev.filter((_, i) => i !== idx));
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
    // unpaid here — no payment payload baked in.
    const payByGiftCard = payment?.giftCard === true;
    const paymentPayload = payByGiftCard
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
          pricingSummary: buildPaidCheckoutPricingSummary(
            allocation,
            shouldCarryPayment ? payment : null
          ),
          sessions: undefined,
          waiverSignatureIds: undefined,
          activityIds: [Number(item.activityId)],
          variationId: item.variationId || null,
          bookingName: `${draft.guestName} - ${item.name}`.trim(),
          deferWaiverEnforcement: true,
          idempotencyKey: baseKey ? `${baseKey}:voucher${voucherSeq}` : undefined,
        }).unwrap();
        const data = res?.data || {};
        const bookingId = data.bookingId || res?.bookingId || res?.bookingMasterId || res?.id;
        setCreatedBookingId(bookingId);
        if (!bookingForReceipt) {
          bookingForReceipt = {
            bookingId,
            bookingNumber: data.bookingNumber || res?.bookingNumber || "",
          };
        }
      }
    }

    toast.success(`Order ${bookingForReceipt?.bookingNumber || ""} completed`);
    return bookingForReceipt;
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
    if (pendingPaymentBooking) {
      setCheckoutBlocker(null);
      setPaymentBooking(pendingPaymentBooking);
      return;
    }

    // Mint an idempotency key for this checkout attempt if we don't have
    // one yet. Reused across retries (so the backend can dedupe a double-
    // submit on flaky wifi), rotated on successful completion.
    dispatch(ensureCheckoutKey());

    const primaryGuest = cartCustomer || waiversAttached[0] || null;
    const checkoutRequirements = getCheckoutRequirements(items, {
      customer: primaryGuest,
      waiverCoverage: Object.values(ticketAssignments).filter(Boolean).length,
      waiverPolicy: "beforePayment",
    });
    const noScheduleItems = items.filter(isNoScheduleSkuItem);
    const regularItems = items.filter((it) => !isNoScheduleSkuItem(it));
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
    const bookingDate = scheduledDates[0] || new Date().toISOString().slice(0, 10);

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
        items: items.map((item) => ({
          activityId: item.activityId,
          variationId: item.variationId,
          productType: item.productType,
          name: item.name,
          quantity: item.qty,
          // Line subtotal lets the backend price authoritatively without
          // re-deriving prices, then return the canonical tax + total.
          subtotal: getCartLineSubtotal(item),
          slotId: item.slotId || null,
          date: item.selectedDate || item.date || bookingDate,
          selectedDate: item.selectedDate || item.date || bookingDate,
          bundleInclusions: item.bundleInclusions || [],
          choiceSelections: item.choiceSelections || {},
        })),
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

    const draftPayment = {
      draftSale: true,
      bookingNumber: "DRAFT SALE",
      totalAmount: chargeTotal,
      balanceDue: chargeTotal,
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
    setPendingPaymentBooking(draftPayment);
    setCheckoutBlocker(null);
    setPaymentBooking(draftPayment);
  };

  // Sell catalog. (The earlier "Waves"/"Builder" layouts were demo
  // scaffolding with static data that produced un-checkout-able lines, so
  // they were removed — the live terminal template is the single source.)
  const catalogMain = (
    <CatalogGrid
      sections={sections}
      loading={presetLoading}
      error={presetError}
      onAdd={addItem}
      busyItemId={autoSchedulingId}
    />
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
    { id: "vouchers", label: "Vouchers", icon: "ticket" },
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
      </>
    );
    header = (
      <Header
        breadcrumb={(myDevice?.deviceName || myDevice?.name || "TERMINAL").toUpperCase()}
        title="Sell"
        subtitle={new Date().toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric" })}
        right={<StatusPill tone="success" pulse>Drawer open</StatusPill>}
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
    body = <Redeem />;
    header = (
      <Header
        breadcrumb="GATE · REDEMPTION"
        title="Scan ticket"
        subtitle="Admit guests — scan a wristband / ticket at the gate"
      />
    );
  } else if (screen === "vouchers") {
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
    header = (
      <Header
        breadcrumb="OPERATIONS"
        title="Check-in"
        subtitle="Today's arrivals"
      />
    );
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
          setPendingPaymentBooking(null);
        }}
        label="payment dialog"
      >
        <CashierPaymentDialog
          open={!!paymentBooking}
          booking={paymentBooking}
          onClose={() => setPaymentBooking(null)}
          onCompleteDraft={completeDraftCheckout}
          onComplete={() => {
            // Wipe everything cart-related and rotate the idempotency
            // key so the next checkout gets a fresh one. clearCart() also
            // resets checkoutKey to null; ensureCheckoutKey() will mint
            // a new one at the start of the next checkout attempt.
            dispatch(clearCart());
            setPaymentBooking(null);
            setPendingPaymentBooking(null);
            setCreatedBookingId(null);
          }}
        />
      </ModalErrorBoundary>
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
    // Defer to next tick so React can finish the error commit before we
    // re-trigger a state update in the parent.
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

