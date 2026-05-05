// VoucherCounter — cashier screen for scanning a voucher pack token
// (printed receipt, customer-portal QR, email link) and either
// redeeming it as a stock-item credit (pizza, swag, etc.) or showing
// the cashier where to scan it next (slot-bound voucher → regular
// ticket scanner once it's been scheduled).
//
// Designed scanner-first like the existing Redeem screen: input
// auto-focuses on mount and after every action.

import React, { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Icon } from "./Icon";
import {
  useLazyLookupVoucherByTokenQuery,
  useRedeemEntitlementMutation,
  useRedeemMembershipMutation,
  useLazyLookupGiftCardQuery,
  useRedeemGiftCardMutation,
} from "../../features/vouchers/voucherApi";

function formatExpiry(ts) {
  if (!ts) return "no expiry";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "no expiry";
  const now = Date.now();
  const ms = d.getTime() - now;
  const days = Math.round(ms / 86400000);
  if (days < 0) return `expired ${-days}d ago`;
  if (days === 0) return "expires today";
  if (days === 1) return "expires tomorrow";
  return `expires in ${days}d (${d.toLocaleDateString()})`;
}

export function VoucherCounter() {
  const inputRef = useRef(null);
  const [token, setToken] = useState("");
  const [active, setActive] = useState(null); // resolved record from lookup
  const [error, setError] = useState(null);
  const [recent, setRecent] = useState([]); // [{ at, ok, kind, label, qty }]
  const [lookup, { isFetching }] = useLazyLookupVoucherByTokenQuery();
  const [redeem, { isLoading: redeeming }] = useRedeemEntitlementMutation();
  const [redeemMembership, { isLoading: redeemingMembership }] =
    useRedeemMembershipMutation();
  const [gcLookup, { isFetching: gcLooking }] = useLazyLookupGiftCardQuery();
  const [gcRedeem, { isLoading: gcRedeeming }] = useRedeemGiftCardMutation();

  // Gift card sub-flow state — separate from the scanner since cards
  // are looked up by code+PIN, not by QR token.
  const [tab, setTab] = useState("scan"); // "scan" | "giftcard"
  const [gcCode, setGcCode] = useState("");
  const [gcPin, setGcPin] = useState("");
  const [gcCard, setGcCard] = useState(null);
  const [gcAmount, setGcAmount] = useState("");

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const focusInput = () => setTimeout(() => inputRef.current?.focus(), 0);

  const submit = async (raw) => {
    const t = String(raw || token).trim();
    if (!t) return;
    setToken("");
    setError(null);
    setActive(null);
    try {
      const res = await lookup(t).unwrap();
      const data = res?.data;
      if (!data?.kind) {
        throw new Error("Unrecognized voucher.");
      }
      setActive(data);
    } catch (err) {
      const msg = err?.data?.message || err?.message || "Voucher not found.";
      setError(msg);
      toast.error(msg, { duration: 3500 });
    } finally {
      focusInput();
    }
  };

  const handleKey = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      submit(e.target.value);
    }
  };

  const handleRedeem = async () => {
    if (active?.kind !== "entitlement") return;
    try {
      const res = await redeem({
        entitlementId: active.entitlementId,
        quantity: 1,
      }).unwrap();
      const remainingQty = res?.data?.remainingQty ?? "?";
      const status = res?.data?.status;
      toast.success(
        `Redeemed · ${remainingQty} left${
          status === "exhausted" ? " (now exhausted)" : ""
        }`
      );
      setRecent((prev) =>
        [
          {
            at: Date.now(),
            ok: true,
            kind: "entitlement",
            label: `Entitlement #${active.entitlementId}`,
            qty: remainingQty,
          },
          ...prev,
        ].slice(0, 8)
      );
      setActive({ ...active, remainingQty, status });
      if (status === "exhausted") {
        setActive(null);
      }
    } catch (err) {
      const msg = err?.data?.message || "Redemption failed.";
      toast.error(msg);
      setRecent((prev) =>
        [
          {
            at: Date.now(),
            ok: false,
            kind: "entitlement",
            label: `Entitlement #${active.entitlementId}`,
            qty: msg,
          },
          ...prev,
        ].slice(0, 8)
      );
    } finally {
      focusInput();
    }
  };

  const handleRedeemMembership = async () => {
    if (active?.kind !== "membership") return;
    try {
      const res = await redeemMembership({
        membershipId: active.membershipId,
        activityId: null,
      }).unwrap();
      const data = res?.data;
      toast.success(
        `Member checked in · ${data.redemptionsToday} use${
          data.redemptionsToday === 1 ? "" : "s"
        } today`
      );
      setRecent((prev) =>
        [
          {
            at: Date.now(),
            ok: true,
            kind: "membership",
            label: `Member #${active.membershipId}`,
            qty: `${data.redemptionsToday} today`,
          },
          ...prev,
        ].slice(0, 8)
      );
      setActive({ ...active, redemptionsToday: data.redemptionsToday });
    } catch (err) {
      const msg = err?.data?.message || "Member redemption failed.";
      toast.error(msg);
      setRecent((prev) =>
        [
          {
            at: Date.now(),
            ok: false,
            kind: "membership",
            label: `Member #${active.membershipId}`,
            qty: msg,
          },
          ...prev,
        ].slice(0, 8)
      );
    } finally {
      focusInput();
    }
  };

  const handleGcLookup = async () => {
    if (!gcCode.trim() || !gcPin.trim()) {
      toast.error("Code and PIN required");
      return;
    }
    try {
      const res = await gcLookup({
        code: gcCode.trim().toUpperCase(),
        pin: gcPin.trim(),
      }).unwrap();
      const card = res?.data;
      if (!card) {
        toast.error("Card not found");
        return;
      }
      setGcCard(card);
      setGcAmount(Number(card.currentBalance).toFixed(2));
    } catch (err) {
      toast.error(err?.data?.message || "Lookup failed");
    }
  };

  const handleGcRedeem = async () => {
    if (!gcCard) return;
    const amt = Number(gcAmount);
    if (!Number.isFinite(amt) || amt <= 0) {
      toast.error("Enter a positive amount");
      return;
    }
    if (amt > Number(gcCard.currentBalance)) {
      toast.error(`Card has only $${Number(gcCard.currentBalance).toFixed(2)}`);
      return;
    }
    try {
      const res = await gcRedeem({
        code: gcCard.code,
        pin: gcPin.trim(),
        amount: amt,
      }).unwrap();
      const data = res?.data;
      toast.success(
        `Redeemed $${amt.toFixed(2)} · $${Number(data.balanceAfter).toFixed(2)} remaining`
      );
      setRecent((prev) =>
        [
          {
            at: Date.now(),
            ok: true,
            kind: "gift_card",
            label: `Card ${gcCard.code}`,
            qty: `$${Number(data.balanceAfter).toFixed(2)} left`,
          },
          ...prev,
        ].slice(0, 8)
      );
      setGcCard({ ...gcCard, currentBalance: data.balanceAfter, status: data.status });
      setGcAmount("");
      if (data.status === "exhausted") {
        setGcCard(null);
        setGcCode("");
        setGcPin("");
      }
    } catch (err) {
      toast.error(err?.data?.message || "Redeem failed");
    }
  };

  return (
    <div className="cashier-page">
      <header className="cashier-page__header">
        <h1>Voucher Counter</h1>
        <p style={{ color: "var(--text-muted)" }}>
          Scan a voucher pack QR / digital pass, or look up a gift card by
          code + PIN. Jump-pass vouchers schedule via the portal and re-scan
          at the gate.
        </p>
      </header>

      <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
        <button
          type="button"
          className={`cashier-button ${tab === "scan" ? "cashier-button--primary" : ""}`}
          onClick={() => setTab("scan")}
        >
          Scan token
        </button>
        <button
          type="button"
          className={`cashier-button ${tab === "giftcard" ? "cashier-button--primary" : ""}`}
          onClick={() => setTab("giftcard")}
        >
          Gift card lookup
        </button>
      </div>

      {tab === "scan" && (
      <div
        style={{
          display: "flex",
          gap: 8,
          marginBottom: 16,
          alignItems: "center",
        }}
      >
        <input
          ref={inputRef}
          value={token}
          onChange={(e) => setToken(e.target.value)}
          onKeyDown={handleKey}
          placeholder="Scan QR or paste token…"
          className="cashier-input"
          style={{ flex: 1, fontSize: 16, padding: 12 }}
          autoComplete="off"
        />
        <button
          type="button"
          className="cashier-button cashier-button--primary"
          onClick={() => submit(token)}
          disabled={isFetching || !token.trim()}
        >
          Look up
        </button>
      </div>
      )}

      {tab === "giftcard" && (
        <div style={{ marginBottom: 16 }}>
          {!gcCard ? (
            <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr auto", gap: 8 }}>
              <input
                value={gcCode}
                onChange={(e) => setGcCode(e.target.value.toUpperCase())}
                placeholder="XXXX-XXXX-XXXX"
                className="cashier-input"
                style={{ fontSize: 16, padding: 12, fontFamily: "monospace" }}
                autoComplete="off"
              />
              <input
                value={gcPin}
                onChange={(e) => setGcPin(e.target.value.replace(/\D/g, ""))}
                placeholder="PIN"
                inputMode="numeric"
                maxLength={4}
                className="cashier-input"
                style={{ fontSize: 16, padding: 12 }}
                autoComplete="off"
                type="password"
              />
              <button
                type="button"
                className="cashier-button cashier-button--primary"
                onClick={handleGcLookup}
                disabled={gcLooking || !gcCode.trim() || !gcPin.trim()}
              >
                {gcLooking ? "Looking up…" : "Look up"}
              </button>
            </div>
          ) : (
            <div
              style={{
                padding: 16,
                border: "1px solid var(--border)",
                borderRadius: 8,
                background: "rgba(236,72,153,0.05)",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <h3 style={{ margin: 0, fontFamily: "monospace" }}>{gcCard.code}</h3>
                <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{gcCard.status}</span>
              </div>
              <div style={{ marginTop: 8, fontSize: 22, fontWeight: 600 }}>
                ${Number(gcCard.currentBalance).toFixed(2)}{" "}
                <span style={{ fontSize: 14, color: "var(--text-muted)", fontWeight: 400 }}>
                  of ${Number(gcCard.initialBalance).toFixed(2)}
                </span>
              </div>
              <div style={{ marginTop: 4, color: "var(--text-muted)", fontSize: 12 }}>
                {formatExpiry(gcCard.expiresAt)}
              </div>
              <div style={{ marginTop: 16, display: "flex", gap: 8, alignItems: "center" }}>
                <input
                  type="number"
                  step="0.01"
                  min={0}
                  max={Number(gcCard.currentBalance)}
                  value={gcAmount}
                  onChange={(e) => setGcAmount(e.target.value)}
                  className="cashier-input"
                  style={{ fontSize: 16, padding: 12, width: 140 }}
                  placeholder="Amount"
                />
                <button
                  type="button"
                  className="cashier-button cashier-button--primary"
                  onClick={handleGcRedeem}
                  disabled={gcRedeeming}
                >
                  {gcRedeeming ? "Redeeming…" : "Redeem"}
                </button>
                <button
                  type="button"
                  className="cashier-button"
                  onClick={() => {
                    setGcCard(null);
                    setGcCode("");
                    setGcPin("");
                    setGcAmount("");
                  }}
                >
                  Clear
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {error && (
        <div
          style={{
            padding: 12,
            background: "var(--surface-error, #fee)",
            color: "var(--text-error, #a00)",
            borderRadius: 6,
            marginBottom: 12,
          }}
        >
          {error}
        </div>
      )}

      {active && active.kind === "entitlement" && (
        <div
          style={{
            padding: 16,
            border: "1px solid var(--border)",
            borderRadius: 8,
            marginBottom: 12,
          }}
        >
          <div style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
            <h3 style={{ margin: 0 }}>Stock-item credit</h3>
            <span
              style={{
                padding: "2px 8px",
                background: "var(--accent-bg, #efe)",
                color: "var(--accent-text, #060)",
                borderRadius: 4,
                fontSize: 12,
              }}
            >
              {active.status}
            </span>
          </div>
          <div style={{ marginTop: 8, color: "var(--text-muted)", fontSize: 14 }}>
            Activity #{active.activityId} · variation {active.variationId || "any"}
          </div>
          <div style={{ marginTop: 4, color: "var(--text-muted)", fontSize: 12 }}>
            {formatExpiry(active.expiresAt)}
          </div>

          <div style={{ marginTop: 16, display: "flex", gap: 12, alignItems: "center" }}>
            <div>
              <div style={{ fontSize: 12, color: "var(--text-muted)" }}>Remaining</div>
              <div style={{ fontSize: 28, fontWeight: 600 }}>
                {active.remainingQty} <span style={{ fontSize: 14, color: "var(--text-muted)" }}>of {active.originalQty}</span>
              </div>
            </div>
            <button
              type="button"
              className="cashier-button cashier-button--primary"
              style={{ padding: "12px 24px", fontSize: 16 }}
              onClick={handleRedeem}
              disabled={redeeming || active.remainingQty < 1 || active.status !== "active"}
            >
              {redeeming ? "Redeeming…" : "Redeem 1"}
            </button>
          </div>
        </div>
      )}

      {active && active.kind === "membership" && (
        <div
          style={{
            padding: 16,
            border: "1px solid var(--border)",
            borderRadius: 8,
            marginBottom: 12,
            background: "rgba(99,102,241,0.05)",
          }}
        >
          <div style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
            <h3 style={{ margin: 0 }}>Membership pass</h3>
            <span
              style={{
                padding: "2px 8px",
                background: "rgba(99,102,241,0.15)",
                color: "#4F46E5",
                borderRadius: 4,
                fontSize: 12,
                fontWeight: 700,
                textTransform: "uppercase",
              }}
            >
              {active.status}
            </span>
            {active.autoRenew && (
              <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                · auto-renew
              </span>
            )}
          </div>
          <div style={{ marginTop: 8, color: "var(--text-muted)", fontSize: 14 }}>
            {active.guestName || `Guest #${active.guestId}`}
            {active.guestEmail ? ` · ${active.guestEmail}` : ""}
          </div>
          <div style={{ marginTop: 4, color: "var(--text-muted)", fontSize: 12 }}>
            {active.activityName || `Membership #${active.activityId}`} ·{" "}
            {formatExpiry(active.expiresAt)}
          </div>
          <div style={{ marginTop: 16, display: "flex", gap: 12, alignItems: "center" }}>
            <div>
              <div style={{ fontSize: 12, color: "var(--text-muted)" }}>Used today</div>
              <div style={{ fontSize: 28, fontWeight: 600 }}>
                {active.redemptionsToday || 0}
                {active.maxRedemptionsPerDay ? (
                  <span style={{ fontSize: 14, color: "var(--text-muted)" }}>
                    {" "}
                    of {active.maxRedemptionsPerDay}
                  </span>
                ) : (
                  <span style={{ fontSize: 14, color: "var(--text-muted)" }}>
                    {" "}
                    today
                  </span>
                )}
              </div>
            </div>
            <button
              type="button"
              className="cashier-button cashier-button--primary"
              style={{ padding: "12px 24px", fontSize: 16 }}
              onClick={handleRedeemMembership}
              disabled={redeemingMembership || active.status !== "active"}
            >
              {redeemingMembership ? "Checking in…" : "Check in"}
            </button>
          </div>
        </div>
      )}

      {active && active.kind === "voucher" && (
        <div
          style={{
            padding: 16,
            border: "1px solid var(--border)",
            borderRadius: 8,
            marginBottom: 12,
          }}
        >
          <h3 style={{ margin: 0 }}>Slot-bound voucher</h3>
          <div style={{ marginTop: 8, color: "var(--text-muted)", fontSize: 14 }}>
            Voucher #{active.bookingItemId} · status {active.status} ·{" "}
            {formatExpiry(active.expiresAt)}
          </div>
          <div style={{ marginTop: 12 }}>
            {active.slotId ? (
              <div
                style={{
                  padding: 10,
                  background: "var(--accent-bg, #efe)",
                  borderRadius: 6,
                  fontSize: 14,
                }}
              >
                Already scheduled to slot #{active.slotId}. Scan the regular
                ticket QR at the gate to redeem entry.
              </div>
            ) : (
              <div
                style={{
                  padding: 10,
                  background: "var(--surface-warn, #ffe)",
                  color: "var(--text-warn, #850)",
                  borderRadius: 6,
                  fontSize: 14,
                }}
              >
                Not scheduled yet. Direct the customer to the portal "My
                Vouchers" page to pick a date and time, or schedule on their
                behalf in the booking screen.
              </div>
            )}
          </div>
        </div>
      )}

      {recent.length > 0 && (
        <div style={{ marginTop: 24 }}>
          <h4 style={{ margin: "0 0 8px 0", color: "var(--text-muted)", fontSize: 12, textTransform: "uppercase", letterSpacing: 0.5 }}>
            Recent
          </h4>
          <div style={{ fontSize: 13 }}>
            {recent.map((r, i) => (
              <div
                key={i}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  padding: "6px 0",
                  borderBottom: "1px solid var(--border-subtle, #eee)",
                  color: r.ok ? "var(--text-default)" : "var(--text-error, #a00)",
                }}
              >
                <span>
                  {r.ok ? "✓" : "✗"} {r.label}
                </span>
                <span style={{ color: "var(--text-muted)" }}>
                  {r.ok ? `${r.qty} left` : r.qty}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default VoucherCounter;
