import React, { useState } from 'react';
import { Icon } from './Icon';

export function WaveBoard({ onAdd }) {
  const [activeWave, setActiveWave] = useState(2);
  const waves = [
    { id: 0, time: "1:00 PM", state: "running",  capacity: 60, sold: 58 },
    { id: 1, time: "1:30 PM", state: "running",  capacity: 60, sold: 41 },
    { id: 2, time: "2:00 PM", state: "selling",  capacity: 60, sold: 34 },
    { id: 3, time: "2:30 PM", state: "selling",  capacity: 60, sold: 12 },
    { id: 4, time: "3:00 PM", state: "selling",  capacity: 60, sold: 4 },
    { id: 5, time: "3:30 PM", state: "open",     capacity: 60, sold: 0 },
    { id: 6, time: "4:00 PM", state: "open",     capacity: 60, sold: 0 },
    { id: 7, time: "4:30 PM", state: "open",     capacity: 60, sold: 0 },
  ];

  return (
    <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
      <div style={{ padding: "16px 28px", display: "flex", gap: 10, alignItems: "center", borderBottom: "1px solid var(--ink-100)" }}>
        <h2>Wave selection</h2>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "22px 28px" }}>
        <h3 style={{ margin: "0 0 12px", fontFamily: "var(--font-display)", fontSize: 22, fontWeight: 800 }}>Pick a wave</h3>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
          {waves.map(w => (
            <button
              key={w.id}
              onClick={() => setActiveWave(w.id)}
              style={{
                all: "unset", cursor: "pointer",
                background: w.id === activeWave ? "var(--aero-orange-500)" : "#fff",
                color: w.id === activeWave ? "#fff" : "var(--ink-800)",
                border: "2px solid var(--ink-800)",
                borderRadius: 18,
                boxShadow: w.id === activeWave ? "0 6px 0 var(--aero-orange-700)" : "0 6px 0 var(--ink-800)",
                padding: 18,
                display: "flex", flexDirection: "column", gap: 4,
              }}
            >
              <div style={{ fontFamily: "var(--font-display)", fontSize: 20, fontWeight: 800 }}>{w.time}</div>
              <div style={{ fontSize: 12, opacity: .85 }}>{w.sold} / {w.capacity} sold</div>
            </button>
          ))}
        </div>

        <h3 style={{ margin: "28px 0 12px", fontFamily: "var(--font-display)", fontSize: 22, fontWeight: 800 }}>Add jumpers</h3>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14 }}>
          {[
            { id: "adult",   name: "Adult",   sub: "Ages 12+",   price: 24, icon: "user-round" },
            { id: "junior",  name: "Junior",  sub: "Ages 5–11",  price: 18, icon: "user-round" },
            { id: "toddler", name: "Toddler", sub: "Ages 0–4",   price: 12, icon: "baby" },
            { id: "spect",   name: "Spectator", sub: "No jumping", price: 0, icon: "armchair" },
          ].map(it => (
            <button
              key={it.id}
              onClick={() => onAdd({ ...it, name: `${it.name} · ${waves[activeWave].time}`, meta: `Wave ${activeWave + 1} · 60 min`, qty: 1 })}
              style={{
                all: "unset", cursor: "pointer",
                background: "#fff",
                border: "2px solid var(--ink-800)",
                borderRadius: 18,
                boxShadow: "0 5px 0 var(--ink-800)",
                padding: 16,
                display: "flex", flexDirection: "column", gap: 10,
              }}
            >
              <div style={{ width: 44, height: 44, borderRadius: 12, background: "var(--aero-orange-50)", color: "var(--aero-orange-600)", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
                <Icon name={it.icon} size={24} />
              </div>
              <div>
                <div style={{ fontWeight: 700, fontSize: 16 }}>{it.name}</div>
                {it.sub && <div style={{ fontSize: 12, color: "var(--ink-500)", marginTop: 2 }}>{it.sub}</div>}
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
