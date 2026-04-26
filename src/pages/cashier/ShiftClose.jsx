import React, { useState } from 'react';
import { Icon } from './Icon';
import { StatusPill } from './StatusPill';

export function ShiftClose() {
  const expected = { cash: 482.50, card: 3214.20, gift: 88.00, tips: 142.00 };
  const [counted, setCounted] = useState(478.00);
  const variance = counted - expected.cash;

  const sales = [
    { cat: "Jump time", count: 184, total: 3782 },
    { cat: "Add-ons",   count: 96,  total: 412 },
    { cat: "Snack bar", count: 122, total: 488 },
    { cat: "Parties",   count: 4,   total: 1648 },
  ];

  return (
    <div style={{ flex: 1, overflowY: "auto", padding: "24px 28px" }}>
      <div className="eyebrow" style={{ marginBottom: 4 }}>Maya C. · 7h 18m</div>
      <h1 style={{ margin: "4px 0 18px", fontFamily: "var(--font-display)", fontSize: 36, fontWeight: 800, letterSpacing: "-.02em" }}>End shift</h1>

      <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: 20 }}>
        <div>
          <div style={{ background: "#fff", border: "1.5px solid var(--ink-200)", borderRadius: 14, padding: "18px", marginBottom: 20 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <h2 style={{ margin: 0, fontFamily: "var(--font-display)", fontSize: 18, fontWeight: 800 }}>Cash drawer</h2>
              <StatusPill tone={Math.abs(variance) < 1 ? "success" : "warning"}>{variance >= 0 ? "+" : ""}${variance.toFixed(2)}</StatusPill>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, marginBottom: 14 }}>
              {[
                { d: "$100", n: 2 }, { d: "$50", n: 4 }, { d: "$20", n: 8 },
              ].map(b => (
                <div key={b.d} style={{ background: "var(--ink-50)", borderRadius: 12, padding: "10px 12px", display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{ width: 56, fontFamily: "var(--font-display)", fontWeight: 800, fontSize: 14 }}>{b.d}</div>
                  <input defaultValue={b.n} style={{ all: "unset", flex: 1, fontSize: 16, fontWeight: 700, textAlign: "center", background: "#fff", border: "1.5px solid var(--ink-200)", borderRadius: 8, padding: "6px 0" }} />
                </div>
              ))}
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", padding: "12px 14px", background: "var(--ink-800)", color: "#fff", borderRadius: 12 }}>
              <span style={{ fontWeight: 700 }}>Total counted</span>
              <span className="display-num" style={{ fontSize: 20, color: "var(--aero-yellow-300)" }}>${counted.toFixed(2)}</span>
            </div>
          </div>

          <div style={{ background: "#fff", border: "1.5px solid var(--ink-200)", borderRadius: 14, padding: "18px" }}>
            <h2 style={{ margin: "0 0 14px", fontFamily: "var(--font-display)", fontSize: 18, fontWeight: 800 }}>Sales by category</h2>
            <div>
              {sales.map(s => (
                <div key={s.cat} style={{ display: "flex", alignItems: "center", padding: "10px 0", borderBottom: "1px solid var(--ink-100)" }}>
                  <div style={{ flex: 1, fontWeight: 600 }}>{s.cat}</div>
                  <div style={{ fontSize: 12, color: "var(--ink-500)" }}>{s.count} txns</div>
                  <div className="display-num" style={{ fontSize: 16, minWidth: 80, textAlign: "right" }}>${s.total.toFixed(2)}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div>
          <button className="t-btn t-btn--primary t-btn--xl t-btn--block" style={{ marginBottom: 12 }}>
            <Icon name="check" size={22} />Submit shift
          </button>
          <button className="t-btn t-btn--secondary t-btn--block">Review summary</button>
        </div>
      </div>
    </div>
  );
}
