// Redeem — cashier screen for scanning / typing a ticket code and
// performing a redemption. Designed scanner-first: the input auto-focuses
// on mount and on every successful or failed scan so the next swipe
// "just works" without the cashier touching the screen.

import React, { useEffect, useRef, useState } from "react";
import Cookies from "js-cookie";
import { toast } from "sonner";
import { Icon } from "./Icon";
import { StatusPill } from "./StatusPill";
import {
  useLazyGetTicketByCodeQuery,
  useRedeemTicketMutation,
} from "../../features/tickets/ticketApi";
import { getTerminal } from "../../lib/terminal";

const REASON_COPY = {
  not_found: { title: "Ticket not found", body: "This code isn't in the system. Re-scan or check the print." },
  already_redeemed: { title: "Already used", body: "This ticket has reached its redemption limit." },
  not_yet_valid: { title: "Not yet valid", body: "This ticket's start time is in the future." },
  expired: { title: "Expired", body: "This ticket's window has passed." },
  voided: { title: "Voided", body: "This ticket was voided. Manager override required to use it." },
  refunded: { title: "Refunded", body: "This ticket was refunded — it can't be redeemed." },
  requires_waiver: { title: "Waiver missing", body: "The bound guest hasn't signed today's waiver." },
  requires_manager_override: { title: "Manager required", body: "This action needs a manager code." },
};

export function Redeem() {
  const inputRef = useRef(null);
  const [code, setCode] = useState("");
  const [recent, setRecent] = useState([]); // [{ ticket, ok, reason, at }]
  const [lookup, { isFetching: isLookingUp }] = useLazyGetTicketByCodeQuery();
  const [redeem, { isLoading: isRedeeming }] = useRedeemTicketMutation();
  const venueId = Cookies.get("venueId");

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const focusInput = () => {
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const submitCode = async (raw) => {
    const ticketCode = String(raw || code).trim();
    if (!ticketCode) return;

    setCode("");
    try {
      const terminal = getTerminal();
      const res = await redeem({
        ticketCode,
        terminalDeviceId: terminal?.deviceId || null,
        gateOrZone: terminal?.deviceName || null,
      }).unwrap();
      const ticket = res?.data;
      setRecent((prev) => [{ ticket, ok: true, at: Date.now() }, ...prev].slice(0, 8));
      toast.success(`Redeemed · ${ticket?.product?.productName || ticket?.productType || "ticket"}`);
    } catch (err) {
      const reason = err?.data?.reason || "not_found";
      const ticket = err?.data?.data;
      setRecent((prev) => [{ ticket, ok: false, reason, at: Date.now() }, ...prev].slice(0, 8));
      const copy = REASON_COPY[reason] || { title: "Scan failed", body: err?.data?.error || "" };
      toast.error(`${copy.title} — ${copy.body}`, { duration: 4000 });
    } finally {
      focusInput();
    }
  };

  // Scanner intercept: most barcode scanners emit Enter at the end.
  const handleKeyDown = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      submitCode(e.target.value);
    }
  };

  // Manual lookup-without-redeem (for the cashier to verify before scanning at gate)
  const handlePreview = async () => {
    if (!code.trim()) return;
    try {
      const res = await lookup(code.trim()).unwrap();
      const t = res?.data;
      toast.message(
        `${t?.product?.productName || t?.productType || "Ticket"} · ${t?.status} · ${t?.redemptionCount ?? 0}/${t?.maxRedemptions ?? 1} uses`
      );
    } catch (err) {
      const reason = err?.data?.reason || "not_found";
      const copy = REASON_COPY[reason] || { title: "Lookup failed" };
      toast.error(copy.title);
    }
  };

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      {/* Scanner area */}
      <div
        style={{
          padding: "32px 28px",
          background: "var(--ink-25)",
          borderBottom: "1px solid var(--ink-100)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 18,
        }}
      >
        <StatusPill tone="info" icon="qr-code">Scan or type ticket code</StatusPill>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 14,
            background: "white",
            border: "2px solid var(--ink-800)",
            borderRadius: 18,
            padding: "16px 22px",
            width: "min(560px, 100%)",
            boxShadow: "0 6px 0 var(--ink-800)",
          }}
        >
          <Icon name="qr-code" size={28} stroke={2} style={{ color: "var(--ink-700)" }} />
          <input
            ref={inputRef}
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            onKeyDown={handleKeyDown}
            placeholder="AS-T-XXXXXX"
            disabled={isRedeeming}
            style={{
              all: "unset",
              flex: 1,
              fontFamily: "var(--font-mono)",
              fontWeight: 700,
              fontSize: 22,
              color: "var(--ink-900)",
              letterSpacing: "0.05em",
            }}
          />
          <button
            type="button"
            className="a-btn a-btn--ghost a-btn--sm"
            onClick={handlePreview}
            disabled={!code.trim() || isLookingUp}
          >
            Preview
          </button>
          <button
            type="button"
            className="a-btn a-btn--primary a-btn--sm"
            onClick={() => submitCode()}
            disabled={!code.trim() || isRedeeming}
          >
            Redeem
          </button>
        </div>
        <div style={{ fontSize: 12, color: "var(--ink-500)" }}>
          Scanner ready · Enter to submit
        </div>
      </div>

      {/* Recent activity */}
      <div style={{ flex: 1, overflowY: "auto", padding: "20px 28px" }}>
        <div className="eyebrow" style={{ marginBottom: 12 }}>Recent activity</div>
        {recent.length === 0 ? (
          <div style={{ padding: 28, textAlign: "center", color: "var(--ink-500)", fontSize: 13 }}>
            Scan a wristband or type a code to begin.
          </div>
        ) : (
          <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 10 }}>
            {recent.map((entry, i) => (
              <RecentRow key={i} entry={entry} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function RecentRow({ entry }) {
  const t = entry.ticket;
  const time = new Date(entry.at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit" });
  return (
    <li
      style={{
        display: "grid",
        gridTemplateColumns: "auto 1fr auto",
        alignItems: "center",
        gap: 14,
        padding: "14px 18px",
        background: entry.ok ? "var(--color-success-soft)" : "var(--color-danger-soft)",
        border: `2px solid ${entry.ok ? "var(--color-success)" : "var(--color-danger)"}`,
        borderRadius: 14,
      }}
    >
      <Icon name={entry.ok ? "check" : "x"} size={22} stroke={3} style={{ color: entry.ok ? "var(--color-success)" : "var(--color-danger)" }} />
      <div style={{ lineHeight: 1.3 }}>
        <div style={{ fontWeight: 700, fontSize: 14 }}>
          {t?.ticketCode || "—"}
          {entry.ok && t?.product?.productName && <span style={{ color: "var(--ink-500)", fontWeight: 500, marginLeft: 6 }}>· {t.product.productName}</span>}
        </div>
        <div style={{ fontSize: 12, color: "var(--ink-600)" }}>
          {entry.ok
            ? `Redeemed ${t?.redemptionCount ?? 1}/${t?.maxRedemptions ?? 1}`
            : (REASON_COPY[entry.reason]?.title || entry.reason || "Failed")}
        </div>
      </div>
      <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--ink-500)" }}>{time}</div>
    </li>
  );
}
