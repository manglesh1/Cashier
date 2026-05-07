import React, { useState, useEffect, useMemo } from "react";
import { toast } from "sonner";
import { Icon } from "./Icon";
import { useLazySearchWaiversQuery } from "../../features/bookings/bookingApi";

const formatDob = (value) => {
  if (!value) return "DOB not on file";
  const raw = String(value).split("T")[0];
  const parts = raw.split("-");
  if (parts.length === 3) {
    const [year, month, day] = parts;
    return `DOB ${month}/${day}/${year}`;
  }
  return `DOB ${raw}`;
};

export function CartWaiverModal({
  open,
  needed,
  attached = [],
  onChange,
  onClose,
}) {
  const [query, setQuery] = useState("");
  const [trigger, { data, isFetching }] = useLazySearchWaiversQuery();
  const [showLink, setShowLink] = useState(false);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setShowLink(false);
  }, [open]);

  const handleClose = () => {
    setQuery("");
    setShowLink(false);
    onClose?.();
  };

  useEffect(() => {
    if (!open) return undefined;
    const t = setTimeout(() => {
      if (query.trim().length >= 2) {
        trigger({ search: query.trim(), limit: 24, contactOnly: true });
      }
    }, 250);
    return () => clearTimeout(t);
  }, [query, trigger, open]);

  const waiverGroups = useMemo(() => {
    if (query.trim().length < 2) return [];
    const rows = data?.data || [];
    const groups = new Map();
    for (const row of rows) {
      const signatureId = Number(row.signatureId ?? row.id);
      if (!signatureId) continue;
      const group = groups.get(signatureId) || {
        signatureId,
        signer: null,
        minors: [],
      };

      if (row.holderType === "adult" || !group.signer) {
        group.signer = {
          ...row,
          holderType: "adult",
          isMinor: false,
          name: row.signedBy || row.signedByName || row.name || "Guest",
        };
      }

      const minors = Array.isArray(row.minors) ? row.minors : [];
      minors.forEach((minor, index) => {
        if (group.minors.some((m) => Number(m.minorIndex) === index)) return;
        group.minors.push({
          ...minor,
          holderType: "minor",
          isMinor: true,
          minorIndex: index,
          name: minor?.name || minor?.fullName || `Minor ${index + 1}`,
          dateOfBirth: minor?.dateOfBirth || minor?.dob || null,
        });
      });

      groups.set(signatureId, group);
    }
    return Array.from(groups.values()).filter((group) => group.signer);
  }, [data, query]);

  const attachedIds = useMemo(
    () => new Set(attached.map((a) => Number(a.signatureId))),
    [attached]
  );

  const totalCovered = useMemo(
    () => attached.reduce((n, a) => n + Math.max(1, Number(a.coverage) || 1), 0),
    [attached]
  );

  const personCards = useMemo(
    () =>
      waiverGroups.flatMap((group) => {
        const sig = group.signer;
        const signatureId = Number(group.signatureId);
        const contact = sig.guest?.guestEmail || sig.email || sig.guest?.guestPhone || sig.phone || "-";
        const minorCount = group.minors.length;
        const coverage = 1 + (sig.includesMinors === false ? 0 : minorCount);
        const expired = sig.expiredAt && new Date(sig.expiredAt) < new Date();

        const signerCard = {
          key: `${signatureId}:signer`,
          signatureId,
          name: sig.name,
          role: "Waiver signer / customer",
          detail: contact,
          dateOfBirth: sig.dateOfBirth || sig.guestDateOfBirth || sig.dob || null,
          badge: "Customer",
          coverage,
          expired,
          pickPayload: sig,
        };

        const minorCards = group.minors.map((minor) => ({
          key: `${signatureId}:minor:${minor.minorIndex}`,
          signatureId,
          name: minor.name,
          role: "Signee / minor",
          detail: `Signed by ${sig.name}`,
          dateOfBirth: minor.dateOfBirth || minor.dob || null,
          badge: "Minor",
          coverage,
          expired,
          pickPayload: {
            ...sig,
            holderType: "minor",
            signerName: sig.name,
            selectedHolderName: minor.name,
            name: minor.name,
            minorIndex: minor.minorIndex,
          },
        }));

        return [signerCard, ...minorCards];
      }),
    [waiverGroups]
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

    const signerName =
      sig.signerName ||
      sig.signedBy ||
      sig.signedByName ||
      sig.guest?.guestName ||
      sig.name ||
      "Guest";
    const selectedHolderName = sig.selectedHolderName || sig.name || signerName;
    const contactEmail = sig.guest?.guestEmail || sig.email || "";
    const contactPhone = sig.guest?.guestPhone || sig.phone || "";
    const contact = contactEmail || contactPhone || "";
    const minorList = Array.isArray(sig.minors) ? sig.minors : [];
    const selectedMinorIndex =
      sig.holderType === "minor" && Number.isInteger(Number(sig.minorIndex))
        ? Number(sig.minorIndex)
        : null;
    const minorCount = sig.includesMinors === false ? 0 : minorList.length;
    const coverage = 1 + minorCount;

    onChange([
      ...attached,
      {
        signatureId,
        name: signerName,
        selectedHolderName,
        contact,
        contactEmail,
        contactPhone,
        minorCount,
        coverage,
        preferredAssignmentKey:
          selectedMinorIndex !== null
            ? `${signatureId}:minor:${selectedMinorIndex}`
            : `${signatureId}:signer`,
        minors: minorList.slice(0, minorCount),
      },
    ]);

    toast.success(
      `Added: ${signerName}${selectedHolderName !== signerName ? ` for ${selectedHolderName}` : ""}${coverage > 1 ? ` - covers ${coverage} guests` : ""}`
    );
  };

  const waiverPageUrl = (() => {
    const base = import.meta.env.VITE_BOOKING_PORTAL_URL || "/waivers";
    return `${base}/waivers`;
  })();

  if (!open) return null;

  return (
    <div
      onClick={handleClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 100,
        background: "rgba(0,0,0,0.4)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 640,
          maxHeight: "85vh",
          background: "white",
          borderRadius: 18,
          border: "2px solid var(--ink-800)",
          boxShadow: "0 8px 0 var(--ink-800)",
          padding: 22,
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
          <h2 style={{ margin: 0, fontFamily: "var(--font-display)", fontSize: 20, fontWeight: 800, color: "var(--ink-900)" }}>
            {attached.length === 0 ? "Add customer" : "Add waiver coverage"}
          </h2>
          <button type="button" onClick={handleClose} style={{ all: "unset", cursor: "pointer", color: "var(--ink-500)", padding: 4 }} title="Close">
            <Icon name="x" size={18} />
          </button>
        </div>
        <div style={{ fontSize: 12, color: "var(--ink-500)", marginBottom: 14 }}>
          {totalCovered} of {needed} guest{needed === 1 ? "" : "s"} covered. Search signed waivers with an email or phone.
        </div>

        <div style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "10px 12px",
          background: "var(--ink-25)",
          border: "1.5px solid var(--ink-200)",
          borderRadius: 12,
          marginBottom: 12,
        }}>
          <Icon name="search" size={16} style={{ color: "var(--ink-500)" }} />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Name, email or phone..."
            style={{ all: "unset", flex: 1, fontSize: 14, fontWeight: 600 }}
          />
        </div>

        <div style={{ overflowY: "auto", flex: 1, marginBottom: 12 }}>
          {query.trim().length < 2 ? (
            <div style={{ padding: 24, textAlign: "center", fontSize: 13, color: "var(--ink-500)" }}>
              Type at least 2 characters to search.
            </div>
          ) : isFetching ? (
            <div style={{ padding: 24, textAlign: "center", fontSize: 13, color: "var(--ink-500)" }}>
              Searching...
            </div>
          ) : personCards.length === 0 ? (
            <div style={{ padding: 24, textAlign: "center", fontSize: 13, color: "var(--ink-500)" }}>
              No matching customers with signed waivers and contact details.
            </div>
          ) : (
            <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 8 }}>
              {personCards.map((person) => {
                const isAttached = attachedIds.has(person.signatureId);
                return (
                  <li key={person.key}>
                    <button
                      type="button"
                      onClick={() => !isAttached && !person.expired && handlePick(person.pickPayload)}
                      disabled={isAttached || person.expired}
                      style={{
                        all: "unset",
                        cursor: (isAttached || person.expired) ? "not-allowed" : "pointer",
                        display: "flex",
                        alignItems: "center",
                        gap: 12,
                        width: "100%",
                        boxSizing: "border-box",
                        padding: "12px 14px",
                        background: isAttached ? "#EAF8EF" : "white",
                        border: `1.5px solid ${isAttached ? "#8AD5A3" : "var(--ink-200)"}`,
                        borderRadius: 12,
                        opacity: person.expired ? 0.5 : 1,
                      }}
                    >
                      <Icon name={isAttached ? "check-circle-2" : "user-round"} size={17} style={{ color: isAttached ? "#137A35" : "var(--ink-600)", flexShrink: 0 }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                          <span style={{ fontSize: 14, fontWeight: 800, color: "var(--ink-900)" }}>
                            {person.name}
                          </span>
                          <span style={{ fontSize: 11, fontWeight: 800, color: "var(--ink-500)" }}>
                            {person.role}
                          </span>
                        </div>
                        <div style={{ fontSize: 12, color: "var(--ink-500)", marginTop: 2 }}>
                          {formatDob(person.dateOfBirth)} - {person.detail}
                          {person.expired ? " - expired" : ""}
                        </div>
                      </div>
                      <span style={{
                        fontSize: 11,
                        fontWeight: 800,
                        color: isAttached ? "#137A35" : "var(--ink-600)",
                        padding: "2px 8px",
                        background: isAttached ? "white" : "var(--ink-25)",
                        border: "1.5px solid var(--ink-200)",
                        borderRadius: 999,
                        flexShrink: 0,
                      }}>
                        {isAttached ? "Added" : person.badge}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div style={{
          padding: "10px 12px",
          background: "var(--ink-25)",
          border: "1.5px solid var(--ink-200)",
          borderRadius: 12,
        }}>
          {!showLink ? (
            <button type="button" onClick={() => setShowLink(true)} className="a-btn a-btn--ghost a-btn--sm" style={{ width: "100%", justifyContent: "center" }}>
              <Icon name="external-link" size={14} /> Guest has not signed? Show link
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
                    flex: 1,
                    fontSize: 12,
                    padding: "8px 10px",
                    background: "white",
                    border: "1.5px solid var(--ink-200)",
                    borderRadius: 8,
                    fontFamily: "var(--font-mono)",
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

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
          <button type="button" onClick={handleClose} className="a-btn a-btn--primary" disabled={totalCovered < needed}>
            {totalCovered >= needed ? "Done" : `${needed - totalCovered} more needed`}
          </button>
        </div>
      </div>
    </div>
  );
}
