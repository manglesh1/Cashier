// ClockIn — tile-grid + PIN pad for cashier sign-in.
// Replaces email/password as the primary login flow on a paired tablet.
//
// Flow:
//   1. Loads staff for the paired terminal's location
//   2. Cashier taps their photo/initials tile → PIN pad slides in
//   3. PIN entered → clockIn mutation → token in Redux → CashierApp loads
//
// "Use email instead" link at the bottom routes to the legacy form for
// managers / one-off admin sign-ins.

import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import { useGetClockInOptionsQuery, useClockInMutation } from "../features/auth/authApi";
import { getTerminal, clearTerminal } from "../lib/terminal";

const PIN_LENGTH = 4; // accept 4–6 server-side; UX optimised for 4

const initialsOf = (u) =>
  `${(u.firstName || "")[0] || ""}${(u.lastName || "")[0] || ""}`.toUpperCase();

const PALETTE = ["#F45B0A", "#6A40F5", "#18B8C9", "#1F9D55", "#D6361A", "#E9A100", "#A33706", "#4F25C9"];
const colorFor = (u) => PALETTE[(((u.firstName || "?").charCodeAt(0) || 0) + (u.userId || 0)) % PALETTE.length];

export default function ClockIn({ onUseEmailLogin }) {
  const terminal = getTerminal();
  const { data, isLoading, error } = useGetClockInOptionsQuery(terminal?.deviceId, {
    skip: !terminal?.deviceId,
  });
  const [clockIn, { isLoading: isSubmitting }] = useClockInMutation();
  const [picked, setPicked] = useState(null);
  const [pin, setPin] = useState("");

  const users = data?.data?.users || [];

  useEffect(() => {
    if (!picked) setPin("");
  }, [picked]);

  // Auto-submit on full PIN
  useEffect(() => {
    if (picked && pin.length >= PIN_LENGTH) submit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pin, picked]);

  const submit = async () => {
    if (!picked || !pin) return;
    try {
      await clockIn({
        deviceId: terminal.deviceId,
        userId: picked.userId,
        pin,
      }).unwrap();
      toast.success(`Clocked in · ${picked.firstName}`);
    } catch (err) {
      console.error("Clock-in error:", err);
      const msg =
        err?.data?.error ||
        (err?.status === 401 && "Incorrect PIN") ||
        (err?.status === 403 && err?.data?.error) ||
        "Clock-in failed";
      toast.error(String(msg), { duration: 4000 });
      setPin("");
    }
  };

  const tap = (digit) => setPin((p) => (p.length < 6 ? p + digit : p));
  const back = () => setPin((p) => p.slice(0, -1));

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "var(--ink-25)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
    >
      <div
        style={{
          background: "white",
          border: "2px solid var(--ink-800)",
          borderRadius: 22,
          boxShadow: "0 6px 0 var(--ink-800)",
          padding: 28,
          width: "min(720px, 100%)",
          maxHeight: "94vh",
          overflow: "auto",
        }}
      >
        {/* Header — terminal + location */}
        <TerminalBar terminal={terminal} onSwitch={() => {
          if (window.confirm("Unpair this terminal?")) {
            clearTerminal();
            window.location.reload();
          }
        }} />

        {!picked ? (
          <>
            <div
              style={{
                fontFamily: "var(--font-display)",
                fontSize: 22,
                fontWeight: 800,
                color: "var(--ink-900)",
                marginTop: 18,
                marginBottom: 4,
              }}
            >
              Tap your tile to clock in
            </div>
            <div style={{ fontSize: 13, color: "var(--ink-500)", marginBottom: 18 }}>
              {users.length > 0 ? `${users.length} staff` : "Loading staff…"}
            </div>

            {isLoading && <div style={{ padding: 32, textAlign: "center", color: "var(--ink-500)" }}>Loading…</div>}

            {error && (
              <div
                style={{
                  padding: 16,
                  background: "var(--color-danger-soft)",
                  border: "1.5px solid var(--color-danger)",
                  borderRadius: 12,
                  color: "var(--color-danger)",
                  fontSize: 13,
                  fontWeight: 600,
                  marginBottom: 16,
                }}
              >
                Couldn't load staff list. {error?.data?.error || "Check the connection."}
              </div>
            )}

            {!isLoading && users.length === 0 && (
              <EmptyState onUseEmailLogin={onUseEmailLogin} />
            )}

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
                gap: 12,
              }}
            >
              {users.map((u) => (
                <button
                  key={u.userId}
                  type="button"
                  onClick={() => setPicked(u)}
                  style={{
                    all: "unset",
                    cursor: "pointer",
                    background: "white",
                    border: "2px solid var(--ink-800)",
                    borderRadius: 16,
                    boxShadow: "0 4px 0 var(--ink-800)",
                    padding: 14,
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: 8,
                    transition: "transform 100ms ease",
                  }}
                  onMouseDown={(e) => (e.currentTarget.style.transform = "translateY(4px)")}
                  onMouseUp={(e) => (e.currentTarget.style.transform = "")}
                  onMouseLeave={(e) => (e.currentTarget.style.transform = "")}
                >
                  {u.photoUrl ? (
                    <img
                      src={u.photoUrl}
                      alt=""
                      style={{
                        width: 72, height: 72, borderRadius: 16,
                        objectFit: "cover",
                        border: "1.5px solid var(--ink-800)",
                      }}
                    />
                  ) : (
                    <div
                      style={{
                        width: 72, height: 72, borderRadius: 16,
                        background: colorFor(u),
                        color: "white",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontFamily: "var(--font-display)",
                        fontWeight: 800, fontSize: 26,
                        border: "1.5px solid var(--ink-800)",
                      }}
                    >
                      {initialsOf(u) || "?"}
                    </div>
                  )}
                  <div style={{ textAlign: "center", lineHeight: 1.2 }}>
                    <div style={{ fontWeight: 800, fontSize: 14, color: "var(--ink-900)" }}>
                      {u.firstName} {u.lastName?.[0] || ""}.
                    </div>
                    {u.role && (
                      <div style={{ fontSize: 10.5, color: "var(--ink-500)", fontWeight: 600 }}>
                        {u.role}
                      </div>
                    )}
                  </div>
                </button>
              ))}
            </div>
          </>
        ) : (
          <PinPad
            user={picked}
            pin={pin}
            tap={tap}
            back={back}
            onCancel={() => { setPicked(null); setPin(""); }}
            isSubmitting={isSubmitting}
          />
        )}

        {/* Manager fallback */}
        <div style={{ marginTop: 22, paddingTop: 16, borderTop: "1.5px solid var(--ink-100)", textAlign: "center" }}>
          <button
            type="button"
            onClick={onUseEmailLogin}
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
            Use email + password instead (manager)
          </button>
        </div>
      </div>
    </div>
  );
}

function TerminalBar({ terminal, onSwitch }) {
  if (!terminal) return null;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "10px 12px",
        background: "var(--aero-orange-50)",
        border: "1.5px solid var(--aero-orange-300)",
        borderRadius: 12,
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
          {terminal.locationName || `Location ${terminal.locationId}`}
        </div>
      </div>
      <button
        type="button"
        onClick={onSwitch}
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
  );
}

function PinPad({ user, pin, tap, back, onCancel, isSubmitting }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", paddingTop: 20 }}>
      {/* Picked staff */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginBottom: 20 }}>
        {user.photoUrl ? (
          <img
            src={user.photoUrl}
            alt=""
            style={{
              width: 84, height: 84, borderRadius: 20,
              objectFit: "cover",
              border: "2px solid var(--ink-800)",
              boxShadow: "0 5px 0 var(--ink-800)",
            }}
          />
        ) : (
          <div
            style={{
              width: 84, height: 84, borderRadius: 20,
              background: colorFor(user),
              color: "white",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontFamily: "var(--font-display)",
              fontWeight: 800, fontSize: 32,
              border: "2px solid var(--ink-800)",
              boxShadow: "0 5px 0 var(--ink-800)",
            }}
          >
            {initialsOf(user) || "?"}
          </div>
        )}
        <div style={{ marginTop: 10, fontFamily: "var(--font-display)", fontSize: 22, fontWeight: 800, color: "var(--ink-900)" }}>
          {user.firstName} {user.lastName}
        </div>
        <div style={{ fontSize: 12, color: "var(--ink-500)", fontWeight: 600 }}>
          Enter your PIN
        </div>
      </div>

      {/* PIN dots */}
      <div style={{ display: "flex", gap: 14, marginBottom: 20 }}>
        {Array.from({ length: PIN_LENGTH }).map((_, i) => (
          <span
            key={i}
            style={{
              width: 16, height: 16, borderRadius: 999,
              background: i < pin.length ? "var(--aero-orange-500)" : "transparent",
              border: "2px solid var(--ink-800)",
            }}
          />
        ))}
      </div>

      {/* Pad */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 72px)", gap: 10, marginBottom: 14 }}>
        {[1,2,3,4,5,6,7,8,9].map((d) => (
          <PadButton key={d} onClick={() => tap(String(d))} disabled={isSubmitting}>{d}</PadButton>
        ))}
        <PadButton onClick={back} disabled={isSubmitting} muted>←</PadButton>
        <PadButton onClick={() => tap("0")} disabled={isSubmitting}>0</PadButton>
        <PadButton onClick={onCancel} disabled={isSubmitting} muted>✕</PadButton>
      </div>

      {isSubmitting && <div style={{ fontSize: 12, color: "var(--ink-500)", fontWeight: 600 }}>Signing in…</div>}
    </div>
  );
}

function PadButton({ children, onClick, disabled, muted }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        all: "unset",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
        background: muted ? "var(--ink-50)" : "white",
        color: muted ? "var(--ink-700)" : "var(--ink-900)",
        border: "2px solid var(--ink-800)",
        borderRadius: 14,
        boxShadow: "0 4px 0 var(--ink-800)",
        width: 72, height: 72,
        display: "flex", alignItems: "center", justifyContent: "center",
        fontFamily: "var(--font-display)",
        fontWeight: 800, fontSize: 26,
        userSelect: "none",
      }}
      onMouseDown={(e) => { if (!disabled) e.currentTarget.style.transform = "translateY(4px)"; }}
      onMouseUp={(e) => (e.currentTarget.style.transform = "")}
      onMouseLeave={(e) => (e.currentTarget.style.transform = "")}
    >
      {children}
    </button>
  );
}

function EmptyState({ onUseEmailLogin }) {
  return (
    <div
      style={{
        padding: 32,
        background: "var(--ink-25)",
        border: "1.5px dashed var(--ink-300)",
        borderRadius: 14,
        textAlign: "center",
      }}
    >
      <div style={{ fontWeight: 800, color: "var(--ink-900)", marginBottom: 8 }}>
        No staff configured for this terminal
      </div>
      <div style={{ fontSize: 13, color: "var(--ink-500)", marginBottom: 14 }}>
        A manager needs to enable POS access + set a PIN for cashier-role users from the admin app:
        <br />
        <em>Settings → Users → edit a user → set "POS user" + PIN</em>
      </div>
      <button
        type="button"
        onClick={onUseEmailLogin}
        className="a-btn a-btn--ghost a-btn--sm"
      >
        Use email + password instead
      </button>
    </div>
  );
}
