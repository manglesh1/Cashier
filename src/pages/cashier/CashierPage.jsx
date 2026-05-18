import React, { useEffect, useState } from "react";
import { CashierApp } from "./CashierApp";

// Cashier shell. Fill the real viewport so catalog and cart panels can
// handle their own scrolling on every POS screen size.
export default function CashierPage() {
  const [isLucideReady, setIsLucideReady] = useState(false);

  // Load Lucide once. CashierApp's <Icon> component looks for window.lucide.
  useEffect(() => {
    if (window.lucide) {
      setIsLucideReady(true);
      return;
    }
    const script = document.createElement("script");
    script.src = "https://unpkg.com/lucide@latest";
    script.async = true;
    script.onload = () => {
      setIsLucideReady(true);
      if (window.lucide && window.lucide.createIcons) window.lucide.createIcons();
    };
    document.body.appendChild(script);
    return () => {
      document.body.removeChild(script);
    };
  }, []);

  useEffect(() => {
    if (isLucideReady && window.lucide && window.lucide.createIcons) {
      window.lucide.createIcons();
    }
  }, [isLucideReady]);

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
        {isLucideReady ? (
          <CashierApp />
        ) : (
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
            Loading...
          </div>
        )}
      </div>
    </div>
  );
}
