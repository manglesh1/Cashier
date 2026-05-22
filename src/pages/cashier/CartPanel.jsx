import React, { useState } from "react";
import { toast } from "sonner";
import { Icon } from "./Icon";
import { useLazyValidateDiscountCodeQuery } from "../../features/discount/discountApi";
import { useEffectiveSettings } from "../../lib/useEffectiveSettings";
import {
  getCartLineSubtotal,
  getCheckoutRequirements,
  hasScheduleSelection,
  needsScheduleSelection,
  requiresRecipientForCheckout,
} from "./cartPricing";

// Compute a discount amount from the validated discount + subtotal.
// Mirrors what the admin's createBooking pricing logic does:
//   discountType: 1 = percentage (value is %)
//   discountType: 2 = fixed     (value is $)
// maxValue caps a percentage so e.g. "10% off, max $20" works.
function computeDiscountAmount(discount, subtotal) {
  if (!discount) return 0;
  if (discount.amount !== undefined && discount.amount !== null) {
    return Math.min(Number(discount.amount) || 0, subtotal);
  }
  const value = Number(discount.value || 0);
  const max = Number(discount.maxValue || 0);
  if (Number(discount.discountType) === 1) {
    const raw = subtotal * (value / 100);
    return max > 0 ? Math.min(raw, max) : raw;
  }
  // Fixed
  return Math.min(value, subtotal);
}

// Fallback only — used when neither the paired-terminal settings nor the
// location config provide a tax rate. Multi-state operators MUST configure
// the rate per location server-side; this constant only exists so the
// cashier doesn't show $0 tax for a misconfigured environment.
const FALLBACK_TAX_RATE = 0.05;

// Resolve the effective tax rate. Backend field names vary across
// deployments (salesTaxRate / taxRate / locationTaxRate) so we probe a
// few common spellings before falling back. Accepts either a decimal
// (0.0725) or a percent (7.25) — anything > 1 is treated as percent.
function resolveTaxRate(settings) {
  const candidates = [
    settings?.salesTaxRate,
    settings?.taxRate,
    settings?.locationTaxRate,
    settings?.tax?.rate,
  ];
  for (const v of candidates) {
    const num = Number(v);
    if (Number.isFinite(num) && num >= 0) {
      return num > 1 ? num / 100 : num;
    }
  }
  return FALLBACK_TAX_RATE;
}

export function CartPanel({
  items = [],
  onRemove,
  onQty,
  onCheckout,
  member = null,
  variant = "default",
  isSubmitting = false,
  onPricingChange,         // (pricing) => void — parent uses for createBooking payload
  waiversAttached = [],    // [{ signatureId, name, coverage, minors: [{name}], ... }]
  cartCustomer = null,
  onCollectWaivers,        // (mode) => void — opens customer or waiver modal
  onClearCustomer,         // () => void — remove the booking customer
  onChangeWaivers,         // (next) => void — full replacement of waiver list
  waiverPool = [],         // [{ key, name, kind, signatureId, primaryName }]
  ticketAssignments = {},  // { [ticketIndex]: poolKey }
  onAssignTicket,          // (ticketIndex, poolKey) => void
  onDetachTicket,          // (ticketIndex) => void
  onEditItem,
  recipientAssignments = {},
  onAssignRecipient,
  onClearRecipient,
  checkoutBlocker = null,
}) {
  const [promo, setPromo] = useState(null);                // applied discount object
  const [promoOpen, setPromoOpen] = useState(false);       // input expanded?
  const [promoInput, setPromoInput] = useState("");
  const [validate, { isFetching: isValidating }] = useLazyValidateDiscountCodeQuery();


  // Layered POS settings — location defaults + per-device overrides, set at pair time.
  const settings = useEffectiveSettings();

  // Waiver gating — sum quantities of every cart item whose product
  // requires a waiver, then compare against total spots covered by the
  // attached guests. One guest can cover multiple spots (signer + their
  // minors), so we count coverage not chip count. Backend createBooking
  // recomputes from server-trusted data as a safety net.
  const waiversNeeded = items.reduce(
    (n, it) => n + (it.requiresWaiver ? it.qty : 0),
    0
  );
  // Build a flat list of waiver-required spots (one entry per qty per item).
  // We render one "ticket row" for each, matching the check-in screen pattern.
  const waiverSpots = React.useMemo(() => {
    const list = [];
    for (const it of items) {
      if (!it.requiresWaiver) continue;
      for (let i = 0; i < it.qty; i += 1) {
        list.push({ itemId: it.id, itemName: it.name });
      }
    }
    return list;
  }, [items]);

  // Pool indexed by key for quick lookup, and a Set of keys already in
  // use so the dropdown on empty rows only offers free people.
  const poolByKey = React.useMemo(() => {
    const m = new Map();
    for (const p of waiverPool) m.set(p.key, p);
    return m;
  }, [waiverPool]);

  const usedKeys = React.useMemo(
    () => new Set(Object.values(ticketAssignments)),
    [ticketAssignments]
  );

  // Count covered spots = number of waiver-required spots with an
  // assignment. Drives "Take payment" gate.
  const waiversCount = waiverSpots.reduce(
    (n, _, i) => n + (ticketAssignments[i] ? 1 : 0),
    0
  );
  const waiversMissing = Math.max(0, waiversNeeded - waiversCount);

  const primaryCustomer = cartCustomer || waiversAttached[0] || null;
  const checkoutRequirements = React.useMemo(
    () =>
      getCheckoutRequirements(items, {
        customer: primaryCustomer,
        waiverCoverage: waiversCount,
        waiverPolicy: "beforePayment",
      }),
    [items, primaryCustomer, waiversCount]
  );
  const needsCustomer = checkoutRequirements.requiresCustomer;
  const missingRecipients = items.reduce((count, item, itemIndex) => {
    if (!requiresRecipientForCheckout(item)) {
      return count;
    }
    const qty = Math.max(1, Number(item.qty) || 1);
    let next = count;
    for (let unitIndex = 0; unitIndex < qty; unitIndex += 1) {
      const recipient = recipientAssignments[`${itemIndex}:${unitIndex}`] || primaryCustomer;
      if (!recipient?.contactEmail) next += 1;
    }
    return next;
  }, 0);
  const removeWaiver = (signatureId) => {
    if (!onChangeWaivers) return;
    onChangeWaivers(
      waiversAttached.filter((a) => Number(a.signatureId) !== Number(signatureId))
    );
  };

  const subtotal = items.reduce((s, it) => s + getCartLineSubtotal(it), 0);
  const promoCartLines = React.useMemo(
    () =>
      items
        .map((item) => ({
          activityId: Number(item.activityId || 0) || null,
          variationId: Number(item.variationId || 0) || null,
          activityType: item.activityTypeKey || item.typeKey || item.productType || null,
          quantity: Math.max(1, Number(item.qty || 1) || 1),
          subtotal: getCartLineSubtotal(item),
        }))
        .filter((line) => line.subtotal > 0 && (line.activityId || line.variationId || line.activityType)),
    [items]
  );
  const discountAmount = computeDiscountAmount(promo, subtotal);
  const memberDiscount = member ? subtotal * 0.1 : 0;
  const afterDiscount = Math.max(0, subtotal - discountAmount - memberDiscount);
  const taxRate = resolveTaxRate(settings);
  // Match the backend's calculateTaxSummary (utils/shared.js):
  //   add_to_price     → tax is added on top of the price (exclusive)
  //   include_in_price → tax is the portion already inside the price (inclusive)
  const taxInclusive = String(settings?.taxCalculation || "add_to_price") === "include_in_price";
  const tax = taxInclusive
    ? afterDiscount - afterDiscount / (1 + taxRate)
    : afterDiscount * taxRate;
  const total = taxInclusive ? afterDiscount : afterDiscount + tax;

  // Push current pricing up so CashierApp can include it in createBooking
  React.useEffect(() => {
    onPricingChange?.({
      subtotal,
      discount: promo
        ? {
            code: promo.code,
            name: promo.name,
            type: promo.discountType,
            value: promo.value,
            maxValue: promo.maxValue,
            amount: discountAmount,
          }
        : null,
      memberDiscount,
      tax,
      total,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subtotal, discountAmount, memberDiscount, tax, total, promo?.code]);

  const applyPromo = async () => {
    const raw = promoInput.trim();
    if (!raw) return;

    // Code path — validates against the server, gets discount details
    try {
        const res = await validate({
          code: raw,
          subtotalAmount: subtotal,
          cartLines: promoCartLines,
          guestId: primaryCustomer?.guestId || primaryCustomer?.id || null,
        }).unwrap();
        if (res?.success && res.data) {
          setPromo(res.data);
          setPromoOpen(false);
          setPromoInput("");
          toast.success(`Promo "${res.data.name}" applied`);
        } else {
          toast.error("Invalid promo code");
        }
      } catch (err) {
        const msg = err?.data?.message || err?.data?.error || "Invalid promo code";
        toast.error(msg);
      }
  };

  const clearPromo = () => {
    setPromo(null);
    setPromoInput("");
  };

  const isBold = variant === "bold";
  const panelStyle = {
    width: "clamp(360px, 30vw, 460px)", flexShrink: 0,
    minHeight: 0,
    alignSelf: "stretch",
    background: "var(--ink-0)",
    border: isBold ? "2px solid var(--ink-800)" : "1px solid var(--ink-100)",
    borderRadius: isBold ? 24 : 20,
    boxShadow: isBold ? "0 6px 0 var(--ink-800)" : "var(--shadow-2)",
    margin: 16, marginLeft: 0,
    display: "flex", flexDirection: "column",
    overflow: "hidden",
  };

  return (
    <section style={panelStyle}>
      <div style={{
        padding: "18px 22px",
        background: isBold ? "var(--aero-orange-500)" : "var(--ink-0)",
        color: isBold ? "#fff" : "var(--ink-800)",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        borderBottom: isBold ? "2px solid var(--ink-800)" : "1px solid var(--ink-100)",
        flexShrink: 0,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Icon name="shopping-bag" size={22} />
          <h2 style={{ margin: 0, fontFamily: "var(--font-display)", fontSize: 22, fontWeight: 800, letterSpacing: "-.01em" }}>Cart</h2>
          <span style={{
            background: isBold ? "rgba(255,255,255,.22)" : "var(--ink-100)",
            color: isBold ? "#fff" : "var(--ink-700)",
            fontSize: 12, fontWeight: 700,
            padding: "3px 10px", borderRadius: 999,
          }}>{items.reduce((s,i)=>s+i.qty,0)} items</span>
        </div>
      </div>

      {/* Customer slot — top of the cart panel. Renders each attached
          waiver as a small tree (signer + their minors), so the cashier
          sees the pool of waiver-covered people available to fill
          ticket rows below. Each leaf shows whether it is already
          assigned to a ticket. Cashier can detach the whole waiver
          (× on the header) or add another guest at any time. */}
      {(items.length > 0 || needsCustomer || waiversNeeded > 0 || waiversAttached.length > 0 || primaryCustomer) && (
        <div style={{
          padding: "12px 18px",
          background: primaryCustomer ? "#EAF8EF" : "var(--ink-25)",
          borderBottom: "1px solid var(--ink-100)",
          flexShrink: 0,
        }}>
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10,
            marginBottom: waiversAttached.length > 0 ? 8 : 0,
          }}>
            <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: ".06em",
              textTransform: "uppercase", color: "var(--ink-500)" }}>
              Customer
            </div>
            <button
              type="button"
              onClick={() =>
                onCollectWaivers?.(
                  primaryCustomer && waiversNeeded > 0 ? "waiver" : "customer"
                )
              }
              className="a-btn a-btn--primary a-btn--sm"
              style={{ flexShrink: 0 }}
            >
              <Icon name="user-plus" size={14} />
              {primaryCustomer && waiversNeeded > 0 ? "Add waiver" : "Add customer"}
            </button>
          </div>

          {!primaryCustomer ? (
            <div style={{ fontSize: 13, color: "var(--ink-600)" }}>
              {waiversNeeded > 0
                ? "Add the booking customer with a signed waiver to start covering tickets."
                : needsCustomer
                  ? "Add the booking owner before taking payment."
                  : "Optional: add a customer for receipt, lookup, or loyalty."}
            </div>
          ) : !primaryCustomer.signatureId ? (
            <div
              role="button"
              tabIndex={0}
              onClick={() => onCollectWaivers?.("customer")}
              onKeyDown={(e) => {
                if (e.target !== e.currentTarget) return;
                if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onCollectWaivers?.("customer"); }
              }}
              title="Edit customer"
              style={{
                background: "white",
                borderRadius: 10,
                padding: "8px 10px",
                border: "1.5px solid var(--ink-200)",
                display: "flex",
                alignItems: "center",
                gap: 8,
                cursor: "pointer",
              }}
            >
              <Icon name="user-round" size={14} style={{ color: "var(--ink-700)" }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "var(--ink-900)" }}>
                  {primaryCustomer.name}
                  <span style={{ marginLeft: 6, fontSize: 10, color: "var(--ink-500)", fontWeight: 700 }}>
                    customer
                  </span>
                </div>
                <div style={{ fontSize: 10, color: "var(--ink-500)" }}>
                  {primaryCustomer.contact || primaryCustomer.contactEmail || primaryCustomer.contactPhone || "contact not on file"}
                </div>
              </div>
              <Icon name="pencil" size={13} style={{ color: "var(--ink-400)", flexShrink: 0 }} />
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onClearCustomer?.(); }}
                title="Remove customer"
                style={{ all: "unset", cursor: "pointer", color: "var(--ink-500)", padding: 4, flexShrink: 0 }}
              >
                <Icon name="x" size={14} />
              </button>
            </div>
          ) : (
            <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 8 }}>
              {(() => {
                const w =
                  waiversAttached.find(
                    (waiver) =>
                      Number(waiver.signatureId) === Number(primaryCustomer.signatureId)
                  ) || primaryCustomer;
                const minors = Array.isArray(w.minors) ? w.minors : [];
                const signerKey = `${w.signatureId}:signer`;
                const signerAssigned = usedKeys.has(signerKey);
                return (
                  <li key={w.signatureId} style={{
                    background: "white", borderRadius: 10, padding: "8px 10px",
                    border: "1.5px solid var(--ink-200)",
                  }}>
                    {/* Signer row */}
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <Icon name="user-round" size={14} style={{ color: "var(--ink-700)" }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: "var(--ink-900)" }}>
                          {w.name}
                          <span style={{ marginLeft: 6, fontSize: 10, color: "var(--ink-500)", fontWeight: 700 }}>
                            customer
                          </span>
                        </div>
                        <div style={{ fontSize: 10, color: signerAssigned ? "#137A35" : "var(--ink-500)" }}>
                          {signerAssigned ? "✓ assigned to a ticket" : "available"}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => removeWaiver(w.signatureId)}
                        title="Remove waiver coverage; booking customer stays"
                        style={{ all: "unset", cursor: "pointer", color: "var(--ink-500)", padding: 4 }}
                      >
                        <Icon name="x" size={14} />
                      </button>
                    </div>
                    {/* Minor leaves */}
                    {minors.length > 0 && (
                      <ul style={{ margin: "6px 0 0 18px", padding: 0, listStyle: "none",
                        borderLeft: "1.5px solid var(--ink-200)", paddingLeft: 10,
                        display: "flex", flexDirection: "column", gap: 4 }}>
                        {minors.map((m, mi) => {
                          const minorKey = `${w.signatureId}:minor:${mi}`;
                          const assigned = usedKeys.has(minorKey);
                          return (
                            <li key={mi} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                              <Icon name="user-round" size={11} style={{ color: "var(--ink-500)" }} />
                              <span style={{ fontSize: 12, color: "var(--ink-700)", fontWeight: 600 }}>
                                {m?.name || `Minor ${mi + 1}`}
                              </span>
                              <span style={{ fontSize: 10, color: "var(--ink-400)" }}>· minor</span>
                              <span style={{ flex: 1 }} />
                              <span style={{ fontSize: 10, color: assigned ? "#137A35" : "var(--ink-500)" }}>
                                {assigned ? "✓ assigned" : "available"}
                              </span>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </li>
                );
              })()}
            </ul>
          )}
        </div>
      )}

      {/* items */}
      <div style={{ flex: "1 1 0", minHeight: 0, overflowY: "auto", padding: "14px 18px", display: "flex", flexDirection: "column", gap: 10 }}>
        {items.length === 0 && (
          <div style={{ textAlign: "center", padding: "60px 20px", color: "var(--ink-400)" }}>
            <Icon name="shopping-bag" size={42} stroke={1.5} />
            <div style={{ marginTop: 14, fontWeight: 700, fontSize: 16, color: "var(--ink-600)" }}>Cart is empty</div>
            <div style={{ fontSize: 13, marginTop: 4 }}>Tap an activity to add it.</div>
          </div>
        )}
        {items.map((it, idx) => (
          <CartRow
            key={idx}
            item={it}
            itemIndex={idx}
            primaryCustomer={primaryCustomer}
            requiresRecipient={requiresRecipientForCheckout(it)}
            recipientAssignments={recipientAssignments}
            onAssignRecipient={onAssignRecipient}
            onClearRecipient={onClearRecipient}
            onRemove={() => onRemove?.(idx)}
            onQty={(d) => onQty?.(idx, d)}
            onEdit={() => onEditItem?.(idx)}
          />
        ))}

        {/* Per-ticket coverage rows — one row per waiver-required spot,
            mirroring the check-in screen's flat ticket list. Each row
            is either auto-bound to the customer's waiver coverage
            (signer, then minors), or unbound and offering "Find waiver". */}
        {waiverSpots.length > 0 && (
          <div style={{ marginTop: 4 }}>
            <div style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              fontSize: 11, fontWeight: 800, letterSpacing: ".06em",
              textTransform: "uppercase", color: "var(--ink-500)",
              padding: "8px 4px 6px",
            }}>
              <span>Tickets · waiver coverage</span>
              <span style={{ color: waiversMissing > 0 ? "#B83210" : "#137A35" }}>
                {waiversCount} of {waiverSpots.length} covered
              </span>
            </div>
            <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 6 }}>
              {waiverSpots.map((spot, i) => {
                const assignedKey = ticketAssignments[i];
                const assigned = assignedKey ? poolByKey.get(assignedKey) : null;
                // Available pool members: not yet bound to a ticket,
                // OR currently bound to THIS ticket (so the dropdown
                // shows them as the current selection).
                const candidates = waiverPool.filter(
                  (p) => p.key === assignedKey || !usedKeys.has(p.key)
                );
                return (
                  <li
                    key={`${spot.itemId}-${i}`}
                    style={{
                      display: "flex", alignItems: "center", gap: 10,
                      padding: "10px 12px", borderRadius: 10, background: "white",
                      border: `1.5px solid ${assigned ? "#8AD5A3" : "#FFB199"}`,
                    }}
                  >
                    <div style={{
                      width: 28, height: 28, borderRadius: 6, flexShrink: 0,
                      background: assigned ? "#EAF8EF" : "#FFF0EA",
                      color: assigned ? "#137A35" : "#B83210",
                      display: "flex", alignItems: "center", justifyContent: "center",
                    }}>
                      <Icon name={assigned ? "check-circle-2" : "alert-triangle"} size={14} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: 13, color: "var(--ink-900)",
                        whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {spot.itemName}
                      </div>
                      {assigned ? (
                        <div style={{ fontSize: 11, color: "var(--ink-500)", marginTop: 2 }}>
                          <Icon name="user-round" size={10} style={{ verticalAlign: "-1px", marginRight: 4 }} />
                          {assigned.name}
                          {assigned.kind === "minor" && (
                            <span style={{ marginLeft: 4, color: "var(--ink-400)" }}>· minor</span>
                          )}
                        </div>
                      ) : (
                        <select
                          value=""
                          onChange={(e) => {
                            const v = e.target.value;
                            if (!v) return;
                            if (v === "__search") {
                              onCollectWaivers?.("waiver");
                              return;
                            }
                            onAssignTicket?.(i, v);
                          }}
                          style={{
                            marginTop: 4, width: "100%",
                            fontSize: 12, padding: "4px 6px",
                            background: "white",
                            border: "1.5px solid var(--ink-200)",
                            borderRadius: 6,
                          }}
                        >
                          <option value="">
                            {candidates.length > 0
                              ? `Pick a guest (${candidates.length} available)…`
                              : "No guest available — search waiver…"}
                          </option>
                          {candidates.map((p) => (
                            <option key={p.key} value={p.key}>
                              {p.name}
                              {p.kind === "minor" ? " (minor)" : ""}
                              {p.kind === "minor" ? ` · child of ${p.primaryName}` : ""}
                            </option>
                          ))}
                          <option value="__search">+ Search another waiver…</option>
                        </select>
                      )}
                    </div>
                    {assigned && (
                      <button
                        type="button"
                        onClick={() => onDetachTicket?.(i)}
                        title="Detach guest from this ticket"
                        style={{
                          all: "unset", cursor: "pointer", flexShrink: 0,
                          padding: 4, color: "var(--ink-500)",
                        }}
                      >
                        <Icon name="x" size={14} />
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {member && (
          <div style={{
            display: "flex", alignItems: "center", gap: 10,
            padding: "12px 14px", background: "var(--aero-electric-50, var(--ink-50))",
            border: "1.5px solid var(--aero-electric-300, var(--ink-200))", borderRadius: 14,
          }}>
            <div style={{ width: 32, height: 32, borderRadius: 10, background: "var(--aero-electric-400)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Icon name="sparkles" size={18} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 14, color: "var(--aero-electric-500)" }}>{member.name} · Gold</div>
              <div style={{ fontSize: 12, color: "var(--aero-electric-500)" }}>10% member discount applied</div>
            </div>
          </div>
        )}

        {promo && (
          <div style={{
            display: "flex", alignItems: "center", gap: 10,
            padding: "12px 14px", background: "var(--aero-yellow-50, #FFF7DC)",
            border: "1.5px solid var(--aero-yellow-300)", borderRadius: 14,
          }}>
            <div style={{ width: 32, height: 32, borderRadius: 10, background: "var(--aero-yellow-300)", color: "var(--ink-800)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Icon name="gift" size={18} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 14 }}>{promo.code} · {promo.name}</div>
              <div style={{ fontSize: 12, color: "var(--ink-600)" }}>−${discountAmount.toFixed(2)} off</div>
            </div>
            <button onClick={clearPromo} title="Remove promo" style={{ all: "unset", cursor: "pointer", color: "var(--ink-500)" }}>
              <Icon name="x" size={18} stroke={2} />
            </button>
          </div>
        )}

        {/* Promo input — appears when the Promo button is tapped */}
        {!promo && promoOpen && (
          <div style={{
            padding: "10px 12px", background: "var(--ink-25)",
            border: "1.5px solid var(--ink-200)", borderRadius: 14,
            display: "flex", flexDirection: "column", gap: 8,
          }}>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                autoFocus
                value={promoInput}
                onChange={(e) => {
                  setPromoInput(e.target.value.toUpperCase());
                }}
                onKeyDown={(e) => { if (e.key === "Enter") applyPromo(); }}
                placeholder="Enter promo code"
                inputMode="text"
                style={{
                  all: "unset",
                  flex: 1,
                  fontFamily: "var(--font-mono)",
                  fontWeight: 700,
                  fontSize: 15,
                  color: "var(--ink-900)",
                  letterSpacing: "0.06em",
                }}
              />
              <button
                type="button"
                onClick={applyPromo}
                disabled={!promoInput.trim() || isValidating}
                className="a-btn a-btn--primary a-btn--sm"
              >
                {isValidating ? "…" : "Apply"}
              </button>
              <button
                type="button"
                onClick={() => { setPromoOpen(false); setPromoInput(""); }}
                className="a-btn a-btn--ghost a-btn--sm"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      {/* totals */}
      <div style={{
        padding: "16px 22px",
        background: "var(--ink-50)",
        borderTop: "1px solid var(--ink-100)",
        flexShrink: 0,
      }}>
        <Totals
          subtotal={subtotal}
          discount={discountAmount}
          discountLabel={promo ? `Promo · ${promo.code}` : "Discount"}
          memberDiscount={memberDiscount}
          tax={tax}
          total={total}
        />
        <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
          {!promo && settings.enableDiscounts && (
            <button
              type="button"
              onClick={() => setPromoOpen((o) => !o)}
              className="a-btn a-btn--ghost a-btn--sm"
              style={{ flex: 1, justifyContent: "center" }}
            >
              <Icon name="gift" size={16} /> {promoOpen ? "Cancel" : "Promo code"}
            </button>
          )}
        </div>
        {checkoutBlocker?.message && (
          <div
            role="status"
            style={{
              marginTop: 10,
              padding: "10px 12px",
              borderRadius: 10,
              border: "1.5px solid #FFB199",
              background: "#FFF0EA",
              color: "#B83210",
              fontSize: 12,
              fontWeight: 800,
              display: "flex",
              alignItems: "flex-start",
              gap: 8,
            }}
          >
            <Icon name="alert-triangle" size={15} style={{ flexShrink: 0, marginTop: 1 }} />
            <span>{checkoutBlocker.message}</span>
          </div>
        )}
        <button
          type="button"
          className="a-btn a-btn--primary"
          style={{ marginTop: 10, width: "100%", justifyContent: "center", padding: "14px 18px", fontSize: 16 }}
          onClick={onCheckout}
          disabled={items.length === 0 || isSubmitting}
          title={
            checkoutRequirements.missingCustomer
              ? "Add the booking owner before taking payment"
              : waiversMissing > 0
              ? `Add ${waiversMissing} more guest${waiversMissing === 1 ? "" : "s"} with signed waivers before taking payment`
              : missingRecipients > 0
                ? `Assign ${missingRecipients} recipient${missingRecipients === 1 ? "" : "s"} before taking payment`
                : undefined
          }
        >
          <Icon name="credit-card" size={20} />
          {isSubmitting
            ? "Creating…"
            : checkoutRequirements.missingCustomer
              ? "Add owner"
            : waiversMissing > 0
              ? `Add ${waiversMissing} more guest${waiversMissing === 1 ? "" : "s"}`
              : `Take payment · $${total.toFixed(2)}`}
        </button>
      </div>

    </section>
  );
}

function CartRow({
  item,
  itemIndex,
  primaryCustomer,
  requiresRecipient = false,
  recipientAssignments = {},
  onAssignRecipient,
  onClearRecipient,
  onRemove,
  onQty,
  onEdit,
}) {
  const qty = Math.max(1, Number(item.qty) || 1);
  const editableSchedule = needsScheduleSelection(item);
  const recipientRows = requiresRecipient
    ? Array.from({ length: qty }, (_, unitIndex) => {
        const key = `${itemIndex}:${unitIndex}`;
        const assigned = recipientAssignments[key];
        const recipient = assigned || primaryCustomer;
        return { key, unitIndex, assigned, recipient };
      })
    : [];

  return (
    <div
      style={{
        display: "grid", gridTemplateColumns: "40px minmax(0, 1fr) auto auto auto", alignItems: "center", gap: 12,
        padding: "12px 14px",
        background: item.featured ? "var(--aero-orange-50)" : "#fff",
        border: item.featured ? "2px solid var(--ink-800)" : "1.5px solid var(--ink-100)",
        borderRadius: 14,
        cursor: "default",
      }}
    >
      <div style={{
        width: 40, height: 40, borderRadius: 10,
        background: item.featured ? "var(--aero-orange-500)" : "var(--ink-50)",
        color: item.featured ? "#fff" : "var(--ink-700)",
        display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
      }}>
        <Icon name={item.icon || "ticket"} size={20} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 15, color: "var(--ink-800)" }}>{item.name}</div>
        <div style={{ fontSize: 12, color: "var(--ink-500)" }}>{item.meta}</div>
        {editableSchedule && (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onEdit?.();
            }}
            title="Pick a different date, time, variation or guests"
            style={{
              all: "unset",
              cursor: "pointer",
              marginTop: 6,
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "5px 10px",
              borderRadius: 999,
              border: "1.5px solid var(--ink-200)",
              background: "var(--ink-50)",
              color: "var(--ink-700)",
              fontSize: 12,
              fontWeight: 800,
            }}
          >
            <Icon name="calendar-clock" size={14} />
            {hasScheduleSelection(item) ? "Change time" : "Select time"}
          </button>
        )}
        {recipientRows.length > 0 && (
          <div style={{ display: "grid", gap: 6, marginTop: 8 }}>
            {recipientRows.map(({ key, unitIndex, assigned, recipient }) => (
              <div
                key={key}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  minHeight: 28,
                  padding: "4px 8px",
                  border: "1px solid var(--ink-100)",
                  borderRadius: 8,
                  background: "#fff",
                  fontSize: 12,
                }}
              >
                <span style={{ fontWeight: 800, color: "var(--ink-500)" }}>#{unitIndex + 1}</span>
                <span style={{ flex: 1, minWidth: 0, color: recipient ? "var(--ink-800)" : "var(--color-danger, #DC2626)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {recipient?.name || recipient?.guestName || "Assign recipient"}
                </span>
                {assigned && (
                  <button
                    type="button"
                    className="a-btn a-btn--ghost a-btn--xs"
                    onClick={(event) => {
                      event.stopPropagation();
                      onClearRecipient?.(itemIndex, unitIndex);
                    }}
                  >
                    Clear
                  </button>
                )}
                <button
                  type="button"
                  className="a-btn a-btn--ghost a-btn--xs"
                  onClick={(event) => {
                    event.stopPropagation();
                    onAssignRecipient?.(itemIndex, unitIndex);
                  }}
                >
                  {recipient ? "Change" : "Assign"}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
      <div style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "3px 6px", background: "var(--ink-50)", borderRadius: 999 }}>
        <button onClick={(event) => { event.stopPropagation(); onQty(-1); }} style={{ all: "unset", cursor: "pointer", width: 24, height: 24, borderRadius: "50%", background: "#fff", boxShadow: "var(--shadow-1)", display: "inline-flex", alignItems: "center", justifyContent: "center", fontWeight: 700 }}>−</button>
        <span style={{ minWidth: 16, textAlign: "center", fontWeight: 700, fontSize: 14 }}>{item.qty}</span>
        <button onClick={(event) => { event.stopPropagation(); onQty(1); }} style={{ all: "unset", cursor: "pointer", width: 24, height: 24, borderRadius: "50%", background: "#fff", boxShadow: "var(--shadow-1)", display: "inline-flex", alignItems: "center", justifyContent: "center", fontWeight: 700 }}>+</button>
      </div>
      <div className="display-num" style={{ fontSize: 18, minWidth: 64, textAlign: "right" }}>
        ${getCartLineSubtotal(item).toFixed(2)}
      </div>
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onRemove?.();
        }}
        title="Remove from cart"
        style={{
          all: "unset",
          cursor: "pointer",
          width: 28,
          height: 28,
          borderRadius: 8,
          background: "transparent",
          border: "1.5px solid var(--ink-200)",
          color: "var(--color-danger, #DC2626)",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          fontWeight: 800,
          fontSize: 14,
          flexShrink: 0,
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = "var(--color-danger, #DC2626)";
          e.currentTarget.style.color = "white";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = "transparent";
          e.currentTarget.style.color = "var(--color-danger, #DC2626)";
        }}
      >
        ✕
      </button>
    </div>
  );
}

function Totals({ subtotal, discount, discountLabel, memberDiscount, tax, total }) {
  const Row = ({ label, value, accent, big }) => (
    <div style={{
      display: "flex", justifyContent: "space-between", alignItems: "center",
      padding: big ? "8px 0 0" : "4px 0",
      borderTop: big ? "1.5px dashed var(--ink-200)" : undefined,
      marginTop: big ? 6 : 0,
    }}>
      <span style={{ fontSize: big ? 14 : 13, fontWeight: big ? 800 : 600, color: accent || "var(--ink-600)" }}>
        {label}
      </span>
      <span className="display-num" style={{ fontSize: big ? 22 : 14, color: accent || "var(--ink-900)" }}>
        {value}
      </span>
    </div>
  );
  return (
    <div>
      <Row label="Subtotal" value={`$${subtotal.toFixed(2)}`} />
      {discount > 0 && <Row label={discountLabel} value={`−$${discount.toFixed(2)}`} accent="var(--color-success)" />}
      {memberDiscount > 0 && <Row label="Member 10%" value={`−$${memberDiscount.toFixed(2)}`} accent="var(--aero-electric-500)" />}
      <Row label="Tax" value={`$${tax.toFixed(2)}`} />
      <Row label="Total" value={`$${total.toFixed(2)}`} big />
    </div>
  );
}
