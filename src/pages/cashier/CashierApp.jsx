// CashierApp — top-level cashier shell. Wires:
//   • CatalogGrid to the device's terminal template (useGetPresetFullQuery)
//   • Cart "Pay" → useCreateBookingMutation (creates a draft booking;
//     payment capture happens in the existing booking-detail flow per the
//     user's instruction to skip on-counter payment for now)
//   • CheckIn / Refund screens to their respective real APIs
// Payment + Shift-close screens remain as visual stubs until the user
// approves their backend additions.

import React, { useMemo, useState } from "react";
import Cookies from "js-cookie";
import { useDispatch, useSelector } from "react-redux";
import { toast } from "sonner";
import { baseApi } from "../../api/baseApi";
import { adminBookingDetailUrl, openInAdmin } from "../../lib/adminLink";
import { useLogoutMutation } from "../../features/auth/authApi";
import { logout as logoutAction } from "../../features/auth/authSlice";
import { Sidebar } from "./Sidebar";
import { Header } from "./Header";
import { StatusPill } from "./StatusPill";
import { Icon } from "./Icon";
import { CartPanel } from "./CartPanel";
import { CartWaiverModal } from "./CartWaiverModal";
import { CatalogGrid } from "./CatalogGrid";
import { WaveBoard } from "./WaveBoard";
import { QuickBuilder } from "./QuickBuilder";
import { CheckIn } from "./CheckIn";
import { GuestProfile } from "./GuestProfile";
import { Payment } from "./Payment";
import { ShiftClose } from "./ShiftClose";
import { Refund } from "./Refund";
import { WaiverDetail } from "./WaiverDetail";
import { Redeem } from "./Redeem";
import BookingDetail from "./BookingDetail";
import {
  useGetAllPosDevicesQuery,
  useGetPresetFullQuery,
  useDeviceHeartbeatMutation,
} from "../../features/pos/posApi";
import { useCreateBookingMutation } from "../../features/bookings/bookingApi";
import { getTerminal, clearTerminal } from "../../lib/terminal";

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
    items: (sec.activities || sec.products || sec.items || []).map((p) => ({
      // Preserve every backend identifier we'll need to build a booking payload
      id: p.productItemId || p.id || `${sec.sectionId}-${p.activityId || p.productId}`,
      activityId: p.activityId || p.productId,
      variationId: p.variationId,
      productItemId: p.productItemId,
      productType: p.productType || p.type,
      name: p.displayName || p.activityName || p.productName || p.name || "Untitled",
      sub: p.description || p.subtitle || "",
      price: Number(p.price ?? p.unitPrice ?? p.basePrice ?? NaN),
      icon: pickItemIcon(p.productType || p.type),
      badge: p.featured ? "POPULAR" : undefined,
      featured: p.featured,
      // Activity-level waiver requirement. Drives cart waiver gating.
      requiresWaiver: !!p.requiresWaiver,
      raw: p,
    })),
  }));
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

  const [screen, setScreen] = useState("sell");
  const [variant, setVariant] = useState("A");
  const [items, setItems] = useState([]);
  const [createdBookingId, setCreatedBookingId] = useState(null);
  const [cartPricing, setCartPricing] = useState(null);
  const [member] = useState(null);
  // Waivers attached to the current cart. Populated by the waiver-collection
  // modal (search existing / send link). Sent as waiverSignatureIds on
  // createBooking; backend rejects 400 if count is short of waiver-required
  // quantity.
  const [waiversAttached, setWaiversAttached] = useState([]);
  const [waiverModalOpen, setWaiverModalOpen] = useState(false);

  const [createBooking, { isLoading: isCreating }] = useCreateBookingMutation();

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

  // Heartbeat — bump lastSeenAt every 60 s while the cashier app is open
  const [heartbeat] = useDeviceHeartbeatMutation();
  React.useEffect(() => {
    if (!terminalDeviceId) return;
    const tick = () => heartbeat({ deviceId: terminalDeviceId, appVersion: "0.1.0" }).catch(() => {});
    tick();
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, [terminalDeviceId, heartbeat]);

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
  const addItem = (productItem, section) => {
    const meta = productItem.sub || section?.title || "";
    setItems((prev) => {
      const idx = prev.findIndex((x) => x.id === productItem.id && x.meta === meta);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...next[idx], qty: next[idx].qty + 1 };
        return next;
      }
      return [
        ...prev,
        {
          id: productItem.id,
          activityId: productItem.activityId,
          variationId: productItem.variationId,
          productType: productItem.productType,
          name: productItem.name,
          meta,
          price: Number.isFinite(productItem.price) ? productItem.price : 0,
          qty: 1,
          icon: productItem.icon,
          featured: productItem.featured,
          requiresWaiver: !!productItem.requiresWaiver,
        },
      ];
    });
  };

  const removeItem = (idx) => setItems((prev) => prev.filter((_, i) => i !== idx));
  const setQty = (idx, delta) =>
    setItems((prev) => {
      const n = [...prev];
      n[idx] = { ...n[idx], qty: Math.max(1, n[idx].qty + delta) };
      return n;
    });

  // ── Cart → create booking ─────────────────────────────────────────
  // Builds the same payload shape as BookingConfirmation. Walk-in by
  // default; staff can finish guest details on the booking detail page.
  const handleCheckout = async () => {
    if (items.length === 0) {
      toast.error("Cart is empty");
      return;
    }
    if (!locationId) {
      toast.error("No location selected");
      return;
    }

    const sessions = items
      .filter((it) => it.activityId)
      .map((it) => ({
        activityId: it.activityId,
        variationId: it.variationId,
        quantity: it.qty,
        isAddon: String(it.productType || "").toLowerCase().includes("add"),
      }));

    // Use the first attached guest as the customer-of-record on the
    // booking. That gives the booking a real name/email/phone instead
    // of "Walk-in XYZ", and matches what the cashier saw on screen.
    const primaryGuest = waiversAttached[0] || null;
    const payload = {
      locationId,
      date: new Date().toISOString().slice(0, 10),
      bookingDate: new Date().toISOString().slice(0, 10),
      sessions,
      // Backend (createBooking) recomputes coverage from these IDs and
      // rejects 400 if total spots covered < waiver-required quantity.
      waiverSignatureIds: waiversAttached.map((a) => a.signatureId),
      guestName:
        primaryGuest?.name ||
        member?.name ||
        `Walk-in ${Math.random().toString(36).slice(-4).toUpperCase()}`,
      guestEmail: primaryGuest?.contactEmail || member?.email || "",
      guestPhone: primaryGuest?.contactPhone || member?.phone || "",
      bookingName: primaryGuest?.name || member?.name || "Walk-in",
      source: "cashier",
      notes: `Created by ${user?.first_name || user?.name || "cashier"} at terminal ${myDevice?.deviceName || myDevice?.name || "—"}`,
      // Pricing — includes promo code if the cashier applied one in CartPanel.
      // Backend's createBooking re-validates and recomputes; we just supply
      // the chosen discount so the booking record carries the right code.
      pricingSummary: {
        subtotalAmount: cartPricing?.subtotal || 0,
        discountCode: cartPricing?.discount?.code || null,
        discountName: cartPricing?.discount?.name || null,
        discountType: cartPricing?.discount?.type || null,
        discountValue: cartPricing?.discount?.value || 0,
        discountMaxValue: cartPricing?.discount?.maxValue || 0,
        discountAmount: cartPricing?.discount?.amount || 0,
        taxAmount: cartPricing?.tax || 0,
        totalAmount: cartPricing?.total || 0,
      },
    };

    try {
      const res = await createBooking(payload).unwrap();
      const bookingId = res?.data?.bookingId || res?.data?.bookingMasterId || res?.bookingId || res?.bookingMasterId || res?.id;
      setCreatedBookingId(bookingId);
      setItems([]);
      setWaiversAttached([]); // clear after a successful sale
      toast.success(`Booking ${res?.data?.bookingNumber || ""} created`);
      // Hand off to the Payment screen which can finalize via the existing
      // booking-detail flow (link / refund). Capture endpoint comes later.
      setScreen("payment");
    } catch (err) {
      const msg = err?.data?.message || err?.data?.error || err?.message || "Failed to create booking";
      toast.error(msg);
    }
  };

  // ── Variants for Sell ─────────────────────────────────────────────
  const variants = {
    A: {
      label: "Grid",
      main: (
        <CatalogGrid
          sections={sections}
          loading={presetLoading}
          error={presetError}
          onAdd={addItem}
        />
      ),
      cartVariant: "default",
    },
    B: { label: "Waves", main: <WaveBoard onAdd={addItem} />, cartVariant: "default" },
    C: { label: "Builder", main: <QuickBuilder onAdd={addItem} />, cartVariant: "bold" },
  };

  const screens = [
    { id: "sell", label: "Sell", icon: "ticket" },
    { id: "find", label: "Find", icon: "search" },
    { id: "redeem", label: "Redeem", icon: "qr-code" },
    { id: "checkin", label: "Check-in", icon: "log-in" },
    { id: "guest", label: "Guest", icon: "user-round" },
    { id: "waiver", label: "Waiver", icon: "shield-alert" },
    { id: "payment", label: "Payment", icon: "credit-card" },
    { id: "refund", label: "Refund", icon: "undo-2" },
    { id: "shift", label: "Shift", icon: "lock" },
  ];

  let body;
  let header;

  if (screen === "sell") {
    const v = variants[variant];
    body = (
      <>
        {v.main}
        <CartPanel
          items={items}
          member={member}
          onRemove={removeItem}
          onQty={setQty}
          onCheckout={handleCheckout}
          onPricingChange={setCartPricing}
          variant={v.cartVariant}
          isSubmitting={isCreating}
          waiversAttached={waiversAttached}
          onCollectWaivers={() => setWaiverModalOpen(true)}
          onChangeWaivers={setWaiversAttached}
        />
      </>
    );
    header = (
      <Header
        breadcrumb={(myDevice?.deviceName || myDevice?.name || "TERMINAL").toUpperCase()}
        title="Sell"
        subtitle={new Date().toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric" })}
        right={<HeaderRight variant={variant} setVariant={setVariant} variants={variants} />}
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
        subtitle="Wristband / QR / typed code"
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
    header = <Header breadcrumb="COMPLIANCE · WAIVERS" title="Waiver" right={<StatusPill tone="danger">Blocked</StatusPill>} />;
  } else if (screen === "payment") {
    body = (
      <Payment
        total={items.reduce((s, it) => s + it.price * it.qty, 0)}
        bookingId={createdBookingId}
        onComplete={() => {
          setCreatedBookingId(null);
          setScreen("sell");
        }}
        onOpenInAdmin={() => {
          if (createdBookingId) window.open(adminBookingDetailUrl(createdBookingId), "_blank", "noopener,noreferrer");
        }}
      />
    );
    header = (
      <Header
        breadcrumb={createdBookingId ? `BOOKING · ${createdBookingId}` : "CART · NEW"}
        title="Checkout"
        subtitle={`${items.length} items · ${items.reduce((s, i) => s + i.qty, 0)} jumpers`}
      />
    );
  } else if (screen === "refund") {
    body = <Refund />;
    header = <Header breadcrumb="VOID & REFUND" title="Refund" subtitle="Manager review for > $50" />;
  } else {
    body = <ShiftClose />;
    header = <Header breadcrumb={`SHIFT · ${myDevice?.deviceName || "—"}`} title="Close shift" subtitle={user?.first_name || user?.name || "Cashier"} />;
  }

  return (
    <div style={{ display: "flex", flex: 1, minWidth: 0 }}>
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
        <div style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1, width: "100%", padding: "0 8px" }}>
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
                padding: "10px 6px",
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
      <main style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
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
        <div style={{ flex: 1, display: "flex", minHeight: 0 }}>{body}</div>
      </main>
      <CartWaiverModal
        open={waiverModalOpen}
        needed={items.reduce((n, it) => n + (it.requiresWaiver ? it.qty : 0), 0)}
        attached={waiversAttached}
        onChange={setWaiversAttached}
        onClose={() => setWaiverModalOpen(false)}
      />
    </div>
  );
}

function HeaderRight({ variant, setVariant, variants }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <StatusPill tone="success" pulse>
        Drawer open
      </StatusPill>
      <div style={{ display: "inline-flex", background: "var(--ink-50)", borderRadius: 12, padding: 4, marginLeft: 8 }}>
        {Object.entries(variants).map(([k, val]) => (
          <button
            key={k}
            onClick={() => setVariant(k)}
            style={{
              all: "unset",
              cursor: "pointer",
              padding: "8px 14px",
              borderRadius: 8,
              fontWeight: 700,
              fontSize: 13,
              background: variant === k ? "#fff" : "transparent",
              color: variant === k ? "var(--ink-800)" : "var(--ink-500)",
              boxShadow: variant === k ? "var(--shadow-1)" : "none",
            }}
          >
            {val.label}
          </button>
        ))}
      </div>
    </div>
  );
}
