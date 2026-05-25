// RedeemableList — renders the uniform redeemables from the resolver, one
// action button each, driven entirely by redeemable.action.type + state. No
// per-kind branching: the backend declares the action, this just shows it.

const GROUP_TITLES = {
  schedulable: "Session passes — auto-schedule to nearest slot",
  stock: "Stock items — redeem at the counter",
  gate: "Gate entry",
};

const ACTION_LABEL = {
  schedule_nearest: "Redeem to nearest slot",
  redeem_qty: "Redeem 1",
  admit: "Admit",
};

const STATE_BADGE = {
  scheduled: { text: "Scheduled", bg: "#EAF8EF", fg: "#137A35", border: "#1F9D55" },
  redeemed: { text: "Redeemed", bg: "var(--ink-100)", fg: "var(--ink-600)", border: "var(--ink-300)" },
  blocked: { text: "Blocked", bg: "#FCE2DA", fg: "#8C2410", border: "#D6361A" },
};

export function RedeemableList({ data, paid = true, busyId, onAct }) {
  const redeemables = data?.redeemables || [];
  if (!redeemables.length) {
    return <div style={{ padding: 20, color: "var(--ink-500)", fontSize: 13 }}>Nothing to redeem on this code.</div>;
  }

  const order = ["schedulable", "stock", "gate"];
  const groups = order
    .map((key) => ({ key, items: redeemables.filter((r) => r.group === key) }))
    .filter((g) => g.items.length);
  // Any redeemables with an unknown group fall into a final catch-all.
  const known = new Set(order);
  const other = redeemables.filter((r) => !known.has(r.group));
  if (other.length) groups.push({ key: "other", items: other });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {groups.map((group) => (
        <div key={group.key}>
          {GROUP_TITLES[group.key] && (
            <div className="eyebrow" style={{ marginBottom: 8 }}>{GROUP_TITLES[group.key]}</div>
          )}
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
            {group.items.map((r) => {
              const badge = STATE_BADGE[r.state];
              const actionable = r.action?.type && r.action.type !== "none";
              const busy = busyId === r.id;
              const positive = r.state === "scheduled" || r.state === "ready";
              return (
                <li
                  key={r.id}
                  style={{
                    display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12,
                    padding: "12px 14px", borderRadius: 12,
                    background: r.state === "scheduled" ? "var(--color-success-soft, #EAF8EF)" : "var(--ink-50)",
                    border: `1.5px solid ${r.state === "scheduled" ? "#1F9D55" : "var(--ink-200)"}`,
                    opacity: r.state === "redeemed" ? 0.7 : 1,
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 14 }}>{r.label}</div>
                    <div style={{ fontSize: 12, color: "var(--ink-600)" }}>{r.sublabel}</div>
                  </div>
                  {actionable ? (
                    <button
                      type="button"
                      className="a-btn a-btn--primary a-btn--sm"
                      disabled={!paid || busy}
                      onClick={() => onAct?.(r)}
                      style={{ flexShrink: 0 }}
                      title={!paid ? "Pack must be paid before redeeming" : ""}
                    >
                      {busy
                        ? "…"
                        : r.group === "stock" && r.action.type === "admit"
                          ? "Redeem"
                          : (ACTION_LABEL[r.action.type] || "Redeem")}
                    </button>
                  ) : badge ? (
                    <span style={{ flexShrink: 0, padding: "4px 10px", borderRadius: 999, fontSize: 12, fontWeight: 800, background: badge.bg, color: badge.fg, border: `1.5px solid ${badge.border}` }}>
                      {badge.text}
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}
