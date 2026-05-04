import React, { useState } from "react";
import { toast } from "sonner";
import { Icon } from "./Icon";
import { useLazyValidateDiscountCodeQuery } from "../../features/discount/discountApi";
import ManagerOverridePrompt from "../../components/ManagerOverridePrompt";
import { useEffectiveSettings } from "../../lib/useEffectiveSettings";

// Compute a discount amount from the validated discount + subtotal.
// Mirrors what the admin's createBooking pricing logic does:
//   discountType: 1 = percentage (value is %)
//   discountType: 2 = fixed     (value is $)
// maxValue caps a percentage so e.g. "10% off, max $20" works.
function computeDiscountAmount(discount, subtotal) {
  if (!discount) return 0;
  const value = Number(discount.value || 0);
  const max = Number(discount.maxValue || 0);
  if (Number(discount.discountType) === 1) {
    const raw = subtotal * (value / 100);
    return max > 0 ? Math.min(raw, max) : raw;
  }
  // Fixed
  return Math.min(value, subtotal);
}

const TAX_RATE = 0.05; // TODO: read from location tax config when wired

export function CartPanel({
  items = [],
  onRemove,
  onQty,
  onCheckout,
  member = null,
  variant = "default",
  isSubmitting = false,
  onPricingChange,         // (pricing) => void — parent uses for createBooking payload
  waiversAttached = [],    // array of waiver signature IDs already linked
  onCollectWaivers,        // () => void — opens waiver collection modal
}) {
  // Discount can be one of three modes — same as PaymentTab on All Bookings.
  // Code: typed string → validated against /promos/validate → server-defined value
  // Percentage: cashier types %, applied directly (subject to manager override above 20%)
  // Amount: cashier types $, applied directly (subject to manager override above $20)
  const [promo, setPromo] = useState(null);                // applied discount object
  const [promoOpen, setPromoOpen] = useState(false);       // input expanded?
  const [promoMode, setPromoMode] = useState("code");      // "code" | "percentage" | "amount"
  const [promoInput, setPromoInput] = useState("");
  const [validate, { isFetching: isValidating }] = useLazyValidateDiscountCodeQuery();

  // Manager-override modal state — opened when validate returns a
  // blockable error (expired / usage limit reached) so a manager can
  // type their PIN and authorize the apply.
  const [overrideContext, setOverrideContext] = useState(null);

  // Layered POS settings — location defaults + per-device overrides, set at pair time.
  const settings = useEffectiveSettings();
  const pctLimit = Number(settings.cashierDiscountPercentLimit ?? 20);
  const amtLimit = Number(settings.cashierDiscountAmountLimit ?? 20);
  const skipPin = !!settings.allowCustomDiscountWithoutPin;

  // Waiver gating — sum quantities of every cart item whose product
  // requires a waiver, then compare against total spots covered by the
  // attached guests. One guest can cover multiple spots (signer + their
  // minors), so we count coverage not chip count. Backend createBooking
  // recomputes from server-trusted data as a safety net.
  const waiversNeeded = items.reduce(
    (n, it) => n + (it.requiresWaiver ? it.qty : 0),
    0
  );
  const waiversCount = Array.isArray(waiversAttached)
    ? waiversAttached.reduce((n, a) => n + Math.max(1, Number(a.coverage) || 1), 0)
    : 0;
  const waiversMissing = Math.max(0, waiversNeeded - waiversCount);

  const subtotal = items.reduce((s, it) => s + it.price * it.qty, 0);
  const discountAmount = computeDiscountAmount(promo, subtotal);
  const memberDiscount = member ? subtotal * 0.1 : 0;
  const afterDiscount = Math.max(0, subtotal - discountAmount - memberDiscount);
  const tax = afterDiscount * TAX_RATE;
  const total = afterDiscount + tax;

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
    if (promoMode === "code") {
      try {
        const res = await validate(raw).unwrap();
        if (res?.success && res.data) {
          setPromo(res.data);
          setPromoOpen(false);
          setPromoInput("");
          toast.success(`Promo "${res.data.name}" applied`);
        } else {
          toast.error("Invalid promo code");
        }
      } catch (err) {
        const status = err?.status;
        const msg = err?.data?.message || err?.data?.error || "Invalid promo code";
        const isOverridable = status === 400 && /expired|usage limit/i.test(msg);
        if (isOverridable) {
          setOverrideContext({
            code: raw,
            reason: msg,
            action: /expired/i.test(msg) ? "apply_expired_promo" : "apply_over_limit_promo",
          });
          return;
        }
        toast.error(msg);
      }
      return;
    }

    // Manual percentage / amount — no server validation, just bounds checks
    const value = Number(raw);
    if (!Number.isFinite(value) || value <= 0) {
      toast.error("Enter a positive number");
      return;
    }
    if (promoMode === "percentage") {
      if (value > 100) {
        toast.error("Percentage can't exceed 100");
        return;
      }
      // Threshold gate — over the location's % limit needs manager override (unless skipPin)
      if (!skipPin && value > pctLimit) {
        setOverrideContext({
          code: `${value}%`,
          reason: `${value}% manual discount exceeds the ${pctLimit}% cashier limit`,
          action: "apply_manual_percentage_override",
          payload: { mode: "percentage", value },
        });
        return;
      }
      setPromo({
        discountId: null,
        name: `Manual ${value}% off`,
        code: null,
        discountType: 1,
        value,
        maxValue: 0,
        _manual: true,
      });
      setPromoOpen(false);
      setPromoInput("");
      toast.success(`${value}% discount applied`);
      return;
    }
    if (promoMode === "amount") {
      if (value > subtotal) {
        toast.error("Discount can't exceed the subtotal");
        return;
      }
      // Threshold gate — over the location's $ limit needs manager override (unless skipPin)
      if (!skipPin && value > amtLimit) {
        setOverrideContext({
          code: `$${value}`,
          reason: `$${value.toFixed(2)} manual discount exceeds the $${amtLimit.toFixed(2)} cashier limit`,
          action: "apply_manual_amount_override",
          payload: { mode: "amount", value },
        });
        return;
      }
      setPromo({
        discountId: null,
        name: `Manual $${value.toFixed(2)} off`,
        code: null,
        discountType: 2,
        value,
        maxValue: 0,
        _manual: true,
      });
      setPromoOpen(false);
      setPromoInput("");
      toast.success(`$${value.toFixed(2)} discount applied`);
    }
  };

  // After a manager authorises, fetch the promo's data ignoring the
  // expiry / usage check, then apply it. We do this client-side: the
  // validate endpoint won't tell us the value when it 400s, so we
  // pull it via a separate "force" call. For now we re-call validate
  // and surface whatever it returns; backend can add a force=true
  // query param later for cleaner data.
  const onOverrideApproved = async (audit) => {
    if (!overrideContext) return;
    const { code, action, payload } = overrideContext;
    try {
      // Manual % / $ override → apply directly, the audit row carries the
      // approval. No server lookup needed.
      if (payload?.mode === "percentage") {
        setPromo({
          discountId: null,
          name: `Manual ${payload.value}% off (manager approved)`,
          code: null,
          discountType: 1,
          value: payload.value,
          maxValue: 0,
          _manual: true,
          _overrideAuditId: audit.auditId,
        });
        toast.success(`Override applied — ${payload.value}% off`);
      } else if (payload?.mode === "amount") {
        setPromo({
          discountId: null,
          name: `Manual $${payload.value.toFixed(2)} off (manager approved)`,
          code: null,
          discountType: 2,
          value: payload.value,
          maxValue: 0,
          _manual: true,
          _overrideAuditId: audit.auditId,
        });
        toast.success(`Override applied — $${payload.value.toFixed(2)} off`);
      } else {
        // Code override — re-fetch to get the discount details
        const apiBase = import.meta.env.VITE_API_BASE_URL || "/api";
        const r = await fetch(`${apiBase}/promos/validate/${encodeURIComponent(code)}?override=1`);
        const body = await r.json();
        const discount = body?.data || {
          discountId: null,
          name: `Override · ${code}`,
          code,
          discountType: 1,
          value: 0,
          maxValue: 0,
        };
        setPromo({ ...discount, _overrideAuditId: audit.auditId });
        toast.success(`Override applied — code "${code}"`);
      }
      setPromoOpen(false);
      setPromoInput("");
    } catch (err) {
      toast.error("Override approved but apply failed: " + (err?.message || ""));
    } finally {
      setOverrideContext(null);
    }
  };

  const clearPromo = () => {
    setPromo(null);
    setPromoInput("");
  };

  const isBold = variant === "bold";
  const panelStyle = {
    width: 460, flexShrink: 0,
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

      {/* items */}
      <div style={{ flex: 1, overflowY: "auto", padding: "14px 18px", display: "flex", flexDirection: "column", gap: 10 }}>
        {items.length === 0 && (
          <div style={{ textAlign: "center", padding: "60px 20px", color: "var(--ink-400)" }}>
            <Icon name="shopping-bag" size={42} stroke={1.5} />
            <div style={{ marginTop: 14, fontWeight: 700, fontSize: 16, color: "var(--ink-600)" }}>Cart is empty</div>
            <div style={{ fontSize: 13, marginTop: 4 }}>Tap an activity to add it.</div>
          </div>
        )}
        {items.map((it, idx) => (
          <CartRow key={idx} item={it} onRemove={() => onRemove?.(idx)} onQty={(d) => onQty?.(idx, d)} />
        ))}

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
            {/* Mode tabs */}
            <div style={{ display: "inline-flex", background: "white", border: "1.5px solid var(--ink-200)", borderRadius: 10, padding: 3, alignSelf: "flex-start" }}>
              {[
                { key: "code", label: "Code" },
                ...(settings.enableCustomDiscount ? [
                  { key: "percentage", label: "%" },
                  { key: "amount", label: "$" },
                ] : []),
              ].map((m) => (
                <button
                  key={m.key}
                  type="button"
                  onClick={() => { setPromoMode(m.key); setPromoInput(""); }}
                  style={{
                    all: "unset",
                    cursor: "pointer",
                    padding: "5px 14px",
                    borderRadius: 7,
                    fontWeight: 700,
                    fontSize: 12,
                    background: promoMode === m.key ? "var(--ink-800)" : "transparent",
                    color: promoMode === m.key ? "white" : "var(--ink-700)",
                  }}
                >
                  {m.label}
                </button>
              ))}
            </div>

            <div style={{ display: "flex", gap: 8 }}>
              {promoMode === "amount" && (
                <span style={{ fontWeight: 800, fontSize: 18, color: "var(--ink-700)", alignSelf: "center", paddingLeft: 4 }}>$</span>
              )}
              <input
                autoFocus
                value={promoInput}
                onChange={(e) => {
                  const v = promoMode === "code"
                    ? e.target.value.toUpperCase()
                    : e.target.value.replace(/[^0-9.]/g, "");
                  setPromoInput(v);
                }}
                onKeyDown={(e) => { if (e.key === "Enter") applyPromo(); }}
                placeholder={
                  promoMode === "code" ? "Enter code"
                  : promoMode === "percentage" ? "10"
                  : "5.00"
                }
                inputMode={promoMode === "code" ? "text" : "decimal"}
                style={{
                  all: "unset",
                  flex: 1,
                  fontFamily: promoMode === "code" ? "var(--font-mono)" : "var(--font-sans)",
                  fontWeight: 700,
                  fontSize: 15,
                  color: "var(--ink-900)",
                  letterSpacing: promoMode === "code" ? "0.06em" : "0",
                }}
              />
              {promoMode === "percentage" && (
                <span style={{ fontWeight: 800, fontSize: 18, color: "var(--ink-700)", alignSelf: "center", paddingRight: 4 }}>%</span>
              )}
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
            {promoMode !== "code" && !skipPin && (
              <div style={{ fontSize: 11, color: "var(--ink-500)", fontWeight: 600 }}>
                Manual {promoMode === "percentage" ? "percent" : "dollar"} discounts above {promoMode === "percentage" ? `${pctLimit}%` : `$${amtLimit.toFixed(2)}`} need a manager.
              </div>
            )}
          </div>
        )}
      </div>

      {/* totals */}
      <div style={{
        padding: "16px 22px",
        background: "var(--ink-50)",
        borderTop: "1px solid var(--ink-100)",
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
        {waiversNeeded > 0 && (
          <div
            style={{
              marginTop: 10,
              padding: "10px 12px",
              borderRadius: 10,
              border: `1.5px solid ${waiversMissing > 0 ? "#FFB199" : "#8AD5A3"}`,
              background: waiversMissing > 0 ? "#FFF0EA" : "#EAF8EF",
              display: "flex", alignItems: "center", gap: 10,
            }}
          >
            <Icon
              name={waiversMissing > 0 ? "alert-triangle" : "check-circle-2"}
              size={18}
              stroke={2.5}
              style={{ color: waiversMissing > 0 ? "#B83210" : "#137A35", flexShrink: 0 }}
            />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: waiversMissing > 0 ? "#B83210" : "#137A35" }}>
                {waiversMissing > 0
                  ? `${waiversMissing} guest${waiversMissing === 1 ? "" : "s"} need waivers`
                  : "All guests covered"}
              </div>
              <div style={{ fontSize: 11, color: "var(--ink-600)", marginTop: 2 }}>
                {waiversCount} of {waiversNeeded} covered
              </div>
            </div>
            <button
              type="button"
              className="a-btn a-btn--primary a-btn--sm"
              onClick={onCollectWaivers}
              style={{ flexShrink: 0 }}
            >
              <Icon name={waiversMissing > 0 ? "user-plus" : "users"} size={14} />
              {waiversMissing > 0 ? "Add guest" : "Manage"}
            </button>
          </div>
        )}
        <button
          type="button"
          className="a-btn a-btn--primary"
          style={{ marginTop: 10, width: "100%", justifyContent: "center", padding: "14px 18px", fontSize: 16 }}
          onClick={onCheckout}
          disabled={items.length === 0 || isSubmitting || waiversMissing > 0}
          title={waiversMissing > 0 ? `Add ${waiversMissing} more guest${waiversMissing === 1 ? "" : "s"} with signed waivers before taking payment` : undefined}
        >
          <Icon name="credit-card" size={20} />
          {isSubmitting
            ? "Creating…"
            : waiversMissing > 0
              ? `Add ${waiversMissing} more guest${waiversMissing === 1 ? "" : "s"}`
              : `Take payment · $${total.toFixed(2)}`}
        </button>
      </div>

      <ManagerOverridePrompt
        open={!!overrideContext}
        title="Promo blocked — manager approval needed"
        description={overrideContext?.reason}
        action={overrideContext?.action || "apply_promo_override"}
        targetType="promo_code"
        targetId={overrideContext?.code}
        defaultReason="Customer brought a promotional offer"
        onApprove={onOverrideApproved}
        onCancel={() => setOverrideContext(null)}
      />
    </section>
  );
}

function CartRow({ item, onRemove, onQty }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 12,
      padding: "12px 14px",
      background: item.featured ? "var(--aero-orange-50)" : "#fff",
      border: item.featured ? "2px solid var(--ink-800)" : "1.5px solid var(--ink-100)",
      borderRadius: 14,
    }}>
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
      </div>
      <div style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "3px 6px", background: "var(--ink-50)", borderRadius: 999 }}>
        <button onClick={() => onQty(-1)} style={{ all: "unset", cursor: "pointer", width: 24, height: 24, borderRadius: "50%", background: "#fff", boxShadow: "var(--shadow-1)", display: "inline-flex", alignItems: "center", justifyContent: "center", fontWeight: 700 }}>−</button>
        <span style={{ minWidth: 16, textAlign: "center", fontWeight: 700, fontSize: 14 }}>{item.qty}</span>
        <button onClick={() => onQty(1)} style={{ all: "unset", cursor: "pointer", width: 24, height: 24, borderRadius: "50%", background: "#fff", boxShadow: "var(--shadow-1)", display: "inline-flex", alignItems: "center", justifyContent: "center", fontWeight: 700 }}>+</button>
      </div>
      <div className="display-num" style={{ fontSize: 18, minWidth: 64, textAlign: "right" }}>
        ${(item.price * item.qty).toFixed(2)}
      </div>
      <button
        type="button"
        onClick={onRemove}
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
