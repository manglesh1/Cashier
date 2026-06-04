// ApplyBenefitFlyout — unified entry point for the four cart-led
// benefit flows: Promo code, Member benefit, Voucher/Pack credit,
// Gift card. Opens from a single "Apply benefit" button in CartPanel
// so cashiers don't have to remember which scattered shortcut does
// what.
//
// Two semantic groups, labeled in the UI:
//   REDUCE TOTAL  — discounts that lower the cart subtotal
//   PAY WITH      — non-cash payments that pay the resulting total
//
// State pushed up via onChange({ promo, member, vouchers, payments })
// so the parent (CartPanel) can fold them into its pricing summary
// and the createBooking payload.

import React, { useState } from "react";
import { toast } from "sonner";
import { Icon } from "./Icon";
import {
  useLazyValidateDiscountCodeQuery,
} from "../../features/discount/discountApi";
import {
  useLazyLookupVoucherByTokenQuery,
  useLazyLookupGiftCardQuery,
  useRedeemGiftCardMutation,
} from "../../features/vouchers/voucherApi";

const ACCENT = {
  promo: "#F45B0A",    // aero-orange
  member: "#6366F1",   // indigo
  voucher: "#22C55E",  // green
  gift: "#EC4899",     // pink
  comp: "#94A3B8",     // grey for placeholders
};

function GroupLabel({ children }) {
  return (
    <div
      style={{
        fontSize: 10,
        fontWeight: 800,
        letterSpacing: "0.1em",
        textTransform: "uppercase",
        color: "var(--ink-500)",
        marginBottom: 6,
        paddingLeft: 2,
      }}
    >
      {children}
    </div>
  );
}

function Tile({ accent, icon, title, sub, active, disabled, onClick }) {
  return (
    <button
      type="button"
      onClick={disabled ? undefined : onClick}
      style={{
        flex: 1,
        minWidth: 0,
        textAlign: "left",
        padding: "11px 12px",
        borderRadius: 10,
        border: `2px solid ${active ? accent : "var(--ink-200)"}`,
        background: active ? `${accent}10` : "white",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.45 : 1,
        display: "flex",
        flexDirection: "column",
        gap: 2,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          fontWeight: 800,
          fontSize: 13,
          color: accent,
        }}
      >
        <Icon name={icon} size={14} />
        {title}
      </div>
      <div style={{ fontSize: 11, color: "var(--ink-500)" }}>{sub}</div>
    </button>
  );
}

function PanelShell({ accent, title, onClose, children }) {
  return (
    <div
      style={{
        marginTop: 10,
        border: `1.5px solid ${accent}`,
        borderRadius: 10,
        background: `${accent}08`,
        padding: 12,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 10,
        }}
      >
        <div style={{ fontWeight: 800, color: accent, fontSize: 12, letterSpacing: "0.04em", textTransform: "uppercase" }}>
          {title}
        </div>
        <button
          type="button"
          onClick={onClose}
          style={{
            background: "transparent",
            border: 0,
            color: "var(--ink-500)",
            cursor: "pointer",
            fontSize: 16,
            lineHeight: 1,
          }}
          aria-label="Close panel"
        >
          ×
        </button>
      </div>
      {children}
    </div>
  );
}

/* ── Promo code ─────────────────────────────────────────────── */
function PromoPanel({ value, onApply, onRemove, onClose }) {
  const [code, setCode] = useState("");
  const [mode, setMode] = useState("code"); // code | percentage | amount
  const [validate, { isFetching }] = useLazyValidateDiscountCodeQuery();

  const submit = async () => {
    const raw = code.trim();
    if (!raw) return toast.error("Enter a code or amount");
    if (mode === "code") {
      try {
        const res = await validate(raw).unwrap();
        const d = res?.data;
        if (!d) return toast.error("Code not recognized");
        if (d.expired || d.blocked) {
          return toast.error("Code expired or blocked — use Manager Discount instead");
        }
        onApply({
          source: "code",
          code: d.code,
          name: d.name,
          discountType: d.discountType,
          value: Number(d.value),
          maxValue: Number(d.maxValue || 0),
        });
        setCode("");
        onClose();
      } catch (err) {
        toast.error(err?.data?.message || "Code lookup failed");
      }
    } else {
      const n = Number(raw);
      if (!Number.isFinite(n) || n <= 0) return toast.error("Enter a positive amount");
      onApply({
        source: mode,
        // Pseudo-discount object compatible with the existing
        // computeDiscountAmount helper: type 1 = %, 2 = $.
        discountType: mode === "percentage" ? 1 : 2,
        value: n,
        maxValue: 0,
        name: mode === "percentage" ? `${n}% off` : `$${n.toFixed(2)} off`,
      });
      setCode("");
      onClose();
    }
  };

  if (value) {
    return (
      <PanelShell accent={ACCENT.promo} title="Promo applied" onClose={onClose}>
        <div style={{ fontSize: 13, marginBottom: 8 }}>
          <strong>{value.code || value.name}</strong>{" "}
          <span style={{ color: "var(--ink-500)" }}>
            ({value.discountType === 1 ? `${value.value}%` : `$${Number(value.value).toFixed(2)}`})
          </span>
        </div>
        <button
          type="button"
          onClick={onRemove}
          className="a-btn a-btn--ghost a-btn--sm"
          style={{ width: "100%", justifyContent: "center" }}
        >
          Remove
        </button>
      </PanelShell>
    );
  }

  return (
    <PanelShell accent={ACCENT.promo} title="Promo / discount" onClose={onClose}>
      <div style={{ display: "flex", gap: 4, marginBottom: 8 }}>
        {[
          { v: "code", label: "Code" },
          { v: "percentage", label: "%" },
          { v: "amount", label: "$" },
        ].map((o) => (
          <button
            key={o.v}
            type="button"
            onClick={() => setMode(o.v)}
            style={{
              flex: 1,
              padding: "6px 10px",
              borderRadius: 6,
              border: "1.5px solid var(--ink-200)",
              background: mode === o.v ? ACCENT.promo : "white",
              color: mode === o.v ? "white" : "var(--ink-700)",
              fontWeight: 700,
              fontSize: 12,
              cursor: "pointer",
            }}
          >
            {o.label}
          </button>
        ))}
      </div>
      <div style={{ display: "flex", gap: 6 }}>
        <input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder={mode === "code" ? "PROMO10" : mode === "percentage" ? "10" : "5.00"}
          autoFocus
          style={{
            flex: 1,
            padding: "9px 11px",
            border: "1.5px solid var(--ink-300)",
            borderRadius: 8,
            fontSize: 14,
          }}
        />
        <button
          type="button"
          onClick={submit}
          disabled={isFetching}
          className="a-btn a-btn--primary a-btn--sm"
          style={{ justifyContent: "center", padding: "0 14px" }}
        >
          {isFetching ? "…" : "Apply"}
        </button>
      </div>
    </PanelShell>
  );
}

/* ── Member benefit ─────────────────────────────────────────── */
function MemberPanel({ value, onApply, onRemove, onClose }) {
  const [token, setToken] = useState("");
  const [lookup, { isFetching }] = useLazyLookupVoucherByTokenQuery();

  const submit = async () => {
    const t = token.trim();
    if (!t) return toast.error("Scan or paste the member's pass token");
    try {
      const res = await lookup(t).unwrap();
      const data = res?.data;
      if (data?.kind !== "membership") {
        return toast.error("That token is not a membership pass");
      }
      if (data.status !== "active") {
        return toast.error(`Membership is ${data.status}`);
      }
      onApply({
        membershipId: data.membershipId,
        activityName: data.activityName,
        guestName: data.guestName,
        todaysBenefits: data.todaysBenefits || [],
      });
      setToken("");
      onClose();
    } catch (err) {
      toast.error(err?.data?.message || "Member lookup failed");
    }
  };

  if (value) {
    return (
      <PanelShell accent={ACCENT.member} title="Member applied" onClose={onClose}>
        <div style={{ fontSize: 13, marginBottom: 4 }}>
          <strong>{value.guestName || "Member"}</strong>
        </div>
        <div style={{ fontSize: 12, color: "var(--ink-500)", marginBottom: 8 }}>
          {value.activityName || "Membership"}
        </div>
        {(value.todaysBenefits || []).length > 0 ? (
          <div style={{ display: "grid", gap: 4, marginBottom: 8 }}>
            {value.todaysBenefits.map((b, i) => (
              <div
                key={i}
                style={{
                  fontSize: 11,
                  padding: "5px 8px",
                  borderRadius: 6,
                  background: "white",
                  border: "1px solid rgba(99,102,241,0.2)",
                }}
              >
                <strong>{b.label}</strong>{" "}
                <span style={{ color: "var(--ink-500)" }}>
                  · {b.discountPct === 100 ? "Free" : `${b.discountPct}% off`}
                  {b.qtyPerDay ? ` · ${b.remainingToday}/${b.qtyPerDay} today` : ""}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ fontSize: 11.5, color: "var(--ink-500)", marginBottom: 8 }}>
            No benefits applicable right now.
          </div>
        )}
        <button
          type="button"
          onClick={onRemove}
          className="a-btn a-btn--ghost a-btn--sm"
          style={{ width: "100%", justifyContent: "center" }}
        >
          Remove
        </button>
      </PanelShell>
    );
  }

  return (
    <PanelShell accent={ACCENT.member} title="Member benefit" onClose={onClose}>
      <div style={{ fontSize: 11.5, color: "var(--ink-500)", marginBottom: 8 }}>
        Scan or paste the member's digital pass token. Today's benefits
        will auto-apply to matching cart lines.
      </div>
      <div style={{ display: "flex", gap: 6 }}>
        <input
          value={token}
          onChange={(e) => setToken(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder="Scan QR or paste token…"
          autoFocus
          style={{
            flex: 1,
            padding: "9px 11px",
            border: "1.5px solid var(--ink-300)",
            borderRadius: 8,
            fontSize: 14,
          }}
        />
        <button
          type="button"
          onClick={submit}
          disabled={isFetching}
          className="a-btn a-btn--primary a-btn--sm"
          style={{ justifyContent: "center", padding: "0 14px", background: ACCENT.member, borderColor: ACCENT.member }}
        >
          {isFetching ? "…" : "Apply"}
        </button>
      </div>
    </PanelShell>
  );
}

/* ── Voucher / pack ─────────────────────────────────────────── */
function VoucherPanel({ vouchers, onAddVoucher, onRemove, onClose }) {
  const [token, setToken] = useState("");
  const [lookup, { isFetching }] = useLazyLookupVoucherByTokenQuery();

  const submit = async () => {
    const t = token.trim();
    if (!t) return toast.error("Scan or paste a voucher token");
    if (vouchers.some((v) => v.token === t)) {
      return toast.error("That voucher is already added");
    }
    try {
      const res = await lookup(t).unwrap();
      const data = res?.data;
      if (data?.kind !== "voucher" && data?.kind !== "entitlement") {
        return toast.error("That token is not a voucher or entitlement");
      }
      if (data.status && data.status !== "active") {
        return toast.error(`Voucher is ${data.status}`);
      }
      onAddVoucher({
        token: t,
        kind: data.kind,
        bookingItemId: data.bookingItemId || null,
        entitlementId: data.entitlementId || null,
        activityId: data.activityId || null,
        variationId: data.variationId || null,
        remainingQty: data.remainingQty || null,
        expiresAt: data.expiresAt || null,
      });
      setToken("");
      toast.success(`Voucher reserved (${data.kind}) — will bind on submit`);
    } catch (err) {
      toast.error(err?.data?.message || "Voucher lookup failed");
    }
  };

  return (
    <PanelShell accent={ACCENT.voucher} title="Voucher / pack credit" onClose={onClose}>
      <div style={{ fontSize: 11.5, color: "var(--ink-500)", marginBottom: 8 }}>
        Scan a pre-paid voucher or entitlement token. It'll cover the
        matching cart line on submit.
      </div>
      <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
        <input
          value={token}
          onChange={(e) => setToken(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder="Scan QR or paste token…"
          autoFocus
          style={{
            flex: 1,
            padding: "9px 11px",
            border: "1.5px solid var(--ink-300)",
            borderRadius: 8,
            fontSize: 14,
          }}
        />
        <button
          type="button"
          onClick={submit}
          disabled={isFetching}
          className="a-btn a-btn--primary a-btn--sm"
          style={{ justifyContent: "center", padding: "0 14px", background: ACCENT.voucher, borderColor: ACCENT.voucher }}
        >
          {isFetching ? "…" : "Add"}
        </button>
      </div>
      {vouchers.length > 0 && (
        <div style={{ display: "grid", gap: 4 }}>
          {vouchers.map((v) => (
            <div
              key={v.token}
              style={{
                fontSize: 11,
                padding: "5px 8px",
                borderRadius: 6,
                background: "white",
                border: "1px solid rgba(34,197,94,0.25)",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <span>
                {v.kind === "entitlement" ? "Entitlement" : "Voucher"} ·{" "}
                activity #{v.activityId}
                {v.remainingQty ? ` · ${v.remainingQty} left` : ""}
              </span>
              <button
                type="button"
                onClick={() => onRemove(v.token)}
                style={{
                  background: "transparent",
                  border: 0,
                  color: "var(--ink-500)",
                  cursor: "pointer",
                  fontSize: 14,
                  lineHeight: 1,
                  padding: 2,
                }}
                aria-label="Remove voucher"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </PanelShell>
  );
}

/* ── Gift card ──────────────────────────────────────────────── */
function GiftCardPanel({ outstanding, onApply, payments, onRemove, onClose }) {
  const [code, setCode] = useState("");
  const [pin, setPin] = useState("");
  const [card, setCard] = useState(null);
  const [amount, setAmount] = useState("");
  const [lookup, { isFetching: looking }] = useLazyLookupGiftCardQuery();
  const [redeem, { isLoading: redeeming }] = useRedeemGiftCardMutation();

  const handleLookup = async () => {
    if (!code.trim() || !pin.trim()) return toast.error("Code and PIN required");
    try {
      const res = await lookup({ code: code.trim().toUpperCase(), pin: pin.trim() }).unwrap();
      const c = res?.data;
      if (!c) return toast.error("Card not found");
      if (c.status !== "active") return toast.error(`Card is ${c.status}`);
      setCard(c);
      const suggest = Math.min(Number(c.currentBalance) || 0, Number(outstanding) || 0);
      setAmount(suggest > 0 ? suggest.toFixed(2) : "");
    } catch (err) {
      toast.error(err?.data?.message || "Lookup failed");
    }
  };

  const handleApply = async () => {
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) return toast.error("Enter a positive amount");
    if (amt > Number(card.currentBalance)) {
      return toast.error(`Card has only $${Number(card.currentBalance).toFixed(2)}`);
    }
    try {
      const res = await redeem({
        code: card.code,
        pin: pin.trim(),
        amount: amt,
        note: "Cashier cart-led apply",
      }).unwrap();
      const data = res?.data;
      onApply({
        method: "gift_card",
        amount: amt,
        code: card.code,
        giftCardId: data.giftCardId,
        balanceAfter: Number(data.balanceAfter),
        redemptionId: data.redemptionId,
      });
      toast.success(`Applied $${amt.toFixed(2)} · $${Number(data.balanceAfter).toFixed(2)} remaining on card`);
      setCard(null);
      setCode("");
      setPin("");
      setAmount("");
    } catch (err) {
      toast.error(err?.data?.message || "Redeem failed");
    }
  };

  const giftCardPayments = payments.filter((p) => p.method === "gift_card");

  return (
    <PanelShell accent={ACCENT.gift} title="Gift card" onClose={onClose}>
      {giftCardPayments.length > 0 && (
        <div style={{ display: "grid", gap: 4, marginBottom: 10 }}>
          {giftCardPayments.map((p, i) => (
            <div
              key={p.redemptionId || i}
              style={{
                fontSize: 11,
                padding: "5px 8px",
                borderRadius: 6,
                background: "white",
                border: "1px solid rgba(236,72,153,0.25)",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <span>
                {p.code} · paid <strong>${p.amount.toFixed(2)}</strong>{" "}
                <span style={{ color: "var(--ink-500)" }}>
                  (${p.balanceAfter?.toFixed(2)} remaining)
                </span>
              </span>
              <button
                type="button"
                onClick={() => onRemove(p)}
                style={{
                  background: "transparent",
                  border: 0,
                  color: "var(--ink-500)",
                  cursor: "pointer",
                  fontSize: 14,
                  lineHeight: 1,
                  padding: 2,
                }}
                aria-label="Remove gift card payment"
                title="Removes from cart total; the gift card redemption itself stays in the ledger — credit it back manually via admin if needed."
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      {!card ? (
        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr auto", gap: 6 }}>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="XXXX-XXXX-XXXX"
            autoFocus
            style={{
              padding: "9px 11px",
              border: "1.5px solid var(--ink-300)",
              borderRadius: 8,
              fontSize: 14,
              fontFamily: "monospace",
            }}
          />
          <input
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
            placeholder="PIN"
            maxLength={4}
            type="password"
            inputMode="numeric"
            style={{
              padding: "9px 11px",
              border: "1.5px solid var(--ink-300)",
              borderRadius: 8,
              fontSize: 14,
            }}
          />
          <button
            type="button"
            onClick={handleLookup}
            disabled={looking}
            className="a-btn a-btn--primary a-btn--sm"
            style={{ background: ACCENT.gift, borderColor: ACCENT.gift, padding: "0 12px" }}
          >
            {looking ? "…" : "Look up"}
          </button>
        </div>
      ) : (
        <div style={{ display: "grid", gap: 8 }}>
          <div style={{ fontSize: 12 }}>
            <strong style={{ fontFamily: "monospace" }}>{card.code}</strong> · balance{" "}
            <strong style={{ color: ACCENT.gift }}>
              ${Number(card.currentBalance).toFixed(2)}
            </strong>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr auto auto", gap: 6 }}>
            <input
              type="number"
              step="0.01"
              min={0}
              max={Number(card.currentBalance)}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="Amount"
              style={{
                padding: "9px 11px",
                border: "1.5px solid var(--ink-300)",
                borderRadius: 8,
                fontSize: 14,
              }}
            />
            <button
              type="button"
              onClick={handleApply}
              disabled={redeeming}
              className="a-btn a-btn--primary a-btn--sm"
              style={{ background: ACCENT.gift, borderColor: ACCENT.gift, padding: "0 12px" }}
            >
              {redeeming ? "…" : "Apply"}
            </button>
            <button
              type="button"
              onClick={() => { setCard(null); setCode(""); setPin(""); setAmount(""); }}
              className="a-btn a-btn--ghost a-btn--sm"
            >
              Clear
            </button>
          </div>
        </div>
      )}
    </PanelShell>
  );
}

/* ── Main flyout ────────────────────────────────────────────── */
export default function ApplyBenefitFlyout({
  open,
  onClose,
  applied = {
    promo: null,
    member: null,
    vouchers: [],
    payments: [],
  },
  outstanding = 0,
  onChange,
}) {
  const [active, setActive] = useState(null); // "promo" | "member" | "voucher" | "gift" | null

  if (!open) return null;

  const update = (patch) => onChange({ ...applied, ...patch });

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15, 14, 11, 0.45)",
        zIndex: 1000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "white",
          borderRadius: 14,
          padding: 18,
          width: "100%",
          maxWidth: 520,
          maxHeight: "90vh",
          overflowY: "auto",
          boxShadow: "0 24px 48px rgba(0,0,0,0.18)",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
            marginBottom: 14,
          }}
        >
          <div>
            <h3 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>Apply benefit</h3>
            <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--ink-500)" }}>
              Reduce the total or pay with non-cash money.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="a-btn a-btn--ghost a-btn--sm"
          >
            Close
          </button>
        </div>

        <GroupLabel>Reduce total</GroupLabel>
        <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
          <Tile
            accent={ACCENT.promo}
            icon="gift"
            title="Promo / code"
            sub={applied.promo ? "Applied" : "Code, %, or $"}
            active={active === "promo" || !!applied.promo}
            onClick={() => setActive(active === "promo" ? null : "promo")}
          />
          <Tile
            accent={ACCENT.member}
            icon="user"
            title="Member"
            sub={applied.member ? "Applied" : "Scan pass"}
            active={active === "member" || !!applied.member}
            onClick={() => setActive(active === "member" ? null : "member")}
          />
        </div>
        <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
          <Tile
            accent={ACCENT.comp}
            icon="award"
            title="Employee"
            sub="Coming next phase"
            disabled
            active={false}
            onClick={() => {}}
          />
          <Tile
            accent={ACCENT.comp}
            icon="key"
            title="Manager / Comp"
            sub="Coming next phase"
            disabled
            active={false}
            onClick={() => {}}
          />
        </div>

        <GroupLabel>Pay with (non-cash)</GroupLabel>
        <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
          <Tile
            accent={ACCENT.voucher}
            icon="ticket"
            title="Voucher / pack"
            sub={applied.vouchers.length > 0 ? `${applied.vouchers.length} reserved` : "Scan voucher"}
            active={active === "voucher" || applied.vouchers.length > 0}
            onClick={() => setActive(active === "voucher" ? null : "voucher")}
          />
          <Tile
            accent={ACCENT.gift}
            icon="credit-card"
            title="Gift card"
            sub={
              applied.payments.filter((p) => p.method === "gift_card").length > 0
                ? `$${applied.payments
                    .filter((p) => p.method === "gift_card")
                    .reduce((s, p) => s + p.amount, 0)
                    .toFixed(2)} applied`
                : "Code + PIN"
            }
            active={active === "gift" || applied.payments.some((p) => p.method === "gift_card")}
            onClick={() => setActive(active === "gift" ? null : "gift")}
          />
        </div>
        <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
          <Tile
            accent={ACCENT.comp}
            icon="dollar-sign"
            title="Store credit"
            sub="Coming next phase"
            disabled
            active={false}
            onClick={() => {}}
          />
        </div>

        {active === "promo" && (
          <PromoPanel
            value={applied.promo}
            onApply={(promo) => update({ promo })}
            onRemove={() => update({ promo: null })}
            onClose={() => setActive(null)}
          />
        )}
        {active === "member" && (
          <MemberPanel
            value={applied.member}
            onApply={(member) => update({ member })}
            onRemove={() => update({ member: null })}
            onClose={() => setActive(null)}
          />
        )}
        {active === "voucher" && (
          <VoucherPanel
            vouchers={applied.vouchers}
            onAddVoucher={(v) =>
              update({ vouchers: [...applied.vouchers, v] })
            }
            onRemove={(token) =>
              update({ vouchers: applied.vouchers.filter((v) => v.token !== token) })
            }
            onClose={() => setActive(null)}
          />
        )}
        {active === "gift" && (
          <GiftCardPanel
            outstanding={outstanding}
            payments={applied.payments}
            onApply={(payment) =>
              update({ payments: [...applied.payments, payment] })
            }
            onRemove={(p) =>
              update({
                payments: applied.payments.filter(
                  (x) => x.redemptionId !== p.redemptionId
                ),
              })
            }
            onClose={() => setActive(null)}
          />
        )}

        {/* Summary footer */}
        <div
          style={{
            marginTop: 16,
            padding: 12,
            background: "var(--ink-50)",
            borderRadius: 10,
            fontSize: 12,
          }}
        >
          <BenefitSummary applied={applied} outstanding={outstanding} />
        </div>
      </div>
    </div>
  );
}

function BenefitSummary({ applied, outstanding }) {
  const giftCardPaid = applied.payments
    .filter((p) => p.method === "gift_card")
    .reduce((s, p) => s + p.amount, 0);
  const hasAny =
    applied.promo ||
    applied.member ||
    applied.vouchers.length > 0 ||
    giftCardPaid > 0;
  if (!hasAny) {
    return (
      <div style={{ color: "var(--ink-500)" }}>
        No benefits applied yet. Pick one above.
      </div>
    );
  }
  return (
    <div style={{ display: "grid", gap: 4 }}>
      <div style={{ fontWeight: 800, color: "var(--ink-700)" }}>Summary</div>
      {applied.promo && (
        <div>• Promo {applied.promo.code || applied.promo.name}</div>
      )}
      {applied.member && (
        <div>• Member benefits for {applied.member.guestName || "member"}</div>
      )}
      {applied.vouchers.length > 0 && (
        <div>• {applied.vouchers.length} voucher(s) reserved (bind on submit)</div>
      )}
      {giftCardPaid > 0 && (
        <div>• Gift card paid ${giftCardPaid.toFixed(2)}</div>
      )}
      <div style={{ marginTop: 4, color: "var(--ink-500)" }}>
        Outstanding after applied benefits + payments: ~${Number(outstanding).toFixed(2)}
      </div>
    </div>
  );
}
