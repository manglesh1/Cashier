import React from "react";
import { CashierApp } from "./CashierApp";

// Cashier shell. Fill the real viewport so catalog and cart panels can
// handle their own scrolling on every POS screen size.
//
// Lucide is now bundled (see main.jsx) — no more CDN gate / Loading… state.
export default function CashierPage() {
  return (
    <div
      data-pos="cashier"
      style={{
        width: "100vw",
        height: "100dvh",
        minHeight: 0,
        background: "var(--ink-25)",
        overflow: "hidden",
        display: "flex",
      }}
    >
      <div
        style={{
          width: "100%",
          height: "100%",
          minWidth: 0,
          minHeight: 0,
          background: "var(--ink-25)",
          color: "var(--ink-800)",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <CashierApp />
      </div>
    </div>
  );
}
