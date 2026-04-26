import React, { useState } from 'react';
import { Icon } from './Icon';

// Sections come from props (loaded from the device's terminal template).
// Falls back to a single "Quick" section using whatever items the parent
// supplied if no sections array is given.
export function CatalogGrid({ sections = [], loading, error, onAdd }) {
  const [activeChip, setActiveChip] = useState("all");
  const [search, setSearch] = useState("");

  const visibleSections = sections
    .filter((s) => activeChip === "all" || s.title === activeChip)
    .map((s) => ({
      ...s,
      items: s.items.filter((it) => {
        if (!search) return true;
        const q = search.toLowerCase();
        return (
          (it.name || "").toLowerCase().includes(q) ||
          (it.sub || "").toLowerCase().includes(q) ||
          String(it.id || "").toLowerCase().includes(q)
        );
      }),
    }))
    .filter((s) => s.items.length > 0);

  return (
    <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
      {/* category chips */}
      <div style={{ padding: "16px 28px", display: "flex", gap: 10, alignItems: "center", borderBottom: "1px solid var(--ink-100)" }}>
        <SearchBar value={search} onChange={setSearch} />
        <div style={{ display: "flex", gap: 8, marginLeft: "auto", flexWrap: "wrap" }}>
          <button
            type="button"
            className={`chip ${activeChip === "all" ? "is-active" : ""}`}
            onClick={() => setActiveChip("all")}
            style={{ all: "unset", cursor: "pointer", padding: "6px 12px", borderRadius: 999, fontWeight: 700, fontSize: 12.5, color: activeChip === "all" ? "white" : "var(--ink-700)", background: activeChip === "all" ? "var(--ink-800)" : "white", border: "1.5px solid var(--ink-200)" }}
          >
            All
          </button>
          {sections.map((s) => (
            <button
              key={s.title}
              type="button"
              onClick={() => setActiveChip(s.title)}
              style={{ all: "unset", cursor: "pointer", padding: "6px 12px", borderRadius: 999, fontWeight: 700, fontSize: 12.5, color: activeChip === s.title ? "white" : "var(--ink-700)", background: activeChip === s.title ? "var(--ink-800)" : "white", border: "1.5px solid var(--ink-200)" }}
            >
              {s.title}
            </button>
          ))}
        </div>
      </div>

      {/* scrollable catalog */}
      <div style={{ flex: 1, overflowY: "auto", padding: "20px 28px 28px", display: "flex", flexDirection: "column", gap: 24 }}>
        {loading ? (
          <div style={{ padding: 60, textAlign: "center", color: "var(--ink-500)", fontWeight: 600 }}>
            Loading terminal template…
          </div>
        ) : error ? (
          <div style={{ padding: 60, textAlign: "center", color: "var(--color-danger)", fontWeight: 600 }}>
            Couldn't load this terminal's template. Pick a template in admin → POS → Terminals.
          </div>
        ) : visibleSections.length === 0 ? (
          <div style={{ padding: 60, textAlign: "center", color: "var(--ink-500)" }}>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>No activities in this template</div>
            <div style={{ fontSize: 13 }}>Configure sections in admin → POS → Terminal Presets.</div>
          </div>
        ) : (
          visibleSections.map((sec) => (
            <section key={sec.title}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 12 }}>
                <h2 style={{ margin: 0, fontFamily: "var(--font-display)", fontWeight: 800, fontSize: 22, letterSpacing: "-.01em" }}>{sec.title}</h2>
                <span className="eyebrow">{sec.items.length} item{sec.items.length === 1 ? "" : "s"}</span>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 14 }}>
                {sec.items.map((it) => (
                  <ProductCard key={it.id} item={it} tone={sec.tone} onClick={() => onAdd(it, sec)} />
                ))}
              </div>
            </section>
          ))
        )}
      </div>
    </div>
  );
}

function ProductCard({ item, tone = "orange", onClick }) {
  const accent = {
    orange:  { bg: "var(--aero-orange-50)",   fg: "var(--aero-orange-600)" },
    yellow:  { bg: "var(--aero-yellow-50)",   fg: "var(--aero-yellow-500)" },
    neutral: { bg: "var(--ink-50)",           fg: "var(--ink-700)" },
  }[tone];

  return (
    <button
      onClick={onClick}
      style={{
        all: "unset", cursor: "pointer",
        background: "var(--ink-0)",
        border: "2px solid var(--ink-800)",
        borderRadius: 18,
        boxShadow: "0 5px 0 var(--ink-800)",
        padding: 16,
        display: "flex", flexDirection: "column", gap: 10,
        transition: "transform var(--dur-fast) var(--ease-bounce), box-shadow var(--dur-fast)",
        position: "relative",
      }}
      onMouseDown={e => e.currentTarget.style.transform = "translateY(5px)"}
      onMouseUp={e => e.currentTarget.style.transform = ""}
      onMouseLeave={e => e.currentTarget.style.transform = ""}
    >
      {item.badge && (
        <span style={{
          position: "absolute", top: -10, right: 14,
          background: "var(--aero-yellow-300)", color: "var(--ink-800)",
          fontSize: 10, fontWeight: 800, letterSpacing: ".08em",
          padding: "4px 8px", borderRadius: 999, border: "2px solid var(--ink-800)",
        }}>{item.badge}</span>
      )}
      <div style={{
        width: 44, height: 44, borderRadius: 12,
        background: accent.bg, color: accent.fg,
        display: "inline-flex", alignItems: "center", justifyContent: "center",
      }}>
        <Icon name={item.icon} size={24} />
      </div>
      <div style={{ minHeight: 44 }}>
        <div style={{ fontWeight: 700, fontSize: 16, lineHeight: 1.2 }}>{item.name}</div>
        {item.sub && <div style={{ fontSize: 12, color: "var(--ink-500)", marginTop: 2 }}>{item.sub}</div>}
      </div>
      <div className="display-num" style={{ fontSize: 24 }}>
        {Number.isFinite(item.price) ? `$${Number(item.price).toFixed(2)}` : "—"}
      </div>
    </button>
  );
}

function SearchBar({ value, onChange }) {
  return (
    <div style={{
      display: "inline-flex", alignItems: "center", gap: 10,
      padding: "10px 14px", background: "#fff",
      border: "1.5px solid var(--ink-200)", borderRadius: 14,
      width: 320, flexShrink: 0,
    }}>
      <Icon name="search" size={18} stroke={2} style={{ color: "var(--ink-500)" }} />
      <input
        value={value}
        onChange={(e) => onChange?.(e.target.value)}
        placeholder="Scan or search SKU, member, party…"
        style={{ all: "unset", flex: 1, fontSize: 14, color: "var(--ink-800)" }}
      />
      <kbd style={{ fontSize: 10, color: "var(--ink-500)", fontFamily: "var(--font-mono)", padding: "2px 6px", background: "var(--ink-50)", borderRadius: 4 }}>⌘ K</kbd>
    </div>
  );
}

// Default fallback price when the preset doesn't carry one (e.g. linked to
// a variation that lives on the variations table; cashier shows "—" then).
ProductCard.displayName = "ProductCard";
