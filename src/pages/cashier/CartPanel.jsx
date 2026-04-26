import React, { useState } from "react";
import { toast } from "sonner";
import { Icon } from "./Icon";
import { useLazyValidateDiscountCodeQuery } from "../../features/discount/discountApi";

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

const TAX_RATE = 0.05; // TODO: read from venue tax config when wired

export function CartPanel({
  items = [],
  onRemove,
  onQty,
  onCheckout,
  member = null,
  variant = "default",
  isSubmitting = false,
  onPricingChange,         // (pricing) => void — parent uses for createBooking payload
}) {
  const [promo, setPromo] = useState(null);
  const [promoOpen, setPromoOpen] = useState(false);
  const [promoInput, setPromoInput] = useState("");
  const [validate, { isFetching: isValidating }] = useLazyValidateDiscountCodeQuery();

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
    const code = promoInput.trim();
    if (!code) return;
    try {
      const res = await validate(code).unwrap();
      if (res?.success && res.data) {
        setPromo(res.data);
        setPromoOpen(false);
        setPromoInput("");
        toast.success(`Promo "${res.data.name}" applied`);
      } else {
        toast.error("Invalid promo code");
      }
    } catch (err) {
      toast.error(err?.data?.message || "Invalid promo code");
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
            <div style={{ fontSize: 13, marginTop: 4 }}>Tap a product to add it.</div>
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
            display: "flex", gap: 8,
            padding: "10px 12px", background: "var(--ink-25)",
            border: "1.5px solid var(--ink-200)", borderRadius: 14,
          }}>
            <input
              autoFocus
              value={promoInput}
              onChange={(e) => setPromoInput(e.target.value.toUpperCase())}
              onKeyDown={(e) => { if (e.key === "Enter") applyPromo(); }}
              placeholder="Enter code"
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
          {!promo && (
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
        <button
          type="button"
          className="a-btn a-btn--primary"
          style={{ marginTop: 10, width: "100%", justifyContent: "center", padding: "14px 18px", fontSize: 16 }}
          onClick={onCheckout}
          disabled={items.length === 0 || isSubmitting}
        >
          <Icon name="credit-card" size={20} />
          {isSubmitting ? "Creating…" : `Take payment · $${total.toFixed(2)}`}
        </button>
      </div>
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
