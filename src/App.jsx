// Auth gate — three states the cashier walks through:
//   1. No terminal paired → PairTerminal (PIN entry)
//   2. Terminal paired but not signed in → ClockIn (tile + PIN)
//                                          ↓ "Use email instead"
//                                       → Login (email + password fallback)
//   3. Both → CashierPage (the actual app)
//
// Pairing is per-tablet and survives sign-out; only "Switch terminal"
// (or admin unpair) clears it. Sign-out clears just the auth token.

import React, { useState } from "react";
import { useSelector } from "react-redux";
import { Toaster } from "sonner";
import CashierPage from "./pages/cashier/CashierPage";
import Login from "./pages/Login";
import ClockIn from "./pages/ClockIn";
import PairTerminal from "./pages/PairTerminal";
import { getTerminal } from "./lib/terminal";

export default function App() {
  const token = useSelector((s) => s.auth?.token);
  // bump after pairing/unpairing so we re-read localStorage
  const [, setPairingTick] = useState(0);
  // Toggle between ClockIn (default) and email fallback
  const [authMode, setAuthMode] = useState("pin"); // "pin" | "email"
  const terminal = getTerminal();

  let body;
  if (!terminal) {
    body = <PairTerminal onPaired={() => setPairingTick((t) => t + 1)} />;
  } else if (!token) {
    body =
      authMode === "email" ? (
        <Login onUsePinLogin={() => setAuthMode("pin")} />
      ) : (
        <ClockIn onUseEmailLogin={() => setAuthMode("email")} />
      );
  } else {
    body = <CashierPage />;
  }

  return (
    <>
      {body}
      <Toaster
        position="top-center"
        richColors
        toastOptions={{
          style: {
            border: "2px solid var(--ink-800)",
            fontFamily: "var(--font-sans)",
          },
        }}
      />
    </>
  );
}
