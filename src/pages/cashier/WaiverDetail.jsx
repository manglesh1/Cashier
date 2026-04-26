import React from 'react';
import { Icon } from './Icon';

export function WaiverDetail() {
  return (
    <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
      <div style={{ flex: 1, padding: "24px 28px", overflowY: "auto" }}>
        <div className="eyebrow">Waivers</div>
        <h1 style={{ margin: "4px 0 18px", fontFamily: "var(--font-display)", fontSize: 36, fontWeight: 800, letterSpacing: "-.02em" }}>Arjun Patel · waiver expired</h1>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 22 }}>
          <div style={{ background: "#fff", border: "1.5px solid var(--ink-200)", borderRadius: 14, padding: 14 }}>
            <div className="eyebrow">Status</div>
            <div style={{ marginTop: 8, fontWeight: 700 }}>Expired 14 days ago</div>
          </div>
          <div style={{ background: "#fff", border: "1.5px solid var(--ink-200)", borderRadius: 14, padding: 14 }}>
            <div className="eyebrow">Age</div>
            <div style={{ marginTop: 8, fontWeight: 700 }}>8 yrs</div>
          </div>
          <div style={{ background: "#fff", border: "1.5px solid var(--ink-200)", borderRadius: 14, padding: 14 }}>
            <div className="eyebrow">Guardian</div>
            <div style={{ marginTop: 8, fontWeight: 700 }}>Raj Patel</div>
          </div>
          <div style={{ background: "#fff", border: "1.5px solid var(--ink-200)", borderRadius: 14, padding: 14 }}>
            <div className="eyebrow">Signed</div>
            <div style={{ marginTop: 8, fontWeight: 700 }}>Apr 11, 2025</div>
          </div>
        </div>

        <div style={{ background: "#fff", border: "1.5px solid var(--ink-200)", borderRadius: 14, padding: "18px", marginBottom: 20 }}>
          <h2 style={{ margin: "0 0 14px", fontFamily: "var(--font-display)", fontSize: 18, fontWeight: 800 }}>Document</h2>
          <div style={{ background: "var(--ink-50)", border: "1.5px solid var(--ink-100)", borderRadius: 14, padding: "20px 24px", fontSize: 14, lineHeight: 1.6, color: "var(--ink-700)", maxHeight: 200, overflow: "auto" }}>
            <div style={{ fontWeight: 800, fontSize: 16, color: "var(--ink-800)", fontFamily: "var(--font-display)" }}>Aerosports Liability Waiver</div>
            <div style={{ marginTop: 10 }}>I, Raj Patel, the legal parent or guardian of Arjun Patel, hereby acknowledge the inherent risks associated with trampoline activities...</div>
          </div>
        </div>

        <div style={{ background: "#fff", border: "1.5px solid var(--ink-200)", borderRadius: 14, padding: "18px" }}>
          <h2 style={{ margin: "0 0 14px", fontFamily: "var(--font-display)", fontSize: 18, fontWeight: 800 }}>Why it expired</h2>
          <ul style={{ margin: 0, paddingLeft: 20, fontSize: 14, color: "var(--ink-700)", lineHeight: 1.8 }}>
            <li>Annual waivers expire 365 days after signing.</li>
            <li>Location terms updated — requires re-acknowledgment.</li>
          </ul>
        </div>
      </div>

      <aside style={{ width: 460, padding: "24px 22px", background: "var(--ink-50)", borderLeft: "1px solid var(--ink-100)", display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ background: "#fff", border: "2px solid var(--color-danger)", borderRadius: 18, padding: 18, boxShadow: "0 5px 0 #8c2410" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, color: "var(--color-danger)" }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: "var(--color-danger-soft)", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
              <Icon name="shield-alert" size={20} />
            </div>
            <div style={{ fontFamily: "var(--font-display)", fontWeight: 800, fontSize: 22, lineHeight: 1.1 }}>Cannot jump</div>
          </div>
          <div style={{ fontSize: 14, color: "var(--ink-700)", marginTop: 10 }}>Arjun is blocked from check-in until re-signed.</div>
        </div>

        <div className="eyebrow">Resolve</div>
        <button className="t-btn t-btn--primary t-btn--block" style={{ height: 64, fontSize: 16 }}>
          <Icon name="pen-line" size={22} />Sign on tablet
        </button>
      </aside>
    </div>
  );
}
