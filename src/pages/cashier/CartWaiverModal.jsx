import React, { useState, useEffect, useMemo } from "react";
import { toast } from "sonner";
import { Icon } from "./Icon";
import { useLazySearchWaiversQuery } from "../../features/bookings/bookingApi";

// Add-guest modal for the POS sell flow — mirrors CheckIn's
// "Add from waiver". Cashier searches by name/phone/email, picks a
// guest, and the guest's signed waiver attaches to the cart. Each
// guest brings their own coverage: one waiver covers the signer plus
// any minors listed on it, so attaching a parent with two kids fills
// three waiver-required slots in one click. createBooking ships the
// signature IDs as waiverSignatureIds; the backend recomputes coverage
// from trusted data and rejects 400 if short.
export function CartWaiverModal({
  open,
  needed,         // total waivers required for current cart (= total spots)
  attached = [],  // [{ signatureId, name, contact, coverage, minorCount, contactEmail, contactPhone }]
  onChange,       // (next) => void  (full replacement of attached array)
  onClose,
}) {
  const [query, setQuery] = useState("");
  const [trigger, { data, isFetching }] = useLazySearchWaiversQuery();
  const [showLink, setShowLink] = useState(false);

  // Debounced search — same UX as CheckIn's WaiverLookupModal.
  useEffect(() => {
    if (!open) return undefined;
    const t = setTimeout(() => {
      if (query.trim().length >= 2) trigger({ search: query.trim(), limit: 12 });
    }, 250);
    return () => clearTimeout(t);
  }, [query, trigger, open]);

  // Dedupe by signatureId — search can echo the same waiver as separate
  // adult/minor rows, but we only want one chip per signature.
  const results = useMemo(() => {
    const rows = data?.data || [];
    const bySig = new Map();
    for (const row of rows) {
      const sid = row.signatureId ?? row.id;
      if (!sid) continue;
      const prev = bySig.get(sid);
      if (!prev || row.holderType === "adult") bySig.set(sid, row);
    }
    return Array.from(bySig.values());
  }, [data]);

  const attachedIds = useMemo(
    () => new Set(attached.map((a) => Number(a.signatureId))),
    [attached]
  );

  const totalCovered = useMemo(
    () => attached.reduce((n, a) => n + Math.max(1, Number(a.coverage) || 1), 0),
    [attached]
  );

  const handlePick = (sig) => {
    const signatureId = Number(sig.signatureId ?? sig.id);
    if (!signatureId) return;
    if (attachedIds.has(signatureId)) {
      toast.info("Already attached");
      return;
    }
    if (totalCovered >= needed) {
      toast.info(`Cart only needs ${needed} guest${needed === 1 ? "" : "s"}`);
      return;
    }
    const name =
      sig.guest?.guestName ||
      sig.name ||
      sig.signedByName ||
      sig.signedBy ||
      "Guest";
    const contactEmail = sig.guest?.guestEmail || sig.email || "";
    const contactPhone = sig.guest?.guestPhone || sig.phone || "";
    const contact = contactEmail || contactPhone || "";
    const minorList = Array.isArray(sig.minors) ? sig.minors : [];
    const minorCount = sig.includesMinors === false ? 0 : minorList.length;
    // One waiver covers the signer + any minors on it.
    const coverage = 1 + minorCount;
    onChange([
      ...attached,
      {
        signatureId,
        name,
        contact,
        contactEmail,
        contactPhone,
        minorCount,
        coverage,
        // Preserve minor names so the per-ticket row in the cart can
        // show "Liam Jr" etc. instead of a generic "minor 1" label.
        minors: minorList.slice(0, minorCount),
      },
    ]);
    toast.success(`Added: ${name}${coverage > 1 ? ` · covers ${coverage} guests` : ""}`);
  };

  const handleRemove = (signatureId) => {
    onChange(attached.filter((a) => Number(a.signatureId) !== Number(signatureId)));
  };

  const waiverPageUrl = (() => {
    const base = import.meta.env.VITE_BOOKING_PORTAL_URL || "/waivers";
    return `${base}/waivers`;
  })();

  if (!open) return null;

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 100, background: "rgba(0,0,0,0.4)",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 600, maxHeight: "85vh",
          background: "white", borderRadius: 18,
          border: "2px solid var(--ink-800)", boxShadow: "0 8px 0 var(--ink-800)",
          padding: 22, display: "flex", flexDirection: "column",
        }}
      >
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
          <h2 style={{ margin: 0, fontFamily: "var(--font-display)", fontSize: 20, fontWeight: 800, color: "var(--ink-900)" }}>
            Add guest
          </h2>
          <button
            type="button"
            onClick={onClose}
            style={{ all: "unset", cursor: "pointer", color: "var(--ink-500)", padding: 4 }}
            title="Close"
          >
            <Icon name="x" size={18} />
          </button>
        </div>
        <div style={{ fontSize: 12, color: "var(--ink-500)", marginBottom: 14 }}>
          {totalCovered} of {needed} guest{needed === 1 ? "" : "s"} covered. Search a name, email or phone.
        </div>

        {/* Already-attached chips */}
        {attached.length > 0 && (
          <div style={{
            display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12,
            padding: 10, background: "#EAF8EF", border: "1.5px solid #8AD5A3", borderRadius: 12,
          }}>
            {attached.map((a) => (
              <div
                key={a.signatureId}
                style={{
                  display: "inline-flex", alignItems: "center", gap: 6,
                  padding: "4px 4px 4px 10px", background: "white",
                  border: "1.5px solid var(--ink-200)", borderRadius: 999,
                  fontSize: 12, fontWeight: 700,
                }}
              >
                <Icon name="check-circle-2" size={12} style={{ color: "#137A35" }} />
                <span>{a.name}</span>
                {(a.coverage || 1) > 1 && (
                  <span style={{ color: "var(--ink-500)", fontWeight: 500 }}>
                    covers {a.coverage}
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => handleRemove(a.signatureId)}
                  style={{
                    all: "unset", cursor: "pointer", padding: "2px 6px",
                    color: "var(--ink-500)",
                  }}
                  title="Remove"
                >
                  <Icon name="x" size={12} />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Search input */}
        <div style={{
          display: "flex", alignItems: "center", gap: 8,
          padding: "10px 12px", background: "var(--ink-25)",
          border: "1.5px solid var(--ink-200)", borderRadius: 12, marginBottom: 12,
        }}>
          <Icon name="search" size={16} style={{ color: "var(--ink-500)" }} />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Name, email or phone…"
            style={{ all: "unset", flex: 1, fontSize: 14, fontWeight: 600 }}
          />
        </div>

        {/* Results */}
        <div style={{ overflowY: "auto", flex: 1, marginBottom: 12 }}>
          {query.trim().length < 2 ? (
            <div style={{ padding: 24, textAlign: "center", fontSize: 13, color: "var(--ink-500)" }}>
              Type at least 2 characters to search.
            </div>
          ) : isFetching ? (
            <div style={{ padding: 24, textAlign: "center", fontSize: 13, color: "var(--ink-500)" }}>
              Searching…
            </div>
          ) : results.length === 0 ? (
            <div style={{ padding: 24, textAlign: "center", fontSize: 13, color: "var(--ink-500)" }}>
              No matching waivers. Use the link below so the guest can sign.
            </div>
          ) : (
            <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 6 }}>
              {results.map((sig) => {
                const signatureId = Number(sig.signatureId ?? sig.id);
                const isAttached = attachedIds.has(signatureId);
                const displayName =
                  sig.guest?.guestName || sig.name || sig.signedByName || sig.signedBy || "Guest";
                const contact =
                  sig.guest?.guestEmail || sig.email || sig.guest?.guestPhone || sig.phone || "—";
                const minorCount = Array.isArray(sig.minors) ? sig.minors.length : Number(sig.minorCount || 0);
                const coverage = 1 + (sig.includesMinors === false ? 0 : minorCount);
                const expired = sig.expiredAt && new Date(sig.expiredAt) < new Date();
                return (
                  <li key={signatureId}>
                    <button
                      type="button"
                      onClick={() => !isAttached && !expired && handlePick(sig)}
                      disabled={isAttached || expired}
                      style={{
                        all: "unset", cursor: (isAttached || expired) ? "not-allowed" : "pointer",
                        display: "flex", alignItems: "center", gap: 10, width: "100%",
                        padding: "10px 12px",
                        background: isAttached ? "#EAF8EF" : "white",
                        border: `1.5px solid ${isAttached ? "#8AD5A3" : "var(--ink-200)"}`,
                        borderRadius: 10, opacity: expired ? 0.5 : 1,
                      }}
                    >
                      <Icon
                        name={isAttached ? "check-circle-2" : "user-round"}
                        size={16}
                        style={{ color: isAttached ? "#137A35" : "var(--ink-600)" }}
                      />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 14, fontWeight: 700, color: "var(--ink-900)" }}>
                          {displayName}
                        </div>
                        <div style={{ fontSize: 12, color: "var(--ink-500)", marginTop: 1 }}>
                          {contact}
                          {coverage > 1 ? ` · covers ${coverage} guests` : ""}
                          {expired ? " · expired" : ""}
                        </div>
                      </div>
                      {isAttached ? (
                        <span style={{ fontSize: 11, fontWeight: 700, color: "#137A35" }}>
                          Added
                        </span>
                      ) : (
                        <span style={{
                          fontSize: 11, fontWeight: 700, color: "var(--ink-600)",
                          padding: "2px 8px", background: "var(--ink-25)",
                          border: "1.5px solid var(--ink-200)", borderRadius: 999,
                        }}>
                          {coverage > 1 ? `+${coverage} spots` : "+1 spot"}
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Send-link fallback */}
        <div style={{
          padding: "10px 12px", background: "var(--ink-25)",
          border: "1.5px solid var(--ink-200)", borderRadius: 12,
        }}>
          {!showLink ? (
            <button
              type="button"
              onClick={() => setShowLink(true)}
              className="a-btn a-btn--ghost a-btn--sm"
              style={{ width: "100%", justifyContent: "center" }}
            >
              <Icon name="external-link" size={14} /> Guest hasn't signed? Show link
            </button>
          ) : (
            <div>
              <div style={{ fontSize: 12, color: "var(--ink-700)", fontWeight: 600, marginBottom: 6 }}>
                Share this link with the guest. Once they sign, search by their name above to attach.
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                <input
                  readOnly
                  value={waiverPageUrl}
                  style={{
                    flex: 1, fontSize: 12, padding: "8px 10px",
                    background: "white", border: "1.5px solid var(--ink-200)",
                    borderRadius: 8, fontFamily: "var(--font-mono)",
                  }}
                  onFocus={(e) => e.target.select()}
                />
                <button
                  type="button"
                  className="a-btn a-btn--primary a-btn--sm"
                  onClick={() => {
                    navigator.clipboard?.writeText(waiverPageUrl);
                    toast.success("Link copied");
                  }}
                >
                  <Icon name="copy" size={14} /> Copy
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
          <button
            type="button"
            onClick={onClose}
            className="a-btn a-btn--primary"
            disabled={totalCovered < needed}
          >
            {totalCovered >= needed
              ? "Done"
              : `${needed - totalCovered} more needed`}
          </button>
        </div>
      </div>
    </div>
  );
}
