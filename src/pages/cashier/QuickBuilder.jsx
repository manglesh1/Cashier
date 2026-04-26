import React, { useState } from 'react';
import { Icon } from './Icon';

export function QuickBuilder({ onAdd }) {
  const [time, setTime] = useState(60);
  const [jumpers, setJumpers] = useState({ adult: 2, junior: 1, toddler: 0 });

  const prices = { 60: { adult: 24, junior: 18, toddler: 12 }, 90: { adult: 32, junior: 26, toddler: 16 } };
  const totalJumpers = jumpers.adult + jumpers.junior + jumpers.toddler;
  const subtotal = Object.entries(jumpers).reduce((s, [k, n]) => s + (prices[time][k] || 0) * n, 0);

  return (
    <div style={{ flex: 1, overflow: "hidden", display: "flex" }}>
      <div style={{ flex: 1, padding: "26px 32px", overflowY: "auto" }}>
        <h2 style={{ fontFamily: "var(--font-display)", fontSize: 22, fontWeight: 800, marginBottom: 12 }}>Build a package</h2>

        <h3 style={{ fontFamily: "var(--font-display)", fontSize: 18, fontWeight: 800, marginBottom: 10 }}>Session length</h3>
        <div style={{ display: "flex", gap: 12, marginBottom: 22 }}>
          {[
            { id: 60, label: "60 min", sub: "Standard" },
            { id: 90, label: "90 min", sub: "Most popular", badge: true },
          ].map(opt => (
            <button
              key={opt.id}
              onClick={() => setTime(opt.id)}
              style={{
                all: "unset", cursor: "pointer",
                flex: 1,
                background: time === opt.id ? "var(--aero-orange-500)" : "#fff",
                color: time === opt.id ? "#fff" : "var(--ink-800)",
                border: "2px solid var(--ink-800)",
                boxShadow: time === opt.id ? "0 6px 0 var(--aero-orange-700)" : "0 6px 0 var(--ink-800)",
                borderRadius: 20, padding: "20px 22px",
                display: "flex", flexDirection: "column", gap: 4,
                position: "relative",
              }}
            >
              {opt.badge && (
                <span style={{ position: "absolute", top: -10, right: 14, background: "var(--aero-yellow-300)", color: "var(--ink-800)", fontSize: 10, fontWeight: 800, padding: "4px 8px", borderRadius: 999, border: "2px solid var(--ink-800)" }}>POPULAR</span>
              )}
              <div className="display-num" style={{ fontSize: 32 }}>{opt.label}</div>
              <div style={{ fontSize: 13 }}>{opt.sub}</div>
            </button>
          ))}
        </div>

        <h3 style={{ fontFamily: "var(--font-display)", fontSize: 18, fontWeight: 800, marginBottom: 10 }}>Jumpers</h3>
        <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 20 }}>
          {[
            { key: "adult", label: "Adults (12+)" },
            { key: "junior", label: "Juniors (5–11)" },
            { key: "toddler", label: "Toddlers (0–4)" },
          ].map(cat => (
            <div key={cat.key} style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", background: "#fff", border: "1.5px solid var(--ink-200)", borderRadius: 14 }}>
              <span style={{ flex: 1, fontWeight: 600 }}>{cat.label}</span>
              <div style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 8px", background: "var(--ink-50)", borderRadius: 999 }}>
                <button onClick={() => setJumpers({ ...jumpers, [cat.key]: Math.max(0, jumpers[cat.key] - 1) })} style={{ all: "unset", cursor: "pointer", width: 24, height: 24, display: "inline-flex", alignItems: "center", justifyContent: "center", fontWeight: 700 }}>−</button>
                <span style={{ minWidth: 20, textAlign: "center", fontWeight: 700 }}>{jumpers[cat.key]}</span>
                <button onClick={() => setJumpers({ ...jumpers, [cat.key]: jumpers[cat.key] + 1 })} style={{ all: "unset", cursor: "pointer", width: 24, height: 24, display: "inline-flex", alignItems: "center", justifyContent: "center", fontWeight: 700 }}>+</button>
              </div>
            </div>
          ))}
        </div>

        <button
          className="t-btn t-btn--primary t-btn--xl t-btn--block"
          onClick={() => onAdd({ name: "Custom package", meta: `${time}min · ${totalJumpers} jumpers`, price: subtotal, qty: 1, icon: "package" })}
          disabled={totalJumpers === 0}
        >
          <Icon name="plus" size={22} />Add to cart · ${subtotal.toFixed(2)}
        </button>
      </div>
    </div>
  );
}
