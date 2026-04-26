// ManagerOverridePrompt — modal that asks for a manager PIN before
// authorising a restricted action. The cashier sees:
//   • What the action is (apply expired promo, refund $X, void redeemed ticket…)
//   • The reason the system blocked it
//   • A 4-6 digit PIN pad
//   • An optional reason note for the audit log
//
// On success the parent receives the audit row { auditId, managerName }
// so it can retry the original action with proof of override.

import React, { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useStore } from "react-redux";

export default function ManagerOverridePrompt({
  open,
  title = "Manager approval required",
  description,
  action,         // short tag for the audit (e.g. "apply_expired_promo")
  targetType,
  targetId,
  payload,
  defaultReason = "",
  onApprove,      // (audit) => void
  onCancel,
}) {
  const [pin, setPin] = useState("");
  const [reason, setReason] = useState(defaultReason);
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef(null);
  const store = useStore();

  useEffect(() => {
    if (open) {
      setPin("");
      setReason(defaultReason);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open, defaultReason]);

  if (!open) return null;

  const submit = async () => {
    if (pin.length < 4) {
      toast.error("PIN must be at least 4 digits");
      return;
    }
    setSubmitting(true);
    try {
      const token = store.getState()?.auth?.token;
      const apiBase = import.meta.env.VITE_API_BASE_URL || "/api";
      const res = await fetch(`${apiBase}/pos/manager-override/verify`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ pin, action, targetType, targetId, reason, payload }),
      });
      const body = await res.json();
      if (!res.ok || !body?.success) {
        toast.error(body?.error || "Manager override rejected");
        setSubmitting(false);
        return;
      }
      toast.success(`Approved by ${body.data.managerName}`);
      onApprove?.(body.data);
    } catch (err) {
      toast.error(err?.message || "Override request failed");
      setSubmitting(false);
    }
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 100,
        background: "rgba(26, 24, 20, 0.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
      }}
      onClick={onCancel}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "white",
          border: "2px solid var(--ink-800)",
          borderRadius: 18,
          padding: 26,
          boxShadow: "0 6px 0 var(--ink-800)",
          width: "min(420px, 100%)",
        }}
      >
        <div style={{ display: "flex", alignItems: "flex-start", gap: 12, marginBottom: 16 }}>
          <span
            style={{
              width: 44, height: 44, borderRadius: 12,
              background: "var(--color-warning, #E9A100)",
              color: "white",
              display: "inline-flex", alignItems: "center", justifyContent: "center",
              fontSize: 22, fontWeight: 800,
              border: "1.5px solid var(--ink-800)",
              flexShrink: 0,
            }}
          >
            ⚠
          </span>
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: "var(--font-display)", fontSize: 18, fontWeight: 800, color: "var(--ink-900)" }}>
              {title}
            </div>
            {description && (
              <div style={{ fontSize: 13, color: "var(--ink-600)", fontWeight: 600, marginTop: 4 }}>
                {description}
              </div>
            )}
          </div>
        </div>

        <label style={{ display: "block", fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--ink-500)", marginBottom: 6 }}>
          Manager PIN
        </label>
        <input
          ref={inputRef}
          type="password"
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={6}
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
          onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
          placeholder="• • • •"
          autoComplete="off"
          style={{
            width: "100%",
            padding: "14px 16px",
            borderRadius: 12,
            border: "2px solid var(--ink-300)",
            background: "white",
            fontFamily: "var(--font-mono)",
            fontSize: 24,
            fontWeight: 800,
            color: "var(--ink-900)",
            textAlign: "center",
            letterSpacing: "0.5em",
            boxSizing: "border-box",
            marginBottom: 14,
          }}
        />

        <label style={{ display: "block", fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--ink-500)", marginBottom: 6 }}>
          Reason (optional but recommended)
        </label>
        <input
          type="text"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="e.g. Customer brought expired flyer"
          style={{
            width: "100%",
            padding: "10px 14px",
            borderRadius: 12,
            border: "1.5px solid var(--ink-300)",
            background: "white",
            fontSize: 13,
            color: "var(--ink-900)",
            boxSizing: "border-box",
            marginBottom: 18,
          }}
        />

        <div style={{ display: "flex", gap: 10 }}>
          <button
            type="button"
            onClick={onCancel}
            disabled={submitting}
            className="a-btn a-btn--ghost"
            style={{ flex: 1, justifyContent: "center" }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={submitting || pin.length < 4}
            className="a-btn a-btn--primary"
            style={{ flex: 1, justifyContent: "center" }}
          >
            {submitting ? "Verifying…" : "Authorize"}
          </button>
        </div>
      </div>
    </div>
  );
}
