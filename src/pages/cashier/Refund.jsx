import React, { useState } from 'react';
import { Icon } from './Icon';

export function Refund() {
  const [step, setStep] = useState("find");

  if (step === "done") {
    return (
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", padding: 40 }}>
        <div style={{ width: 96, height: 96, borderRadius: 30, background: "var(--color-success)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 8px 0 #0e6638", border: "2px solid var(--ink-800)" }}>
          <Icon name="check" size={56} stroke={3} />
        </div>
        <h1 style={{ fontFamily: "var(--font-display)", fontSize: 48, fontWeight: 800, letterSpacing: "-.02em", margin: "20px 0 6px" }}>Refunded $42.00</h1>
        <div style={{ fontSize: 16, color: "var(--ink-600)", marginBottom: 22 }}>Returned to Visa •• 4421</div>
        <div style={{ display: "flex", gap: 10 }}>
          <button className="t-btn t-btn--secondary t-btn--lg"><Icon name="printer" size={20} />Print</button>
          <button onClick={() => setStep("find")} className="t-btn t-btn--primary t-btn--lg"><Icon name="arrow-right" size={20} />Done</button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
      <div style={{ flex: 1, padding: "24px 28px", overflowY: "auto" }}>
        <div className="eyebrow">Refund</div>
        <h1 style={{ margin: "4px 0 18px", fontFamily: "var(--font-display)", fontSize: 36, fontWeight: 800, letterSpacing: "-.02em" }}>Find the original sale</h1>

        <div style={{ display: "flex", gap: 10, marginBottom: 22 }}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 10, padding: "12px 18px", background: "#fff", border: "1.5px solid var(--ink-200)", borderRadius: 14, flex: 1 }}>
            <Icon name="search" size={20} stroke={2} style={{ color: "var(--ink-500)" }} />
            <input defaultValue="TXN_8F2A·19042" style={{ all: "unset", flex: 1, fontSize: 16, fontFamily: "var(--font-mono)" }} />
          </div>
          <button className="t-btn t-btn--secondary"><Icon name="qr-code" size={18} />Scan</button>
        </div>

        <div style={{ background: "#fff", border: "2px solid var(--ink-800)", borderRadius: 18, padding: 18, marginBottom: 18 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
            <div>
              <div className="eyebrow">Original sale</div>
              <div style={{ fontFamily: "var(--font-mono)", fontSize: 14, marginTop: 2 }}>TXN_8F2A·19042 · Apr 25 2:14 PM</div>
              <div style={{ fontSize: 13, color: "var(--ink-500)", marginTop: 2 }}>Maya C. · Visa •• 4421</div>
            </div>
            <div className="display-num" style={{ fontSize: 32 }}>$84.50</div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 12 }}>
            {[
              { name: "60-min Adult × 2", price: 48 },
              { name: "Slushie 22oz", price: 6.5 },
            ].map((it, i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 14 }}>
                <span>{it.name}</span>
                <span>${it.price.toFixed(2)}</span>
              </div>
            ))}
          </div>
        </div>

        <button onClick={() => setStep("preview")} className="t-btn t-btn--primary t-btn--xl t-btn--block">
          <Icon name="arrow-right" size={22} />Refund $42.00
        </button>
      </div>
    </div>
  );
}
