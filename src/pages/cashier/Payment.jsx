import React, { useState } from 'react';
import { Icon } from './Icon';

export function Payment({ total = 128.40, onComplete }) {
  const [tenders, setTenders] = useState([
    { id: "t1", method: "card", label: "Visa terminal", amount: 80, status: "captured", last4: "4421" },
  ]);
  const paid = tenders.reduce((s, t) => s + t.amount, 0);
  const remaining = Math.max(0, total - paid);

  const tipPresets = [0, 0.10, 0.15, 0.20];
  const [tipPct, setTipPct] = useState(0);
  const tip = total * tipPct;

  const methods = [
    { id: "card", icon: "credit-card", label: "Card", desc: "Tap, swipe, insert" },
    { id: "cash", icon: "banknote", label: "Cash", desc: "Drawer auto-opens" },
    { id: "gift", icon: "gift", label: "Gift card", desc: "Scan or enter code" },
    { id: "credit", icon: "wallet", label: "Store credit", desc: "On account · $42.50 avail" },
    { id: "member", icon: "sparkles", label: "Member benefit", desc: "Free jump pass" },
  ];

  return (
    <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
      <div style={{ flex: 1, padding: "24px 28px", overflowY: "auto" }}>
        <div className="eyebrow">Step 2 of 3</div>
        <h1 style={{ margin: "4px 0 18px", fontFamily: "var(--font-display)", fontSize: 36, fontWeight: 800, letterSpacing: "-.02em" }}>Take payment</h1>

        <h2 style={{ margin: "0 0 10px", fontFamily: "var(--font-display)", fontSize: 18, fontWeight: 800 }}>Tip</h2>
        <div style={{ display: "flex", gap: 10, marginBottom: 22 }}>
          {tipPresets.map(p => (
            <button key={p} onClick={() => setTipPct(p)} className={"t-btn " + (tipPct === p ? "t-btn--primary" : "t-btn--secondary")} style={{ flex: 1, fontSize: 16 }}>
              {p === 0 ? "No tip" : `${(p * 100).toFixed(0)}%`}
              {p > 0 && <span style={{ opacity: .8, marginLeft: 6, fontSize: 13 }}>${(total * p).toFixed(2)}</span>}
            </button>
          ))}
          <button className="t-btn t-btn--ghost" style={{ flex: 1 }}>Custom</button>
        </div>

        <h2 style={{ margin: "0 0 10px", fontFamily: "var(--font-display)", fontSize: 18, fontWeight: 800 }}>Add a tender</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 12 }}>
          {methods.map(m => (
            <button
              key={m.id}
              onClick={() => setTenders([...tenders, { id: `t${Date.now()}`, method: m.id, label: m.label, amount: remaining, status: "pending" }])}
              disabled={remaining <= 0}
              style={{
                all: "unset", cursor: remaining > 0 ? "pointer" : "not-allowed",
                background: "#fff", border: "2px solid var(--ink-800)",
                borderRadius: 18, boxShadow: "0 5px 0 var(--ink-800)",
                padding: 18, display: "flex", alignItems: "center", gap: 14,
                opacity: remaining > 0 ? 1 : .4,
              }}
            >
              <div style={{ width: 56, height: 56, borderRadius: 16, background: "var(--aero-orange-50)", color: "var(--aero-orange-600)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Icon name={m.icon} size={28} />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontFamily: "var(--font-display)", fontSize: 22, fontWeight: 800, letterSpacing: "-.01em" }}>{m.label}</div>
                <div style={{ fontSize: 13, color: "var(--ink-500)" }}>{m.desc}</div>
              </div>
              <Icon name="chevron-right" size={22} style={{ color: "var(--ink-400)" }} />
            </button>
          ))}
        </div>

        <div style={{ marginTop: 20, padding: "14px 16px", background: "#fff", border: "1.5px solid var(--ink-100)", borderRadius: 14, display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 32, height: 32, borderRadius: 10, background: "#DDF3E3", color: "#0e6638", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Icon name="wifi" size={18} />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 14 }}>Terminal LANE-1 · paired</div>
            <div style={{ fontSize: 12, color: "var(--ink-500)" }}>Last batch closed 2:00 AM · 4 transactions in this batch</div>
          </div>
          <button className="t-btn t-btn--ghost" style={{ padding: "6px 12px", fontSize: 13 }}>Re-pair</button>
        </div>
      </div>

      <aside style={{ width: 480, padding: "24px 22px", background: "var(--ink-800)", color: "#fff", display: "flex", flexDirection: "column", gap: 14 }}>
        <div className="eyebrow" style={{ color: "rgba(255,255,255,.6)" }}>Due</div>
        <div className="display-num" style={{ fontSize: 80, color: "var(--aero-yellow-300)", lineHeight: 1 }}>${(total + tip).toFixed(2)}</div>
        <div style={{ fontSize: 14, color: "rgba(255,255,255,.7)" }}>${total.toFixed(2)} subtotal{tip > 0 && ` + $${tip.toFixed(2)} tip`}</div>

        <div style={{ height: 1, background: "rgba(255,255,255,.15)", margin: "8px 0" }} />

        <div className="eyebrow" style={{ color: "rgba(255,255,255,.6)" }}>Tendered</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {tenders.length === 0 && <div style={{ fontSize: 14, color: "rgba(255,255,255,.4)" }}>No tenders yet.</div>}
          {tenders.map(t => (
            <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", background: "rgba(255,255,255,.06)", borderRadius: 12 }}>
              <Icon name={t.method === "card" ? "credit-card" : t.method === "cash" ? "banknote" : t.method === "gift" ? "gift" : "wallet"} size={18} style={{ color: "var(--aero-yellow-300)" }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 14 }}>{t.label}{t.last4 && <span style={{ opacity: .6, marginLeft: 6 }}>•• {t.last4}</span>}</div>
                <div style={{ fontSize: 11, color: t.status === "captured" ? "#7ce39a" : "rgba(255,255,255,.5)", textTransform: "uppercase", letterSpacing: ".06em", fontWeight: 700 }}>{t.status}</div>
              </div>
              <div className="display-num" style={{ fontSize: 18 }}>${t.amount.toFixed(2)}</div>
            </div>
          ))}
        </div>

        <div style={{ marginTop: "auto" }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, marginBottom: 4, color: "rgba(255,255,255,.7)" }}>
            <span>Paid</span><span className="num">${paid.toFixed(2)}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 14 }}>
            <span style={{ fontWeight: 700 }}>Remaining</span>
            <span className="display-num" style={{ fontSize: 36, color: remaining > 0 ? "var(--aero-orange-400)" : "#7ce39a" }}>${remaining.toFixed(2)}</span>
          </div>
          <button
            className="t-btn t-btn--primary t-btn--xl t-btn--block"
            disabled={remaining > 0}
            onClick={onComplete}
          >
            <Icon name="check" size={22} stroke={3} />Complete sale
          </button>
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <button className="t-btn t-btn--ghost" style={{ flex: 1, color: "#fff" }}><Icon name="printer" size={16} />Print</button>
            <button className="t-btn t-btn--ghost" style={{ flex: 1, color: "#fff" }}><Icon name="mail" size={16} />Email</button>
            <button className="t-btn t-btn--ghost" style={{ flex: 1, color: "#fff" }}><Icon name="message-square" size={16} />SMS</button>
          </div>
        </div>
      </aside>
    </div>
  );
}
