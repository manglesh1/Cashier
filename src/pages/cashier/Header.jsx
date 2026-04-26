import React from 'react';

export function Header({ title, subtitle, right, breadcrumb }) {
  return (
    <header style={{
      height: 72, background: "var(--ink-0)", borderBottom: "1px solid var(--ink-100)",
      display: "flex", alignItems: "center", padding: "0 28px", gap: 20, flexShrink: 0,
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        {breadcrumb && (
          <div className="eyebrow" style={{ marginBottom: 2 }}>{breadcrumb}</div>
        )}
        <div style={{ display: "flex", alignItems: "baseline", gap: 14, whiteSpace: "nowrap" }}>
          <h1 style={{ margin: 0, fontFamily: "var(--font-display)", fontWeight: 800, fontSize: 26, letterSpacing: "-.02em", whiteSpace: "nowrap" }}>{title}</h1>
          {subtitle && <span style={{ color: "var(--ink-500)", fontSize: 14, whiteSpace: "nowrap" }}>{subtitle}</span>}
        </div>
      </div>
      {right}
    </header>
  );
}
