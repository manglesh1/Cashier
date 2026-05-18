// VoucherCounter - scanner-first cashier screen for voucher packs,
// memberships, and gift cards.

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
  if (!ts) return "No expiry";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "No expiry";
  const days = Math.round((d.getTime() - Date.now()) / 86400000);
  if (days < 0) return `Expired ${Math.abs(days)}d ago`;
  if (days === 0) return "Expires today";
  if (days === 1) return "Expires tomorrow";
  return `Expires in ${days}d`;
}

function formatTime(ts) {
  return new Date(ts).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });
}

function titleForRecord(record) {
  if (!record) return "Ready for scan";
  if (record.kind === "entitlement") return "Stock-item credit";
  if (record.kind === "membership") return "Membership pass";
  if (record.kind === "voucher") return "Slot-bound voucher";
  if (record.kind === "gift_card") return "Gift card";
  return "Voucher";
}

function toneForStatus(status) {
  const s = String(status || "").toLowerCase();
  if (["active", "paid", "open"].includes(s)) return "success";
  if (["exhausted", "redeemed"].includes(s)) return "neutral";
  if (["expired", "cancelled", "voided"].includes(s)) return "danger";
  return "warning";
}

const toneStyles = {
  success: {
    bg: "#EAF8EF",
    border: "#1F9D55",
    fg: "#137A35",
    soft: "#DDF3E3",
  },
  warning: {
    bg: "#FFF8E1",
    border: "#E9A100",
    fg: "#7A5400",
    soft: "#FFF1CC",
  },
  danger: {
    bg: "#FCE2DA",
    border: "#D6361A",
    fg: "#8C2410",
    soft: "#FCE2DA",
  },
  neutral: {
    bg: "var(--ink-50)",
    border: "var(--ink-300)",
    fg: "var(--ink-700)",
    soft: "var(--ink-100)",
  },
  info: {
    bg: "#D2F1F4",
    border: "#18B8C9",
    fg: "#08555E",
    soft: "#D2F1F4",
  },
};

export function VoucherCounter() {
  const inputRef = useRef(null);
  const [token, setToken] = useState("");
  const [active, setActive] = useState(null);
  const [error, setError] = useState(null);
  const [recent, setRecent] = useState([]);
  const [tab, setTab] = useState("scan");
  const [gcCode, setGcCode] = useState("");
  const [gcPin, setGcPin] = useState("");
  const [gcCard, setGcCard] = useState(null);
  const [gcAmount, setGcAmount] = useState("");

  const [lookup, { isFetching }] = useLazyLookupVoucherByTokenQuery();
  const [redeem, { isLoading: redeeming }] = useRedeemEntitlementMutation();
  const [redeemMembership, { isLoading: redeemingMembership }] =
    useRedeemMembershipMutation();
  const [gcLookup, { isFetching: gcLooking }] = useLazyLookupGiftCardQuery();
  const [gcRedeem, { isLoading: gcRedeeming }] = useRedeemGiftCardMutation();

  useEffect(() => {
    inputRef.current?.focus();
  }, [tab]);

  const focusInput = () => {
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const pushRecent = (entry) => {
    setRecent((prev) =>
      [
        {
          id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
          at: Date.now(),
          ...entry,
        },
        ...prev,
      ].slice(0, 12)
    );
  };

  const submit = async (raw) => {
    const scanned = String(raw || token).trim();
    if (!scanned) return;
    setToken("");
    setError(null);
    setActive(null);
    try {
      const res = await lookup(scanned).unwrap();
      const data = res?.data;
      if (!data?.kind) throw new Error("Unrecognized voucher.");
      setActive(data);
      pushRecent({
        ok: true,
        tone: toneForStatus(data.status),
        action: "Scanned",
        title: titleForRecord(data),
        detail: data.kind === "membership"
          ? `Member #${data.membershipId}`
          : data.kind === "entitlement"
            ? `Entitlement #${data.entitlementId}`
            : `Voucher #${data.bookingItemId}`,
        meta: data.status || "active",
      });
    } catch (err) {
      const msg = err?.data?.message || err?.message || "Voucher not found.";
      setError(msg);
      pushRecent({
        ok: false,
        tone: "danger",
        action: "Rejected",
        title: "Scan failed",
        detail: scanned,
        meta: msg,
      });
      toast.error(msg, { duration: 3500 });
    } finally {
      focusInput();
    }
  };

  const handleRedeem = async () => {
    if (active?.kind !== "entitlement") return;
    try {
      const res = await redeem({
        entitlementId: active.entitlementId,
        quantity: 1,
      }).unwrap();
      const remainingQty = res?.data?.remainingQty ?? 0;
      const status = res?.data?.status || active.status;
      toast.success(`Redeemed 1 - ${remainingQty} left`);
      pushRecent({
        ok: true,
        tone: remainingQty > 0 ? "success" : "neutral",
        action: "Redeemed",
        title: "Stock-item credit",
        detail: `Entitlement #${active.entitlementId}`,
        meta: `${remainingQty} left`,
      });
      const next = { ...active, remainingQty, status };
      setActive(status === "exhausted" ? null : next);
    } catch (err) {
      const msg = err?.data?.message || "Redemption failed.";
      pushRecent({
        ok: false,
        tone: "danger",
        action: "Failed",
        title: "Stock-item credit",
        detail: `Entitlement #${active.entitlementId}`,
        meta: msg,
      });
      toast.error(msg);
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
      const data = res?.data || {};
      toast.success(`Member checked in - ${data.redemptionsToday || 0} today`);
      pushRecent({
        ok: true,
        tone: "success",
        action: "Checked in",
        title: "Membership pass",
        detail: `Member #${active.membershipId}`,
        meta: `${data.redemptionsToday || 0} today`,
      });
      setActive({ ...active, redemptionsToday: data.redemptionsToday || 0 });
    } catch (err) {
      const msg = err?.data?.message || "Member redemption failed.";
      pushRecent({
        ok: false,
        tone: "danger",
        action: "Failed",
        title: "Membership pass",
        detail: `Member #${active.membershipId}`,
        meta: msg,
      });
      toast.error(msg);
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
      setActive({ ...card, kind: "gift_card" });
      setGcAmount(Number(card.currentBalance || 0).toFixed(2));
      pushRecent({
        ok: true,
        tone: toneForStatus(card.status),
        action: "Looked up",
        title: "Gift card",
        detail: card.code,
        meta: `$${Number(card.currentBalance || 0).toFixed(2)}`,
      });
    } catch (err) {
      const msg = err?.data?.message || "Lookup failed";
      pushRecent({
        ok: false,
        tone: "danger",
        action: "Rejected",
        title: "Gift card lookup",
        detail: gcCode.trim().toUpperCase() || "No code",
        meta: msg,
      });
      toast.error(msg);
    }
  };

  const handleGcRedeem = async () => {
    if (!gcCard) return;
    const amount = Number(gcAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error("Enter a positive amount");
      return;
    }
    if (amount > Number(gcCard.currentBalance)) {
      toast.error(`Card has only $${Number(gcCard.currentBalance).toFixed(2)}`);
      return;
    }
    try {
      const res = await gcRedeem({
        code: gcCard.code,
        pin: gcPin.trim(),
        amount,
      }).unwrap();
      const data = res?.data || {};
      const balanceAfter = Number(data.balanceAfter || 0);
      toast.success(`Redeemed $${amount.toFixed(2)} - $${balanceAfter.toFixed(2)} left`);
      pushRecent({
        ok: true,
        tone: balanceAfter > 0 ? "success" : "neutral",
        action: "Redeemed",
        title: "Gift card",
        detail: gcCard.code,
        meta: `$${balanceAfter.toFixed(2)} left`,
      });
      const nextCard = { ...gcCard, currentBalance: balanceAfter, status: data.status };
      setGcCard(data.status === "exhausted" ? null : nextCard);
      setActive(data.status === "exhausted" ? null : { ...nextCard, kind: "gift_card" });
      setGcAmount("");
      if (data.status === "exhausted") {
        setGcCode("");
        setGcPin("");
      }
    } catch (err) {
      const msg = err?.data?.message || "Redeem failed";
      pushRecent({
        ok: false,
        tone: "danger",
        action: "Failed",
        title: "Gift card",
        detail: gcCard.code,
        meta: msg,
      });
      toast.error(msg);
    }
  };

  const busy = isFetching || redeeming || redeemingMembership || gcLooking || gcRedeeming;

  return (
    <div
      style={{
        flex: 1,
        minWidth: 0,
        minHeight: 0,
        display: "grid",
        gridTemplateColumns: "minmax(0, 1fr) clamp(320px, 28vw, 420px)",
        background: "var(--ink-25)",
        overflow: "hidden",
      }}
    >
      <main
        style={{
          minWidth: 0,
          minHeight: 0,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            padding: "24px 28px 20px",
            background: "var(--ink-25)",
            borderBottom: "1px solid var(--ink-100)",
            flexShrink: 0,
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "center" }}>
            <div>
              <div className="eyebrow">Voucher roller</div>
              <h2
                style={{
                  margin: "4px 0 4px",
                  fontFamily: "var(--font-display)",
                  fontSize: 30,
                  lineHeight: 1.05,
                  fontWeight: 800,
                }}
              >
                Scan, redeem, keep moving
              </h2>
              <div style={{ color: "var(--ink-500)", fontSize: 14 }}>
                Voucher packs, membership passes, and gift cards in one counter flow.
              </div>
            </div>
            <div
              style={{
                display: "inline-flex",
                background: "var(--ink-50)",
                border: "1px solid var(--ink-100)",
                borderRadius: 12,
                padding: 4,
                flexShrink: 0,
              }}
            >
              <SegmentButton active={tab === "scan"} onClick={() => setTab("scan")} icon="scan-line">
                Scan token
              </SegmentButton>
              <SegmentButton active={tab === "giftcard"} onClick={() => setTab("giftcard")} icon="credit-card">
                Gift card
              </SegmentButton>
            </div>
          </div>

          {tab === "scan" ? (
            <ScannerInput
              inputRef={inputRef}
              token={token}
              setToken={setToken}
              submit={submit}
              busy={busy}
              isFetching={isFetching}
            />
          ) : (
            <GiftCardLookup
              gcCode={gcCode}
              setGcCode={setGcCode}
              gcPin={gcPin}
              setGcPin={setGcPin}
              gcCard={gcCard}
              gcAmount={gcAmount}
              setGcAmount={setGcAmount}
              handleGcLookup={handleGcLookup}
              handleGcRedeem={handleGcRedeem}
              gcLooking={gcLooking}
              gcRedeeming={gcRedeeming}
              clear={() => {
                setGcCard(null);
                setGcCode("");
                setGcPin("");
                setGcAmount("");
                setActive(null);
              }}
            />
          )}
        </div>

        <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "24px 28px" }}>
          {error && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "12px 14px",
                marginBottom: 16,
                borderRadius: 12,
                background: "var(--color-danger-soft)",
                color: "var(--color-danger)",
                border: "1.5px solid var(--color-danger)",
                fontWeight: 700,
              }}
            >
              <Icon name="alert-triangle" size={18} />
              {error}
            </div>
          )}
          {active ? (
            <CurrentResult
              active={active}
              redeeming={redeeming}
              redeemingMembership={redeemingMembership}
              gcRedeeming={gcRedeeming}
              gcAmount={gcAmount}
              setGcAmount={setGcAmount}
              onRedeem={handleRedeem}
              onRedeemMembership={handleRedeemMembership}
              onRedeemGiftCard={handleGcRedeem}
              onClear={() => {
                setActive(null);
                setError(null);
              }}
            />
          ) : (
            <EmptyState tab={tab} />
          )}
        </div>
      </main>

      <aside
        style={{
          minHeight: 0,
          display: "flex",
          flexDirection: "column",
          background: "var(--ink-0)",
          borderLeft: "1px solid var(--ink-100)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            padding: "20px 22px 14px",
            borderBottom: "1px solid var(--ink-100)",
            flexShrink: 0,
          }}
        >
          <div className="eyebrow">Rolling feed</div>
          <h3
            style={{
              margin: "4px 0 0",
              fontFamily: "var(--font-display)",
              fontSize: 24,
              fontWeight: 800,
            }}
          >
            Recent scans
          </h3>
        </div>
        <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: 16 }}>
          {recent.length === 0 ? (
            <div
              style={{
                height: "100%",
                minHeight: 260,
                border: "1.5px dashed var(--ink-200)",
                borderRadius: 16,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                textAlign: "center",
                color: "var(--ink-500)",
                padding: 24,
                fontSize: 13,
                lineHeight: 1.4,
              }}
            >
              Scan activity rolls in here, newest first.
            </div>
          ) : (
            <ol style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gap: 10 }}>
              {recent.map((entry, index) => (
                <RollerRow key={entry.id} entry={entry} index={index} />
              ))}
            </ol>
          )}
        </div>
      </aside>
    </div>
  );
}

function SegmentButton({ active, onClick, icon, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        all: "unset",
        cursor: "pointer",
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        padding: "8px 12px",
        borderRadius: 9,
        fontSize: 13,
        fontWeight: 800,
        color: active ? "var(--ink-900)" : "var(--ink-500)",
        background: active ? "var(--ink-0)" : "transparent",
        boxShadow: active ? "var(--shadow-1)" : "none",
      }}
    >
      <Icon name={icon} size={15} />
      {children}
    </button>
  );
}

function ScannerInput({ inputRef, token, setToken, submit, busy, isFetching }) {
  return (
    <div
      style={{
        marginTop: 20,
        background: "var(--ink-0)",
        border: "2px solid var(--ink-800)",
        borderRadius: 18,
        boxShadow: "0 6px 0 var(--ink-800)",
        padding: 16,
        display: "grid",
        gridTemplateColumns: "auto minmax(0, 1fr) auto",
        alignItems: "center",
        gap: 14,
      }}
    >
      <div
        style={{
          width: 48,
          height: 48,
          borderRadius: 14,
          background: "var(--aero-orange-50)",
          color: "var(--aero-orange-600)",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Icon name="scan-line" size={26} />
      </div>
      <input
        ref={inputRef}
        value={token}
        onChange={(event) => setToken(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            submit(event.target.value);
          }
        }}
        placeholder="Scan QR or paste token"
        disabled={busy}
        autoComplete="off"
        style={{
          all: "unset",
          minWidth: 0,
          fontFamily: "var(--font-mono)",
          fontWeight: 800,
          fontSize: 22,
          color: "var(--ink-900)",
          letterSpacing: "0.02em",
        }}
      />
      <button
        type="button"
        className="a-btn a-btn--primary"
        onClick={() => submit(token)}
        disabled={busy || !token.trim()}
        style={{ minWidth: 118, justifyContent: "center" }}
      >
        <Icon name="search" size={18} />
        {isFetching ? "Looking" : "Look up"}
      </button>
    </div>
  );
}

function GiftCardLookup({
  gcCode,
  setGcCode,
  gcPin,
  setGcPin,
  gcCard,
  gcAmount,
  setGcAmount,
  handleGcLookup,
  handleGcRedeem,
  gcLooking,
  gcRedeeming,
  clear,
}) {
  return (
    <div
      style={{
        marginTop: 20,
        background: "var(--ink-0)",
        border: "2px solid var(--ink-800)",
        borderRadius: 18,
        boxShadow: "0 6px 0 var(--ink-800)",
        padding: 16,
      }}
    >
      {!gcCard ? (
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 120px auto", gap: 10 }}>
          <input
            value={gcCode}
            onChange={(event) => setGcCode(event.target.value.toUpperCase())}
            placeholder="CARD CODE"
            autoComplete="off"
            style={fieldStyle("var(--font-mono)")}
          />
          <input
            value={gcPin}
            onChange={(event) => setGcPin(event.target.value.replace(/\D/g, ""))}
            placeholder="PIN"
            inputMode="numeric"
            maxLength={4}
            autoComplete="off"
            type="password"
            style={fieldStyle()}
          />
          <button
            type="button"
            className="a-btn a-btn--primary"
            onClick={handleGcLookup}
            disabled={gcLooking || !gcCode.trim() || !gcPin.trim()}
          >
            <Icon name="search" size={18} />
            {gcLooking ? "Looking" : "Look up"}
          </button>
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 160px auto auto", gap: 10, alignItems: "center" }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontFamily: "var(--font-mono)", fontWeight: 800, fontSize: 16 }}>{gcCard.code}</div>
            <div style={{ color: "var(--ink-500)", fontSize: 12 }}>
              Balance ${Number(gcCard.currentBalance || 0).toFixed(2)}
            </div>
          </div>
          <input
            type="number"
            step="0.01"
            min={0}
            max={Number(gcCard.currentBalance)}
            value={gcAmount}
            onChange={(event) => setGcAmount(event.target.value)}
            placeholder="Amount"
            style={fieldStyle()}
          />
          <button
            type="button"
            className="a-btn a-btn--primary"
            onClick={handleGcRedeem}
            disabled={gcRedeeming}
          >
            <Icon name="credit-card" size={18} />
            {gcRedeeming ? "Redeeming" : "Redeem"}
          </button>
          <button type="button" className="a-btn a-btn--ghost" onClick={clear}>
            Clear
          </button>
        </div>
      )}
    </div>
  );
}

function CurrentResult({
  active,
  redeeming,
  redeemingMembership,
  gcRedeeming,
  gcAmount,
  setGcAmount,
  onRedeem,
  onRedeemMembership,
  onRedeemGiftCard,
  onClear,
}) {
  const tone = toneForStatus(active.status);
  const colors = toneStyles[tone] || toneStyles.neutral;

  return (
    <section
      style={{
        background: "var(--ink-0)",
        border: "2px solid var(--ink-800)",
        borderRadius: 18,
        boxShadow: "0 6px 0 var(--ink-800)",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          padding: "18px 20px",
          background: colors.bg,
          borderBottom: "1.5px solid var(--ink-100)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 16,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 14, minWidth: 0 }}>
          <div
            style={{
              width: 48,
              height: 48,
              borderRadius: 14,
              background: colors.soft,
              color: colors.fg,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <Icon name={active.kind === "gift_card" ? "credit-card" : active.kind === "membership" ? "badge-check" : "ticket"} size={24} />
          </div>
          <div style={{ minWidth: 0 }}>
            <div className="eyebrow">Current result</div>
            <h3
              style={{
                margin: "2px 0 0",
                fontFamily: "var(--font-display)",
                fontSize: 28,
                lineHeight: 1.05,
                fontWeight: 800,
              }}
            >
              {titleForRecord(active)}
            </h3>
          </div>
        </div>
        <StatusBadge tone={tone}>{active.status || "active"}</StatusBadge>
      </div>

      <div style={{ padding: 20 }}>
        {active.kind === "entitlement" && (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 12 }}>
              <Stat label="Entitlement" value={`#${active.entitlementId}`} />
              <Stat label="Remaining" value={`${active.remainingQty} of ${active.originalQty}`} />
              <Stat label="Expiry" value={formatExpiry(active.expiresAt)} />
            </div>
            <ActionBar>
              <button
                type="button"
                className="a-btn a-btn--primary"
                onClick={onRedeem}
                disabled={redeeming || active.remainingQty < 1 || active.status !== "active"}
              >
                <Icon name="check-circle-2" size={18} />
                {redeeming ? "Redeeming" : "Redeem 1"}
              </button>
              <button type="button" className="a-btn a-btn--ghost" onClick={onClear}>
                Clear
              </button>
            </ActionBar>
          </>
        )}

        {active.kind === "membership" && (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 12 }}>
              <Stat label="Member" value={`#${active.membershipId}`} />
              <Stat label="Used today" value={active.redemptionsToday || 0} />
              <Stat label="Expiry" value={formatExpiry(active.expiresAt)} />
            </div>
            {Array.isArray(active.todaysBenefits) && active.todaysBenefits.length > 0 && (
              <div style={{ marginTop: 16, display: "grid", gap: 8 }}>
                {active.todaysBenefits.slice(0, 4).map((benefit, index) => (
                  <div
                    key={index}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      gap: 12,
                      padding: "10px 12px",
                      borderRadius: 10,
                      background: "var(--ink-50)",
                      border: "1px solid var(--ink-100)",
                      fontSize: 13,
                    }}
                  >
                    <span style={{ fontWeight: 800 }}>{benefit.label}</span>
                    <span style={{ color: "var(--ink-500)" }}>
                      {benefit.qtyPerDay ? `${benefit.remainingToday} left` : "Unlimited"}
                    </span>
                  </div>
                ))}
              </div>
            )}
            <ActionBar>
              <button
                type="button"
                className="a-btn a-btn--primary"
                onClick={onRedeemMembership}
                disabled={redeemingMembership || active.status !== "active"}
              >
                <Icon name="badge-check" size={18} />
                {redeemingMembership ? "Checking in" : "Check in"}
              </button>
              <button type="button" className="a-btn a-btn--ghost" onClick={onClear}>
                Clear
              </button>
            </ActionBar>
          </>
        )}

        {active.kind === "voucher" && (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 12 }}>
              <Stat label="Voucher" value={`#${active.bookingItemId}`} />
              <Stat label="Slot" value={active.slotId ? `#${active.slotId}` : "Not scheduled"} />
              <Stat label="Expiry" value={formatExpiry(active.expiresAt)} />
            </div>
            <div
              style={{
                marginTop: 16,
                padding: "14px 16px",
                borderRadius: 12,
                background: active.slotId ? "var(--color-success-soft)" : "var(--color-warning-soft)",
                color: active.slotId ? "#137A35" : "#7A5400",
                fontWeight: 700,
                fontSize: 14,
              }}
            >
              {active.slotId
                ? "Already scheduled. Scan the regular ticket QR at the gate."
                : "Not scheduled yet. Send customer to My Vouchers or schedule it from booking detail."}
            </div>
            <ActionBar>
              <button type="button" className="a-btn a-btn--ghost" onClick={onClear}>
                Clear
              </button>
            </ActionBar>
          </>
        )}

        {active.kind === "gift_card" && (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 12 }}>
              <Stat label="Card" value={active.code} mono />
              <Stat label="Balance" value={`$${Number(active.currentBalance || 0).toFixed(2)}`} />
              <Stat label="Expiry" value={formatExpiry(active.expiresAt)} />
            </div>
            <ActionBar>
              <input
                type="number"
                step="0.01"
                min={0}
                max={Number(active.currentBalance)}
                value={gcAmount}
                onChange={(event) => setGcAmount(event.target.value)}
                placeholder="Amount"
                style={{ ...fieldStyle(), width: 150 }}
              />
              <button
                type="button"
                className="a-btn a-btn--primary"
                onClick={onRedeemGiftCard}
                disabled={gcRedeeming}
              >
                <Icon name="credit-card" size={18} />
                {gcRedeeming ? "Redeeming" : "Redeem"}
              </button>
              <button type="button" className="a-btn a-btn--ghost" onClick={onClear}>
                Clear
              </button>
            </ActionBar>
          </>
        )}
      </div>
    </section>
  );
}

function EmptyState({ tab }) {
  return (
    <div
      style={{
        minHeight: 340,
        background: "var(--ink-0)",
        border: "1.5px dashed var(--ink-200)",
        borderRadius: 18,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        textAlign: "center",
        color: "var(--ink-500)",
        padding: 32,
      }}
    >
      <Icon name={tab === "giftcard" ? "credit-card" : "scan-line"} size={42} stroke={1.5} />
      <div style={{ marginTop: 14, fontFamily: "var(--font-display)", fontSize: 24, fontWeight: 800, color: "var(--ink-800)" }}>
        {tab === "giftcard" ? "Look up a card" : "Scanner ready"}
      </div>
      <div style={{ marginTop: 4, fontSize: 14 }}>
        {tab === "giftcard"
          ? "Enter code and PIN to show balance and redeem."
          : "Scan a token and the current result will appear here."}
      </div>
    </div>
  );
}

function StatusBadge({ tone = "neutral", children }) {
  const colors = toneStyles[tone] || toneStyles.neutral;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "5px 10px",
        borderRadius: 999,
        background: colors.soft,
        color: colors.fg,
        border: `1px solid ${colors.border}`,
        fontSize: 11,
        fontWeight: 800,
        letterSpacing: "0.06em",
        textTransform: "uppercase",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}

function Stat({ label, value, mono = false }) {
  return (
    <div
      style={{
        background: "var(--ink-25)",
        border: "1px solid var(--ink-100)",
        borderRadius: 12,
        padding: "12px 14px",
        minWidth: 0,
      }}
    >
      <div className="eyebrow">{label}</div>
      <div
        style={{
          marginTop: 6,
          fontFamily: mono ? "var(--font-mono)" : "var(--font-display)",
          fontWeight: 800,
          fontSize: mono ? 14 : 22,
          color: "var(--ink-900)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {value}
      </div>
    </div>
  );
}

function ActionBar({ children }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", marginTop: 18 }}>
      {children}
    </div>
  );
}

function RollerRow({ entry, index }) {
  const colors = toneStyles[entry.tone] || toneStyles.neutral;
  return (
    <li
      style={{
        position: "relative",
        display: "grid",
        gridTemplateColumns: "34px minmax(0, 1fr)",
        gap: 10,
        padding: "12px 12px",
        borderRadius: 14,
        background: index === 0 ? colors.bg : "var(--ink-25)",
        border: `1.5px solid ${index === 0 ? colors.border : "var(--ink-100)"}`,
        boxShadow: index === 0 ? `0 4px 0 ${colors.border}` : "none",
        animation: index === 0 ? "ap-pop-in 160ms ease-out" : "none",
      }}
    >
      <div
        style={{
          width: 34,
          height: 34,
          borderRadius: 10,
          background: colors.soft,
          color: colors.fg,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Icon name={entry.ok ? "check" : "x"} size={18} stroke={3} />
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline" }}>
          <span style={{ fontSize: 11, fontWeight: 800, color: colors.fg, textTransform: "uppercase", letterSpacing: "0.06em" }}>
            {entry.action}
          </span>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--ink-400)", whiteSpace: "nowrap" }}>
            {formatTime(entry.at)}
          </span>
        </div>
        <div style={{ marginTop: 3, fontWeight: 800, color: "var(--ink-900)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {entry.title}
        </div>
        <div style={{ marginTop: 2, color: "var(--ink-500)", fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {entry.detail}
        </div>
        <div style={{ marginTop: 6 }}>
          <StatusBadge tone={entry.tone}>{entry.meta}</StatusBadge>
        </div>
      </div>
    </li>
  );
}

function fieldStyle(fontFamily = "var(--font-sans)") {
  return {
    minWidth: 0,
    width: "100%",
    boxSizing: "border-box",
    border: "1.5px solid var(--ink-200)",
    borderRadius: 12,
    background: "var(--ink-0)",
    padding: "12px 14px",
    fontFamily,
    fontSize: 15,
    fontWeight: 800,
    color: "var(--ink-900)",
    outline: "none",
  };
}

export default VoucherCounter;
