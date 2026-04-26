import React from 'react';

export function Header({ title, subtitle, right, breadcrumb, venue, terminal }) {
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
      {/* Venue + terminal pinned chip — surfaces on every screen so the
          cashier always knows which park / lane they're operating. */}
      {(venue || terminal) && (
        <div style={{
          display: "flex", flexDirection: "column", alignItems: "flex-end",
          padding: "6px 12px", borderRadius: 10,
          background: "var(--ink-50)", border: "1px solid var(--ink-100)",
          maxWidth: 240,
        }} title={venue ? `Park: ${venue}${terminal ? ` · Lane: ${terminal}` : ""}` : terminal}>
          {venue && (
            <span style={{
              fontSize: 12, fontWeight: 800, color: "var(--ink-900)",
              maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>{venue}</span>
          )}
          {terminal && (
            <span style={{
              fontSize: 10, fontWeight: 700, letterSpacing: "0.05em",
              color: "var(--ink-500)", textTransform: "uppercase",
            }}>{terminal}</span>
          )}
        </div>
      )}
      {right}
    </header>
  );
}
