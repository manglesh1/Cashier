// Minimal cashier login screen — same /api/auth/login backend as the
// admin app. Cashier role users hit this URL on the terminal; admins
// can use it too if they want to act as a cashier.

import React, { useState } from "react";
import { toast } from "sonner";
import { useLoginMutation } from "../features/auth/authApi";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [login, { isLoading }] = useLoginMutation();

  const onSubmit = async (e) => {
    e.preventDefault();
    try {
      await login({ email, password }).unwrap();
      toast.success("Signed in");
    } catch (err) {
      toast.error(err?.data?.message || "Sign-in failed");
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
      </form>
    </div>
  );
}
