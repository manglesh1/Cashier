import React, { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  useGetSignedWaiverQuery,
  useGetWaiverDefinitionQuery,
  useLazySearchWaiversQuery,
  useSearchWaiversQuery,
} from "../../features/bookings/bookingApi";
import { LookupSearch } from "../../components/LookupSearch";
import {
  lookupItemKey,
  waiverLabelOf,
  waiverSecondaryOf,
  waiverSuggestionItems,
  WaiverLookupOption,
} from "../../components/cashierLookupRenderers";
import { Icon } from "./Icon";
import { StatusPill } from "./StatusPill";

const portalBaseUrl = (() => {
  const localPortal =
    typeof window !== "undefined" && ["localhost", "127.0.0.1"].includes(window.location.hostname)
      ? "http://localhost:5174"
      : "";
  const base = import.meta.env.VITE_BOOKING_PORTAL_URL || localPortal;
  return base.replace(/\/$/, "");
})();

const formatDate = (value, fallback = "Not recorded") => {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  return date.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
};

const formatAge = (value) => {
  if (!value) return "Unknown";
  const dob = new Date(value);
  if (Number.isNaN(dob.getTime())) return "Unknown";
  const now = new Date();
  let years = now.getFullYear() - dob.getFullYear();
  const monthDiff = now.getMonth() - dob.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < dob.getDate())) years -= 1;
  return years >= 0 ? `${years} yrs` : "Unknown";
};

const dayDistance = (value) => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const target = new Date(date);
  const today = new Date();
  target.setHours(0, 0, 0, 0);
  today.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
};

const waiverStatus = (row) => {
  const days = dayDistance(row?.expiredAt);
  const expired = row?.waiverStatus === "expired" || (days !== null && days < 0);
  if (expired) return { tone: "danger", label: days !== null ? `Expired ${Math.abs(days)} days ago` : "Expired" };
  if (days === null) return { tone: "success", label: "Active" };
  if (days <= 14) return { tone: "warning", label: `Expires in ${days} days` };
  return { tone: "success", label: `Active until ${formatDate(row.expiredAt)}` };
};

const documentHtml = (detail) =>
  detail?.waiverVersionSnapshot?.content ||
  detail?.waiver?.content ||
  "";

// Waiver bodies are stored as HTML with [CHECKBOX]…[/CHECKBOX] markers for
// the agreed clauses (same format the admin renders). Turn each marker into
// a green "✓ …" agreed line; the rest is trusted template HTML (<p> etc.).
const cleanWaiverHtml = (html = "") =>
  String(html || "").replace(
    /\[CHECKBOX\]([\s\S]*?)\[\/CHECKBOX\]/gi,
    '<p class="waiver-agreed"><span class="waiver-tick">✓</span><span>$1</span></p>'
  );

const isDataImage = (value) => typeof value === "string" && value.startsWith("data:image");

const publicAgreementUrl = (waiver) => {
  const raw = waiver?.publicAgreementUrl || waiver?.publicAgreementPath || "";
  if (/^https?:\/\//i.test(raw)) return raw;
  if (raw) return `${portalBaseUrl}${raw.startsWith("/") ? raw : `/${raw}`}`;
  return "";
};

function InfoCard({ label, value }) {
  return (
    <div style={{ background: "#fff", border: "1.5px solid var(--ink-200)", borderRadius: 14, padding: 14, minWidth: 0 }}>
      <div className="eyebrow">{label}</div>
      <div style={{ marginTop: 8, fontWeight: 800, color: "var(--ink-900)", overflow: "hidden", textOverflow: "ellipsis" }}>
        {value}
      </div>
    </div>
  );
}

// Compact label/value pair (admin "Field" look) for grouped detail grids.
function Field({ label, value }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--ink-500)" }}>
        {label}
      </div>
      <div style={{ marginTop: 3, fontWeight: 700, color: "var(--ink-900)", wordBreak: "break-word" }}>
        {value || "—"}
      </div>
    </div>
  );
}

function DetailCard({ title, count, children }) {
  return (
    <div style={{ background: "#fff", border: "1.5px solid var(--ink-200)", borderRadius: 14, padding: "18px", marginBottom: 20 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 14 }}>
        <h2 style={{ margin: 0, fontFamily: "var(--font-display)", fontSize: 18, fontWeight: 800 }}>{title}</h2>
        {count != null && <span style={{ fontSize: 12, color: "var(--ink-500)", fontWeight: 700 }}>{count}</span>}
      </div>
      {children}
    </div>
  );
}

function EmptyState({ icon = "shield-question", title, body }) {
  return (
    <div style={{
      minHeight: 260,
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      textAlign: "center",
      color: "var(--ink-500)",
      padding: 24,
    }}>
      <Icon name={icon} size={34} stroke={1.6} style={{ color: "var(--ink-400)", marginBottom: 12 }} />
      <div style={{ fontFamily: "var(--font-display)", fontSize: 20, fontWeight: 800, color: "var(--ink-800)" }}>
        {title}
      </div>
      <div style={{ fontSize: 13, maxWidth: 360, marginTop: 6, lineHeight: 1.5 }}>{body}</div>
    </div>
  );
}

function HolderRow({ row, active, onClick }) {
  const status = waiverStatus(row);
  const contact = [row.email, row.phone].filter(Boolean).join(" - ") || "No contact on file";
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        all: "unset",
        cursor: "pointer",
        display: "grid",
        gridTemplateColumns: "32px minmax(0, 1fr)",
        gap: 10,
        boxSizing: "border-box",
        width: "100%",
        padding: "12px 12px",
        background: active ? "#FFF6EF" : "#fff",
        border: `1.5px solid ${active ? "var(--aero-orange-500)" : "var(--ink-200)"}`,
        borderRadius: 12,
        boxShadow: active ? "0 3px 0 var(--ink-800)" : "none",
      }}
    >
      <div style={{
        width: 32,
        height: 32,
        borderRadius: 9,
        background: status.tone === "danger" ? "var(--color-danger-soft)" : "var(--ink-50)",
        color: status.tone === "danger" ? "var(--color-danger)" : "var(--ink-600)",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
      }}>
        <Icon name={row.isMinor ? "user-round" : "shield-check"} size={17} />
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
          <span style={{ fontWeight: 800, color: "var(--ink-900)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {row.name || row.signedBy || "Guest"}
          </span>
          {row.isMinor && (
            <span style={{ flexShrink: 0, fontSize: 9, fontWeight: 800, textTransform: "uppercase", letterSpacing: ".04em", color: "var(--aero-orange-700)", background: "var(--aero-orange-50)", border: "1px solid var(--aero-orange-100)", borderRadius: 999, padding: "1px 6px" }}>
              Minor
            </span>
          )}
        </div>
        {/* "Signed by" — meaningful for minors (guardian) or when it differs. */}
        {row.signedBy && row.signedBy !== row.name && (
          <div style={{ fontSize: 11, color: "var(--ink-500)", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            Signed by {row.signedBy}
          </div>
        )}
        {/* Admin-table columns, compact for a touch list row. */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6, marginTop: 8 }}>
          <MiniCol label="DOB" value={formatDate(row.dateOfBirth, "—")} />
          <MiniCol label="Signed" value={formatDate(row.signedAt, "—")} />
          <MiniCol label="Expires" value={formatDate(row.expiredAt, "—")} />
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginTop: 8 }}>
          <span style={{ fontSize: 11, color: "var(--ink-600)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {row.waiverName || "Waiver"}
          </span>
          <StatusPill tone={status.tone}>{status.tone === "danger" ? "Expired" : "Active"}</StatusPill>
        </div>
      </div>
    </button>
  );
}

function MiniCol({ label, value }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: ".05em", textTransform: "uppercase", color: "var(--ink-400)" }}>
        {label}
      </div>
      <div style={{ fontSize: 11.5, fontWeight: 700, color: "var(--ink-800)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {value}
      </div>
    </div>
  );
}

export function WaiverDetail() {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [selectedRow, setSelectedRow] = useState(null);
  const [lookupWaivers] = useLazySearchWaiversQuery();

  useEffect(() => {
    const id = setTimeout(() => setDebouncedQuery(query.trim()), 250);
    return () => clearTimeout(id);
  }, [query]);

  const {
    data: holderData,
    isFetching: holdersFetching,
    refetch: refetchHolders,
  } = useSearchWaiversQuery({
    search: debouncedQuery,
    limit: 80,
    status,
    sortBy: status === "expired" ? "expiredAt" : "signedAt",
    sortDir: "DESC",
  });

  const holders = holderData?.data || [];
  const total = holderData?.total ?? holders.length;
  const selectedSignatureId = Number(selectedRow?.signatureId || selectedRow?.id || 0);
  const {
    data: signedData,
    isFetching: signedFetching,
    refetch: refetchSigned,
  } = useGetSignedWaiverQuery(selectedSignatureId, { skip: !selectedSignatureId });
  const detail = signedData?.data || null;
  const selectedWaiverId = Number(selectedRow?.waiverId || 0);
  const {
    data: waiverDefinition,
    refetch: refetchWaiverDefinition,
  } = useGetWaiverDefinitionQuery(selectedWaiverId, { skip: !selectedWaiverId });
  const signingUrl = publicAgreementUrl(waiverDefinition?.waiver);

  const runWaiverLookup = useCallback(
    (search, { limit } = {}) =>
      lookupWaivers({
        search,
        limit: limit || 12,
        status,
        sortBy: status === "expired" ? "expiredAt" : "signedAt",
        sortDir: "DESC",
      }).unwrap(),
    [lookupWaivers, status]
  );

  const selectLookupWaiver = useCallback((row) => {
    const label = waiverLabelOf(row);
    setSelectedRow(row);
    setQuery(label);
    setDebouncedQuery(label);
  }, []);

  useEffect(() => {
    if (!holders.length) {
      setSelectedRow(null);
      return;
    }
    const stillVisible = holders.some((row) => String(row.id) === String(selectedRow?.id));
    if (!selectedRow || !stillVisible) setSelectedRow(holders[0]);
  }, [holders, selectedRow]);

  const selectedStatus = waiverStatus(selectedRow);
  const coveredGuests = useMemo(() => {
    if (!detail) return [];
    const rows = [];
    rows.push({
      key: "signer",
      name: detail.guest?.name || detail.signedByName || "Signer",
      role: detail.includesMinors ? "Signer / guardian" : "Signer",
      dob: detail.guestDateOfBirth,
    });
    (Array.isArray(detail.minors) ? detail.minors : []).forEach((minor, index) => {
      rows.push({
        key: `minor-${index}`,
        name: minor.name || minor.fullName || `Minor ${index + 1}`,
        role: "Minor",
        dob: minor.dateOfBirth || minor.dob || null,
      });
    });
    return rows;
  }, [detail]);

  const copyPortalLink = async () => {
    try {
      if (!signingUrl) {
        toast.error("Select a waiver with a public signing link first");
        return;
      }
      await navigator.clipboard?.writeText(signingUrl);
      toast.success("Waiver link copied");
    } catch {
      toast.error("Could not copy link");
    }
  };

  const refresh = () => {
    refetchHolders();
    if (selectedSignatureId) refetchSigned();
    if (selectedWaiverId) refetchWaiverDefinition();
  };

  return (
    <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: "flex", overflow: "hidden" }}>
      <style>{`
        .waiver-doc { font-size: 14px; line-height: 1.6; color: var(--ink-700); }
        .waiver-doc p { margin: 0 0 10px; }
        .waiver-doc p:last-child { margin-bottom: 0; }
        .waiver-doc ul, .waiver-doc ol { margin: 0 0 10px; padding-left: 20px; }
        .waiver-doc strong, .waiver-doc b { color: var(--ink-900); }
        .waiver-doc .waiver-agreed {
          display: flex; gap: 8px; align-items: flex-start;
          background: #EAF8EF; border: 1px solid #BFE7CC; border-radius: 8px;
          padding: 8px 10px; margin: 0 0 8px; color: #137A35; font-weight: 600;
        }
        .waiver-doc .waiver-tick { font-weight: 900; flex-shrink: 0; }
      `}</style>
      <section style={{
        width: "clamp(330px, 28vw, 430px)",
        flex: "0 0 clamp(330px, 28vw, 430px)",
        minHeight: 0,
        borderRight: "1px solid var(--ink-100)",
        background: "var(--ink-25)",
        padding: "18px 18px",
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}>
        <div>
          <div className="eyebrow">Waiver lookup</div>
          <h1 style={{ margin: "4px 0 4px", fontFamily: "var(--font-display)", fontSize: 26, fontWeight: 800 }}>
            Find signed waivers
          </h1>
          <div style={{ color: "var(--ink-500)", fontSize: 13 }}>
            Search live waiver holders by guest, guardian, email, or phone.
          </div>
        </div>

        <LookupSearch
          value={query}
          onInputChange={setQuery}
          onSearch={runWaiverLookup}
          onSelect={selectLookupWaiver}
          minChars={2}
          limit={12}
          placeholder="Search by customer, guardian, email, or phone"
          minCharsText="Type at least 2 characters to find signed waivers."
          emptyText="No signed waivers match this search."
          loadingText="Searching waivers..."
          getItems={waiverSuggestionItems}
          getKey={lookupItemKey}
          getLabel={waiverLabelOf}
          getSecondary={waiverSecondaryOf}
          renderItem={(item) => <WaiverLookupOption item={item} />}
          className="cashier-waiver-lookup"
        />

        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 6 }}>
          {[
            ["all", "All"],
            ["active", "Active"],
            ["expired", "Expired"],
          ].map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setStatus(key)}
              className={status === key ? "a-btn a-btn--primary a-btn--sm" : "a-btn a-btn--ghost a-btn--sm"}
              style={{ justifyContent: "center" }}
            >
              {label}
            </button>
          ))}
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 12, color: "var(--ink-500)" }}>
          <span>{holdersFetching ? "Refreshing..." : `${total} result${total === 1 ? "" : "s"}`}</span>
          <button type="button" onClick={refresh} className="a-btn a-btn--ghost a-btn--sm">
            <Icon name="refresh-cw" size={13} /> Refresh
          </button>
        </div>

        <div style={{ flex: 1, minHeight: 0, overflowY: "auto", overscrollBehavior: "contain", display: "flex", flexDirection: "column", gap: 8, paddingRight: 2 }}>
          {!holdersFetching && holders.length === 0 ? (
            <EmptyState
              icon="search-x"
              title="No waivers found"
              body="Try a different search, switch the status filter, or send the guest to the waiver portal."
            />
          ) : (
            holders.map((row) => (
              <HolderRow
                key={row.id}
                row={row}
                active={String(row.id) === String(selectedRow?.id)}
                onClick={() => setSelectedRow(row)}
              />
            ))
          )}
        </div>
      </section>

      <main style={{ flex: 1, minWidth: 0, minHeight: 0, overflowY: "auto", overscrollBehavior: "contain", padding: "24px 28px" }}>
        {!selectedRow ? (
          <EmptyState
            icon="shield-check"
            title="Select a waiver"
            body="Pick a signed waiver from the left to review status, covered guests, and the document."
          />
        ) : signedFetching && !detail ? (
          <EmptyState icon="loader-circle" title="Loading waiver" body="Fetching the signed document and holder details." />
        ) : (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, marginBottom: 18 }}>
              <div style={{ minWidth: 0 }}>
                <div className="eyebrow">Waivers</div>
                <h1 style={{
                  margin: "4px 0 6px",
                  fontFamily: "var(--font-display)",
                  fontSize: 34,
                  fontWeight: 800,
                  lineHeight: 1.05,
                  color: "var(--ink-900)",
                }}>
                  {selectedRow.name || selectedRow.signedBy || "Guest"}
                </h1>
                <div style={{ color: "var(--ink-600)", fontSize: 14 }}>
                  {selectedRow.waiverName || detail?.waiver?.name || "Waiver"} - signed by {detail?.signedByName || selectedRow.signedBy || "Unknown"}
                </div>
              </div>
              <StatusPill tone={selectedStatus.tone}>{selectedStatus.label}</StatusPill>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12, marginBottom: 22 }}>
              <InfoCard label="Status" value={selectedStatus.label} />
              <InfoCard label="Age" value={formatAge(selectedRow.dateOfBirth || detail?.guestDateOfBirth)} />
              <InfoCard label="Signer" value={detail?.signedByName || selectedRow.signedBy || "Unknown"} />
              <InfoCard label="Signed" value={formatDate(detail?.signedAt || selectedRow.signedAt)} />
              <InfoCard label="Expires" value={formatDate(detail?.expiredAt || selectedRow.expiredAt, "No expiry")} />
            </div>

            <DetailCard title="Holder details">
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 14 }}>
                <Field label="Name" value={detail?.guest?.name || selectedRow.name || detail?.signedByName} />
                <Field label="Email" value={detail?.guest?.email} />
                <Field label="Phone" value={detail?.guest?.phone} />
                <Field label="Date of birth" value={formatDate(detail?.guestDateOfBirth, "—")} />
                <Field label="Address" value={[detail?.guest?.address, detail?.guest?.postcode].filter(Boolean).join(", ")} />
                {detail?.waiver?.locationName && <Field label="Location" value={detail.waiver.locationName} />}
              </div>
            </DetailCard>

            <DetailCard title="Covered guests" count={`${coveredGuests.length} covered`}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 8 }}>
                {coveredGuests.map((person) => (
                  <div key={person.key} style={{ border: "1.5px solid var(--ink-100)", background: "var(--ink-25)", borderRadius: 12, padding: "10px 12px" }}>
                    <div style={{ fontWeight: 800, color: "var(--ink-900)" }}>{person.name}</div>
                    <div style={{ fontSize: 12, color: "var(--ink-500)", marginTop: 3 }}>
                      {person.role} - {formatAge(person.dob)}
                    </div>
                  </div>
                ))}
              </div>
            </DetailCard>

            {Array.isArray(detail?.formResponses) && detail.formResponses.length > 0 && (
              <DetailCard title="Additional responses">
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 14 }}>
                  {detail.formResponses.map((r) => (
                    <Field key={r.waiverFormResponseId} label={r.label} value={r.value} />
                  ))}
                </div>
              </DetailCard>
            )}

            <div style={{ background: "#fff", border: "1.5px solid var(--ink-200)", borderRadius: 14, padding: "18px", marginBottom: 20 }}>
              <h2 style={{ margin: "0 0 14px", fontFamily: "var(--font-display)", fontSize: 18, fontWeight: 800 }}>Document</h2>
              <div style={{
                background: "var(--ink-50)",
                border: "1.5px solid var(--ink-100)",
                borderRadius: 14,
                padding: "18px 20px",
              }}>
                <div style={{ fontWeight: 800, fontSize: 16, color: "var(--ink-800)", fontFamily: "var(--font-display)", marginBottom: 10 }}>
                  {detail?.waiver?.name || selectedRow.waiverName || "Waiver"}
                </div>
                {documentHtml(detail) ? (
                  <div
                    className="waiver-doc"
                    dangerouslySetInnerHTML={{ __html: cleanWaiverHtml(documentHtml(detail)) }}
                  />
                ) : (
                  <div style={{ fontSize: 14, color: "var(--ink-500)" }}>
                    No waiver document content was returned for this signature.
                  </div>
                )}
              </div>
            </div>

            {detail?.signatureImage && (
              <div style={{ background: "#fff", border: "1.5px solid var(--ink-200)", borderRadius: 14, padding: "18px" }}>
                <h2 style={{ margin: "0 0 14px", fontFamily: "var(--font-display)", fontSize: 18, fontWeight: 800 }}>Signature</h2>
                {isDataImage(detail.signatureImage) ? (
                  <img
                    src={detail.signatureImage}
                    alt="Guest signature"
                    style={{ maxWidth: 420, width: "100%", maxHeight: 120, objectFit: "contain", border: "1.5px solid var(--ink-100)", borderRadius: 12, background: "#fff" }}
                  />
                ) : (
                  // Typed signature — render the name in a script-like style,
                  // not as a (broken) image.
                  <div style={{
                    fontFamily: "Georgia, 'Times New Roman', serif",
                    fontStyle: "italic",
                    fontSize: 30,
                    color: "var(--ink-900)",
                    borderBottom: "2px solid var(--ink-300)",
                    paddingBottom: 6,
                    maxWidth: 420,
                  }}>
                    {detail.signatureImage}
                  </div>
                )}
                <div style={{ fontSize: 12, color: "var(--ink-500)", marginTop: 8 }}>
                  Signed by {detail?.signedByName || selectedRow.signedBy || "guest"}
                  {detail?.signedAt ? ` · ${formatDate(detail.signedAt)}` : ""}
                </div>
              </div>
            )}
          </>
        )}
      </main>

      <aside style={{
        width: "clamp(320px, 26vw, 420px)",
        flex: "0 0 clamp(320px, 26vw, 420px)",
        minHeight: 0,
        padding: "24px 22px",
        background: "var(--ink-50)",
        borderLeft: "1px solid var(--ink-100)",
        display: "flex",
        flexDirection: "column",
        gap: 14,
        overflowY: "auto",
      }}>
        <div style={{
          background: "#fff",
          border: `2px solid ${selectedRow && selectedStatus.tone === "danger" ? "var(--color-danger)" : "var(--color-success)"}`,
          borderRadius: 18,
          padding: 18,
          boxShadow: selectedRow && selectedStatus.tone === "danger" ? "0 5px 0 #8c2410" : "0 5px 0 #0e6638",
        }}>
          <div style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            color: selectedRow && selectedStatus.tone === "danger" ? "var(--color-danger)" : "var(--color-success)",
          }}>
            <div style={{
              width: 36,
              height: 36,
              borderRadius: 10,
              background: selectedRow && selectedStatus.tone === "danger" ? "var(--color-danger-soft)" : "var(--color-success-soft)",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
            }}>
              <Icon name={selectedRow && selectedStatus.tone === "danger" ? "shield-alert" : "shield-check"} size={20} />
            </div>
            <div style={{ fontFamily: "var(--font-display)", fontWeight: 800, fontSize: 22, lineHeight: 1.1 }}>
              {!selectedRow ? "Lookup ready" : selectedStatus.tone === "danger" ? "Cannot jump" : "Waiver valid"}
            </div>
          </div>
          <div style={{ fontSize: 14, color: "var(--ink-700)", marginTop: 10, lineHeight: 1.45 }}>
            {!selectedRow
              ? "Search or select a waiver to verify jump eligibility."
              : selectedStatus.tone === "danger"
                ? "This guest is blocked from check-in until a new waiver is signed."
                : "This waiver is currently valid for check-in coverage."}
          </div>
        </div>

        <div className="eyebrow">Resolve</div>
        <button
          type="button"
          onClick={() => signingUrl && window.open(signingUrl, "_blank", "noopener,noreferrer")}
          disabled={!signingUrl}
          className="t-btn t-btn--primary t-btn--block"
          style={{ height: 60, fontSize: 16, opacity: signingUrl ? 1 : 0.55, cursor: signingUrl ? "pointer" : "not-allowed" }}
        >
          <Icon name="tablet-smartphone" size={21} /> Sign on tablet
        </button>
        <button
          type="button"
          onClick={copyPortalLink}
          className="a-btn a-btn--ghost"
          style={{ justifyContent: "center", height: 48 }}
        >
          <Icon name="copy" size={16} /> Copy waiver link
        </button>
        <button
          type="button"
          onClick={refresh}
          className="a-btn a-btn--ghost"
          style={{ justifyContent: "center", height: 48 }}
        >
          <Icon name="refresh-cw" size={16} /> Refresh status
        </button>

        <div style={{ marginTop: 8, background: "#fff", border: "1.5px solid var(--ink-200)", borderRadius: 14, padding: 14 }}>
          <div className="eyebrow">Operator note</div>
          <div style={{ fontSize: 13, color: "var(--ink-600)", lineHeight: 1.5, marginTop: 8 }}>
            Use this screen for live waiver lookup. For booking-specific linking, open the Check-in page and use the ticket row's waiver search so the holder is bound to the correct participant.
          </div>
        </div>
      </aside>
    </div>
  );
}
