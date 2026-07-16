// Cashier Settings — terminal-scoped config + install procedures.
//
// Currently surfaces the Wristband Sidecar status (RFID mode only).
// Future sections (printer, scanner config, terminal pairing) plug
// into the same panel pattern.

import React, { useEffect, useState } from "react";
import { Icon } from "./Icon";
import {
  getWristbandBridgeStatus,
  onWristbandBridgeStatus,
} from "../../lib/wristbandBridge";

// Where the operator downloads the sidecar installer. Replace with
// your release URL (GitHub Releases / S3 / CDN) once you're cutting
// builds. Configurable via the Vite env so different deploys can
// point at different download endpoints.
const SIDECAR_DOWNLOAD_URL =
  import.meta.env.VITE_SIDECAR_DOWNLOAD_URL ||
  "https://github.com/manglesh1/Cashier/releases/latest";

// Helper: read the paired terminal blob for location wristband mode.
const readTerminal = () => {
  try {
    return JSON.parse(localStorage.getItem("cashier:terminal") || "null");
  } catch {
    return null;
  }
};

export default function SettingsPage() {
  const terminal = readTerminal();
  const wristbandMode =
    terminal?.settings?.wristbandMode || terminal?.wristbandMode || "none";

  const [bridge, setBridge] = useState(() => getWristbandBridgeStatus());
  useEffect(() => {
    const off = onWristbandBridgeStatus(() => {
      setBridge(getWristbandBridgeStatus());
    });
    // Also poll once per second as a fallback (the subscription
    // covers state transitions, this covers anything we missed).
    const tick = setInterval(() => setBridge(getWristbandBridgeStatus()), 1000);
    return () => {
      off();
      clearInterval(tick);
    };
  }, []);

  return (
    <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: "20px 28px" }}>
      <div style={{ maxWidth: 760, margin: "0 auto", display: "grid", gap: 16 }}>
        {/* Terminal info — read-only summary so the operator knows
            which till + location they're configuring. */}
        <Panel
          title="Terminal"
          subtitle="Where this Cashier tab is signed in."
        >
          <KVRow label="Location" value={terminal?.locationName || "—"} />
          <KVRow label="Lane / device" value={terminal?.deviceName || "—"} />
          <KVRow label="Wristband mode" value={wristbandMode.toUpperCase()} />
        </Panel>

        {/* Wristband Sidecar — only meaningful when the location is in
            RFID mode, but we still show it (informational) for paper /
            none so a curious admin can see what it would do. */}
        <Panel
          title="Wristband Sidecar"
          subtitle={
            wristbandMode === "rfid"
              ? "Required for this terminal — reads RFID wristbands and passes scans to the Cashier."
              : "Not required (this location is in " + wristbandMode + " mode). Install only if you'll switch to RFID."
          }
        >
          <SidecarStatusRow bridge={bridge} required={wristbandMode === "rfid"} />

          <div style={{
            marginTop: 14,
            padding: 12,
            background: "var(--ink-50, #F9FAFB)",
            border: "1px dashed var(--ink-200, #E5E7EB)",
            borderRadius: 10,
          }}>
            <h3 style={{ margin: "0 0 8px", fontSize: 13, fontWeight: 800 }}>
              Install on this till
            </h3>
            <ol style={{ margin: 0, paddingLeft: 20, fontSize: 13, lineHeight: 1.7 }}>
              <li>
                <strong>Plug in</strong> the ACR122U NFC reader (or compatible
                PC/SC reader) into a USB port on this machine.
              </li>
              <li>
                <strong>Install the ACS Unified Driver</strong> if you haven't
                already —{" "}
                <a
                  href="https://www.acs.com.hk/en/driver/3/acr122u-usb-nfc-reader/"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: "#1D4ED8" }}
                >
                  acs.com.hk
                </a>{" "}
                (one-time, ~3 min).
              </li>
              <li>
                <strong>Download Movira Wristband Sidecar</strong> using the
                button below, then double-click the installer.
              </li>
              <li>
                The sidecar starts automatically and lives in the Windows
                tray. The status row above should turn green within ~5
                seconds.
              </li>
              <li>
                The first time you tap a wristband on the reader, you should
                hear a beep and the scans counter (in the sidecar's status
                window) ticks up. The Cashier auto-reconnects on subsequent
                cashier sessions — no further setup.
              </li>
            </ol>
            <div style={{ marginTop: 14, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <a
                href={SIDECAR_DOWNLOAD_URL}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "10px 16px",
                  borderRadius: 12,
                  background: "var(--aero-orange-500, #F45B0A)",
                  color: "white",
                  fontWeight: 800,
                  fontSize: 13,
                  textDecoration: "none",
                  border: "2px solid var(--ink-800, #1F2937)",
                  boxShadow: "0 4px 0 var(--ink-800, #1F2937)",
                }}
              >
                <Icon name="download" size={14} stroke={2.5} />
                Download Movira Wristband Sidecar
              </a>
              <span style={{ fontSize: 11, color: "var(--ink-500, #6B7280)" }}>
                .exe · Windows 10/11 · ~60 MB
              </span>
            </div>
          </div>

          {/* Diagnostic panel — useful when the sidecar IS installed but
              not connecting (port conflict, sidecar crashed, etc.) */}
          {bridge?.scanCount > 0 && (
            <div style={{
              marginTop: 14,
              padding: "10px 12px",
              background: "#EAF8EF",
              border: "1px solid #8AD5A3",
              borderRadius: 10,
              fontSize: 12,
              color: "#137A35",
            }}>
              <strong>✓ {bridge.scanCount} scans this session</strong>
              {bridge.lastScanAt && (
                <> · last at {new Date(bridge.lastScanAt).toLocaleTimeString()}</>
              )}
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}

// ── Panels ───────────────────────────────────────────────────────────

function Panel({ title, subtitle, children }) {
  return (
    <section style={{
      background: "var(--ink-0, white)",
      border: "1.5px solid var(--ink-200, #E5E7EB)",
      borderRadius: 14,
      padding: "16px 18px",
    }}>
      <header style={{ marginBottom: 14 }}>
        <h2 style={{
          margin: 0,
          fontSize: 16,
          fontWeight: 800,
          fontFamily: "var(--font-display)",
          color: "var(--ink-900, #111827)",
        }}>
          {title}
        </h2>
        {subtitle && (
          <p style={{
            margin: "4px 0 0",
            fontSize: 13,
            color: "var(--ink-500, #6B7280)",
            lineHeight: 1.4,
          }}>
            {subtitle}
          </p>
        )}
      </header>
      {children}
    </section>
  );
}

function KVRow({ label, value }) {
  return (
    <div style={{
      display: "flex",
      justifyContent: "space-between",
      gap: 10,
      padding: "8px 0",
      borderBottom: "1px solid var(--ink-100, #F3F4F6)",
      fontSize: 13,
    }}>
      <span style={{ color: "var(--ink-500, #6B7280)", fontWeight: 600 }}>{label}</span>
      <span style={{ fontWeight: 800, color: "var(--ink-900, #111827)" }}>{value}</span>
    </div>
  );
}

function SidecarStatusRow({ bridge, required }) {
  const connected = !!bridge?.connected;
  const port = bridge?.port || 7777;

  let tone, label;
  if (connected) {
    tone = { bg: "#EAF8EF", border: "#8AD5A3", fg: "#137A35", dot: "#16A34A" };
    label = "Connected";
  } else if (required) {
    tone = { bg: "#FFF0EA", border: "#FFB199", fg: "#B83210", dot: "#B83210" };
    label = "Not detected · sidecar required";
  } else {
    tone = { bg: "var(--ink-50, #F9FAFB)", border: "var(--ink-200, #E5E7EB)", fg: "var(--ink-600, #4B5563)", dot: "var(--ink-400, #9CA3AF)" };
    label = "Not running · install only if switching to RFID";
  }

  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 10,
      padding: "10px 12px",
      background: tone.bg,
      border: `1.5px solid ${tone.border}`,
      borderRadius: 10,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{
          display: "inline-block",
          width: 10,
          height: 10,
          borderRadius: 999,
          background: tone.dot,
          boxShadow: connected ? `0 0 0 4px ${tone.dot}33` : "none",
        }} />
        <span style={{ fontWeight: 800, color: tone.fg, fontSize: 13 }}>
          {label}
        </span>
      </div>
      <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: tone.fg, opacity: 0.7 }}>
        ws://127.0.0.1:{port}
      </span>
    </div>
  );
}
