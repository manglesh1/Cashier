import React from 'react';
import { Icon } from './Icon';
import { LogoMark } from './LogoMark';

export function Sidebar({ active = "sell", onNav }) {
  const items = [
    { id: "sell",      icon: "ticket",       label: "Sell" },
    { id: "parties",   icon: "party-popper", label: "Parties" },
    { id: "members",   icon: "sparkles",     label: "Members" },
    { id: "waivers",   icon: "shield-check", label: "Waivers" },
    { id: "shop",      icon: "shirt",        label: "Shop" },
    { id: "reports",   icon: "bar-chart-3",  label: "Reports" },
  ];

  return (
    <aside style={{
      width: 88, background: "var(--ink-800)", color: "var(--ink-0)",
      display: "flex", flexDirection: "column", alignItems: "center",
      padding: "20px 0", flexShrink: 0,
    }}>
      <div style={{ marginBottom: 20 }}><LogoMark size={48} /></div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, flex: 1, width: "100%", padding: "0 10px" }}>
        {items.map(it => {
          const isActive = it.id === active;
          return (
            <button key={it.id} onClick={() => onNav && onNav(it.id)} style={{
              all: "unset", cursor: "pointer",
              display: "flex", flexDirection: "column", alignItems: "center", gap: 4,
              padding: "12px 6px",
              borderRadius: 14,
              background: isActive ? "var(--aero-orange-500)" : "transparent",
              color: isActive ? "#fff" : "rgba(255,255,255,.72)",
              transition: "background .15s",
            }}>
              <Icon name={it.icon} size={24} stroke={1.75} />
              <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".02em" }}>{it.label}</span>
            </button>
          );
        })}
      </div>
      <button style={{
        all: "unset", cursor: "pointer",
        display: "flex", flexDirection: "column", alignItems: "center", gap: 4,
        padding: "12px 6px", borderRadius: 14, color: "rgba(255,255,255,.6)",
      }}>
        <Icon name="log-out" size={22} />
        <span style={{ fontSize: 11, fontWeight: 700 }}>End shift</span>
      </button>
    </aside>
  );
}
