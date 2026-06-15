// TipStep — the in-checkout gratuity selector. Self-contained: owns the
// percent/custom entry, the allocation radio, and the manager-PIN gate
// for self-assigning a host tip (§5.1). Emits the full tip object up to
// the parent via onChange. Tip NEVER changes the booking total — the
// parent records it as a dedicated tip-only transaction.
//
// Props:
//   base     number   — amount the % buttons compute on (already chosen by
//                       the parent per calculateTipsOnBookingTotal)
//   bookingId number? — used by the override pre-check (null for a draft)
//   defaults  object  — from useTipDefaults()
//   value     object  — { amount, allocation, selectedPct, managerOverrideAuditId }
//   onChange  fn      — (nextValue) => void

import React, { useState } from "react";
import { toast } from "sonner";
import ManagerOverridePrompt from "../../components/ManagerOverridePrompt";
import { applyTipPercent, TIP_ALLOCATIONS } from "./tipMath";
import { useCheckTipOverrideMutation } from "./tipsApi";
import { moneyFmt, roundMoney } from "../../lib/money";

export default function TipStep({ base, bookingId, defaults, value, onChange, allocations = TIP_ALLOCATIONS }) {
  const [customOpen, setCustomOpen] = useState(false);
  const [customText, setCustomText] = useState("");
  const [managerOpen, setManagerOpen] = useState(false);
  const [pendingAllocation, setPendingAllocation] = useState(null);
  const [checkTipOverride] = useCheckTipOverrideMutation();

  const tipAmount = roundMoney(value?.amount || 0);
  const allocation = value?.allocation || defaults.defaultAllocation;
  const selectedPct = value?.selectedPct ?? null;

  const setTip = (patch) => onChange({ ...value, allocation, ...patch });

  const pickPercent = (pct) => {
    setCustomOpen(false);
    setTip({ amount: applyTipPercent(base, pct), selectedPct: pct });
  };
  const pickNone = () => {
    setCustomOpen(false);
    setCustomText("");
    setTip({ amount: 0, selectedPct: null });
  };
  const openCustom = () => {
    setCustomOpen(true);
    setCustomText(tipAmount > 0 ? String(tipAmount) : "");
    setTip({ selectedPct: "custom" });
  };
  const onCustomChange = (txt) => {
    const clean = txt.replace(/[^\d.]/g, "");
    setCustomText(clean);
    setTip({ amount: roundMoney(Number(clean) || 0), selectedPct: "custom" });
  };

  // Allocation change — ask the backend whether this transition needs a
  // manager PIN (only default booking_host + a host exists + self-assign).
  const selectAllocation = async (next) => {
    if (next === allocation) return;
    try {
      const res = await checkTipOverride({
        defaultAllocation: defaults.defaultAllocation,
        toAllocation: next,
        bookingId: bookingId || null,
      }).unwrap();
      if (res?.data?.requiresManagerCode) {
        setPendingAllocation(next);
        setManagerOpen(true);
        return;
      }
      onChange({ ...value, allocation: next, managerOverrideAuditId: null });
    } catch (err) {
      toast.error(err?.data?.message || "Could not validate tip allocation.");
    }
  };

  const PCT = defaults.percentages;
  const charged = roundMoney(base + tipAmount);

  const btn = (active) => ({
    minHeight: 42,
    padding: "0 10px",
    borderRadius: 9,
    border: `1.5px solid ${active ? "#137A35" : "var(--ink-200)"}`,
    background: active ? "#137A35" : "white",
    color: active ? "white" : "var(--ink-900)",
    fontWeight: 800,
    fontSize: 13,
    cursor: "pointer",
  });

  return (
    <div style={{ marginTop: 14, padding: "10px 12px", background: "white",
      border: "1.5px solid var(--ink-200)", borderRadius: 10 }}>
      <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: ".06em",
        textTransform: "uppercase", color: "var(--ink-500)", marginBottom: 8 }}>
        Tip (optional)
      </div>

      <div style={{ display: "grid", gridTemplateColumns: `repeat(${PCT.length + 2}, 1fr)`, gap: 6 }}>
        {PCT.map((p) => (
          <button key={p} type="button" style={btn(selectedPct === p)} onClick={() => pickPercent(p)}>
            {p}%
          </button>
        ))}
        {defaults.allowCustom && (
          <button type="button" style={btn(selectedPct === "custom")} onClick={openCustom}>
            Custom
          </button>
        )}
        <button type="button" style={btn(selectedPct === null && tipAmount === 0)} onClick={pickNone}>
          None
        </button>
      </div>

      {customOpen && defaults.allowCustom && (
        <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontWeight: 800, color: "var(--ink-700)" }}>$</span>
          <input
            value={customText}
            onChange={(e) => onCustomChange(e.target.value)}
            inputMode="decimal"
            placeholder="0.00"
            autoFocus
            style={{ flex: 1, fontSize: 15, padding: "8px 10px",
              border: "1.5px solid var(--ink-200)", borderRadius: 8,
              fontFamily: "var(--font-mono)", fontWeight: 700 }}
          />
        </div>
      )}

      {tipAmount > 0 && (
        <>
          <div style={{ marginTop: 10, marginBottom: 6, fontSize: 11, fontWeight: 800,
            letterSpacing: ".06em", textTransform: "uppercase", color: "var(--ink-500)" }}>
            Tip goes to
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {allocations.map((opt) => (
              <label key={opt.value} style={{ display: "flex", alignItems: "center", gap: 8,
                fontSize: 13, cursor: "pointer", color: "var(--ink-800)" }}>
                <input
                  type="radio"
                  name="tipAllocation"
                  checked={allocation === opt.value}
                  onChange={() => selectAllocation(opt.value)}
                />
                {opt.label}
              </label>
            ))}
          </div>

          <div style={{ marginTop: 10, paddingTop: 8, borderTop: "1px dashed var(--ink-200)",
            display: "flex", justifyContent: "space-between", fontSize: 13, fontWeight: 800,
            color: "var(--ink-900)" }}>
            <span>Tip {moneyFmt(tipAmount)} · Charged</span>
            <span>{moneyFmt(charged)}</span>
          </div>
        </>
      )}

      <ManagerOverridePrompt
        open={managerOpen}
        title="Manager approval — reassign host tip"
        description="Sending the booking host's tip to yourself needs a manager PIN."
        action="tip_allocation_override"
        targetType="booking"
        targetId={bookingId || "draft-sale"}
        payload={{ from: defaults.defaultAllocation, to: pendingAllocation }}
        defaultReason="Cashier self-assigned a host tip"
        onCancel={() => { setManagerOpen(false); setPendingAllocation(null); }}
        onApprove={(audit) => {
          onChange({ ...value, allocation: pendingAllocation, managerOverrideAuditId: audit?.auditId || null });
          setManagerOpen(false);
          setPendingAllocation(null);
        }}
      />
    </div>
  );
}
