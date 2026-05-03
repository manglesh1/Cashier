// Auth gate — three states the cashier walks through:
//   1. No terminal paired → PairTerminal (PIN entry)
//   2. Terminal paired but not signed in → ClockIn (tile + PIN)
//                                          ↓ "Use email instead"
//                                       → Login (email + password fallback)
//   3. Both → CashierPage (the actual app)
//
// Pairing is per-tablet and survives sign-out; only "Switch terminal"
// (or admin unpair) clears it. Sign-out clears just the auth token.

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { Toaster, toast } from "sonner";
import CashierPage from "./pages/cashier/CashierPage";
import Login from "./pages/Login";
import ClockIn from "./pages/ClockIn";
import PairTerminal from "./pages/PairTerminal";
import { getTerminal } from "./lib/terminal";
import { logout } from "./features/auth/authSlice";

export default function App() {
  const token = useSelector((s) => s.auth?.token);
  const session = useSelector((s) => s.auth?.session);
  const dispatch = useDispatch();
  // bump after pairing/unpairing so we re-read localStorage
  const [, setPairingTick] = useState(0);
  // Toggle between ClockIn (default) and email fallback
  const [authMode, setAuthMode] = useState("pin"); // "pin" | "email"
  const terminal = getTerminal();
  const expiredToastShown = useRef(false);
  const isSessionExpired = useMemo(() => {
    if (!token) return false;
    if (!session?.expiresAt) return true;
    return Date.now() >= Number(session.expiresAt);
  }, [session?.expiresAt, token]);

  const expireCashierSession = useCallback(() => {
    if (!token) return;
    dispatch(logout());
    setAuthMode("pin");
    if (!expiredToastShown.current) {
      expiredToastShown.current = true;
      toast.info("Cashier session expired. Please clock in again.");
    }
  }, [dispatch, token]);

  useEffect(() => {
    if (!token) {
      expiredToastShown.current = false;
      return undefined;
    }
    if (isSessionExpired) {
      expireCashierSession();
      return undefined;
    }
    const expiresAt = Number(session?.expiresAt || 0);
    const delay = Math.max(0, Math.min(expiresAt - Date.now(), 2_147_483_647));
    const timer = window.setTimeout(expireCashierSession, delay);
    return () => window.clearTimeout(timer);
  }, [expireCashierSession, isSessionExpired, session?.expiresAt, token]);

  useEffect(() => {
    if (!token) return undefined;
    const check = () => {
      if (session?.expiresAt && Date.now() >= Number(session.expiresAt)) {
        expireCashierSession();
      }
    };
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", check);
    return () => {
      window.removeEventListener("focus", check);
      document.removeEventListener("visibilitychange", check);
    };
  }, [expireCashierSession, session?.expiresAt, token]);

  let body;
  if (!terminal) {
    body = <PairTerminal onPaired={() => setPairingTick((t) => t + 1)} />;
  } else if (!token || isSessionExpired) {
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
