// Cashier login — accepts email + password, sends pairedVenueId/Id so
// the backend can refuse staff who don't have access to the venue this
// tablet is paired to.

import React, { useState } from "react";
import { toast } from "sonner";
import { useLoginMutation } from "../features/auth/authApi";
import { getTerminal, clearTerminal } from "../lib/terminal";

export default function Login({ onUsePinLogin }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [login, { isLoading }] = useLoginMutation();
  const terminal = getTerminal();

  const onSubmit = async (e) => {
    e.preventDefault();
    try {
      await login({
        email,
        password,
        pairedVenueId: terminal?.venueId,
        pairedDeviceId: terminal?.deviceId,
      }).unwrap();
      toast.success("Signed in");
    } catch (err) {
      // Surface every plausible failure shape — fetch errors don't have
      // err.data, RTK Query auth errors do, plain HTTP errors carry status.
      console.error("Cashier login error:", err);
      const msg =
        err?.data?.message ||
        err?.data?.error ||
        err?.error ||
        (err?.status === "FETCH_ERROR" && "Can't reach the API. Check VITE_API_BASE_URL in .env, then restart npm run dev.") ||
        (err?.status === "PARSING_ERROR" && "API returned non-JSON. Check the URL is correct.") ||
        (typeof err?.status === "number" && `HTTP ${err.status}${err.data ? ` — ${JSON.stringify(err.data).slice(0, 120)}` : ""}`) ||
        err?.message ||
        "Sign-in failed (check the browser console for details)";
      toast.error(String(msg), { duration: 6000 });
    }
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--ink-25)",
        padding: 20,
      }}
    >
      <form
        onSubmit={onSubmit}
        style={{
          background: "white",
          border: "2px solid var(--ink-800)",
          borderRadius: 18,
          padding: 32,
          boxShadow: "0 6px 0 var(--ink-800)",
          width: "min(420px, 100%)",
        }}
      >
        {terminal && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "10px 12px",
              background: "var(--aero-orange-50)",
              border: "1.5px solid var(--aero-orange-300)",
              borderRadius: 12,
              marginBottom: 18,
            }}
          >
            <span
              style={{
                width: 32, height: 32, borderRadius: 8,
                background: "var(--aero-orange-500)",
                color: "white",
                display: "inline-flex", alignItems: "center", justifyContent: "center",
                fontWeight: 800, fontSize: 12,
                border: "1.5px solid var(--ink-800)",
                flexShrink: 0,
              }}
            >
              {String(terminal.deviceName || "?").slice(0, 2).toUpperCase()}
            </span>
            <div style={{ flex: 1, lineHeight: 1.2, textAlign: "left" }}>
              <div style={{ fontWeight: 800, fontSize: 13, color: "var(--ink-900)" }}>
                {terminal.deviceName}
              </div>
              <div style={{ fontSize: 11, color: "var(--ink-600)", fontWeight: 600 }}>
                {terminal.venueName || `Venue ${terminal.venueId}`}
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                if (window.confirm("Unpair this terminal? You'll need a new pairing code.")) {
                  clearTerminal();
                  window.location.reload();
                }
              }}
              style={{
                background: "transparent",
                border: "none",
                color: "var(--ink-500)",
                fontSize: 11,
                fontWeight: 700,
                cursor: "pointer",
                textDecoration: "underline",
                padding: 4,
              }}
            >
              Switch
            </button>
          </div>
        )}

        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 24 }}>
          <div
            style={{
              width: 56, height: 56, borderRadius: 16,
              background: "var(--aero-orange-500)",
              border: "2px solid var(--ink-800)",
              color: "white",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontFamily: "var(--font-display)", fontSize: 28, fontWeight: 800,
              boxShadow: "0 5px 0 var(--aero-orange-700)",
            }}
          >
            A
          </div>
          <div>
            <div style={{ fontFamily: "var(--font-display)", fontSize: 24, fontWeight: 800, color: "var(--ink-900)", lineHeight: 1 }}>
              Cashier
            </div>
            <div style={{ fontSize: 12, color: "var(--ink-500)", fontWeight: 600, marginTop: 2 }}>
              Aerosports terminal
            </div>
          </div>
        </div>

        <label style={{ display: "block", fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--ink-500)", marginBottom: 6 }}>
          Email
        </label>
        <input
          type="email"
          autoFocus
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          style={{
            width: "100%",
            padding: "12px 14px",
            borderRadius: 12,
            border: "1.5px solid var(--ink-300)",
            background: "white",
            fontSize: 15,
            color: "var(--ink-900)",
            marginBottom: 14,
            boxSizing: "border-box",
          }}
        />

        <label style={{ display: "block", fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--ink-500)", marginBottom: 6 }}>
          Password
        </label>
        <input
          type="password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          style={{
            width: "100%",
            padding: "12px 14px",
            borderRadius: 12,
            border: "1.5px solid var(--ink-300)",
            background: "white",
            fontSize: 15,
            color: "var(--ink-900)",
            marginBottom: 22,
            boxSizing: "border-box",
          }}
        />

        <button
          type="submit"
          disabled={isLoading}
          className="a-btn a-btn--primary"
          style={{ width: "100%", justifyContent: "center", padding: "14px 16px", fontSize: 16 }}
        >
          {isLoading ? "Signing in…" : "Sign in"}
        </button>

        {onUsePinLogin && (
          <div style={{ marginTop: 18, paddingTop: 14, borderTop: "1.5px solid var(--ink-100)", textAlign: "center" }}>
            <button
              type="button"
              onClick={onUsePinLogin}
              style={{
                background: "transparent",
                border: "none",
                color: "var(--ink-500)",
                fontSize: 12,
                fontWeight: 700,
                cursor: "pointer",
                textDecoration: "underline",
              }}
            >
              Use PIN clock-in instead
            </button>
          </div>
        )}
      </form>
    </div>
  );
}
