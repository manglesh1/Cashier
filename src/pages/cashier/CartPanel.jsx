import React, { useState } from 'react';
import { Icon } from './Icon';

export function CartPanel({
  items = [],
  onRemove,
  onQty,
  onCheckout,
  promo = null,
  member = null,
  variant = "default", // "default" | "bold" | "minimal"
}) {
  const subtotal = items.reduce((s, it) => s + it.price * it.qty, 0);
  const discount = promo ? promo.amount : 0;
  const memberDiscount = member ? subtotal * 0.1 : 0;
  const tax = (subtotal - discount - memberDiscount) * 0.05;
  const total = subtotal - discount - memberDiscount + tax;

  const isBold = variant === "bold";
  const panelStyle = {
    width: 460, flexShrink: 0,
    background: isBold ? "var(--ink-0)" : "var(--ink-0)",
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
        <button style={{
          all: "unset", cursor: "pointer", color: isBold ? "rgba(255,255,255,.85)" : "var(--ink-500)",
          fontSize: 13, fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 4,
        }}>
          <Icon name="user-round" size={14} /> Maya C.
        </button>
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
            padding: "12px 14px", background: "var(--aero-electric-50)",
            border: "1.5px solid var(--aero-electric-200)", borderRadius: 14,
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
            padding: "12px 14px", background: "var(--aero-yellow-50)",
            border: "1.5px solid var(--aero-yellow-300)", borderRadius: 14,
          }}>
            <div style={{ width: 32, height: 32, borderRadius: 10, background: "var(--aero-yellow-300)", color: "var(--ink-800)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Icon name="gift" size={18} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 14 }}>{promo.code}</div>
              <div style={{ fontSize: 12, color: "var(--ink-600)" }}>−${promo.amount.toFixed(2)} off</div>
            </div>
            <Icon name="x" size={16} stroke={2} />
          </div>
        )}
      </div>

      {/* totals */}
      <div style={{
        padding: "16px 22px",
        background: "var(--ink-50)",
        borderTop: "1px solid var(--ink-100)",
      }}>
        <Totals subtotal={subtotal} discount={discount} memberDiscount={memberDiscount} tax={tax} total={total} />
        <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
          <button className="t-btn t-btn--ghost" style={{ flex: 1 }}>
            <Icon name="bookmark-plus" size={18} />Hold
          </button>
          <button className="t-btn t-btn--secondary" style={{ flex: 1 }}>
            <Icon name="gift" size={18} />Promo
          </button>
        </div>
        <button
          className="t-btn t-btn--primary t-btn--xl t-btn--block"
          style={{ marginTop: 10 }}
          onClick={onCheckout}
          disabled={items.length === 0}
        >
          <Icon name="credit-card" size={22} />
          Take payment · <span className="num">${total.toFixed(2)}</span>
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
    </div>
  );
}

function Totals({ subtotal, discount, memberDiscount, tax, total }) {
  const Row = ({ label, amount, muted, bold }) => (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", fontSize: bold ? 16 : 14, fontWeight: bold ? 700 : 500, color: muted ? "var(--ink-500)" : "var(--ink-800)" }}>
      <span>{label}</span>
      <span className="num">${amount.toFixed(2)}</span>
    </div>
  );
  return (
    <div>
      <Row label="Subtotal" amount={subtotal} muted />
      {discount > 0 && <Row label="Promo" amount={-discount} muted />}
      {memberDiscount > 0 && <Row label="Member 10%" amount={-memberDiscount} muted />}
      <Row label="Tax (5%)" amount={tax} muted />
      <div style={{ height: 1, background: "var(--ink-100)", margin: "6px 0" }} />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <span style={{ fontWeight: 700, fontSize: 14, textTransform: "uppercase", letterSpacing: ".06em" }}>Total</span>
        <span className="display-num" style={{ fontSize: 36 }}>${total.toFixed(2)}</span>
      </div>
    </div>
  );
}
