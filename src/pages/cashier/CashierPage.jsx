import React, { useEffect, useRef, useState } from "react";
import { CashierApp } from "./CashierApp";

// Cashier shell — fits the 1920×1080 design canvas to the viewport via
// transform scale, loads Lucide for the icon library, and serves as the
// only route in the dedicated Cashier app.

export default function CashierPage() {
  const scaleFrameRef = useRef(null);
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

  // Fit the 1920×1080 design surface to the actual viewport
  useEffect(() => {
    const fit = () => {
      const frame = scaleFrameRef.current;
      if (!frame) return;
      const scale = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
      frame.style.transform = `scale(${scale})`;
      frame.style.transformOrigin = "top left";
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);

  return (
    <div
      data-pos="cashier"
      style={{
        width: "100vw",
        height: "100vh",
        background: "#000",
        overflow: "hidden",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        ref={scaleFrameRef}
        style={{
          width: 1920,
          height: 1080,
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
            Loading…
          </div>
        )}
      </div>
    </div>
  );
}
