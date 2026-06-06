// Redeem — cashier screen for finding a customer's currently
// redeemable artefacts (unscheduled vouchers, voucher-pack
// entitlements, active memberships) and acting on them.
//
// Two entry points:
//   1. Customer search — type a name/email/phone, pick a guest,
//      see their active redeemables as cards.
//   2. Token scan (legacy / scanner-pipe) — if the input matches a
//      redemption-token shape, jump straight to the artefact via
//      /api/vouchers/by-token/:token (handles AS-V-* voucher,
//      AS-V-* entitlement, AS-V-* membership). AS-T-* ticket codes
//      still fall through to the ticket redeem flow.
//
// Each artefact card has a primary action that fires the correct
// existing backend endpoint:
//   • Voucher      → scheduleVoucher via nearest-slot redeem
//   • Entitlement  → redeemEntitlement (single-press redeem)
//   • Membership   → redeemMembership (single-press member ticket)

import React, { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Icon } from "./Icon";
import { StatusPill } from "./StatusPill";
import {
  useLazySearchCustomersQuery,
  useLazyGetCustomerRedeemablesQuery,
} from "../../features/customers/customersApi";
import {
  useLazyLookupVoucherByTokenQuery,
  useRedeemMembershipMutation,
  useScheduleVoucherMutation,
  useRedeemEntitlementMutation,
} from "../../features/vouchers/voucherApi";
import {
  useLazyGetAvailabilityQuery,
  useLinkParticipantFromWaiverMutation,
} from "../../features/bookings/bookingApi";
import {
  useLazyGetTicketByCodeQuery,
  useRedeemTicketMutation,
  useGetRecentRedemptionsQuery,
} from "../../features/tickets/ticketApi";
import { getTerminal } from "../../lib/terminal";
import { useEffectiveSettings } from "../../lib/useEffectiveSettings";
import { actRedeemable } from "./actRedeemable";
import { CartWaiverModal } from "./CartWaiverModal";

const TOKEN_LOOKS_LIKE = /^AS-[A-Z]-[A-Z0-9]+$/i;

export function Redeem() {
  const [mode, setMode] = useState("search"); // "search" | "token"
  const [search, setSearch] = useState("");
  const [selectedGuest, setSelectedGuest] = useState(null);
  const [redeemables, setRedeemables] = useState(null);
  const searchInputRef = useRef(null);

  const [searchCustomers, { data: searchData, isFetching: isSearching }] =
    useLazySearchCustomersQuery();
  const [fetchRedeemables, { isFetching: isFetchingRedeemables }] =
    useLazyGetCustomerRedeemablesQuery();
  const [lookupToken] = useLazyLookupVoucherByTokenQuery();
  const [lookupTicket] = useLazyGetTicketByCodeQuery();
  const [redeemTicket] = useRedeemTicketMutation();

  const deviceId = getTerminal()?.deviceId || null;
  const { data: recentRedemptions = [] } = useGetRecentRedemptionsQuery({ deviceId });

  // Focus on mount.
  useEffect(() => {
    searchInputRef.current?.focus();
  }, []);

  // Global scanner pipe — any AS-X-* token submitted by the USB barcode
  // scanner anywhere on this screen drops into the token-handler path.
  useEffect(() => {
    const onScan = (e) => {
      const scanned = e?.detail?.code;
      if (!scanned) return;
      handleTokenInput(scanned);
    };
    window.addEventListener("cashier:scan", onScan);
    return () => window.removeEventListener("cashier:scan", onScan);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Debounced customer search.
  useEffect(() => {
    if (mode !== "search") return undefined;
    const trimmed = search.trim();
    if (!trimmed) return undefined;
    // If the typed string LOOKS like a token, switch to token mode
    // instead of searching customers.
    if (TOKEN_LOOKS_LIKE.test(trimmed)) {
      handleTokenInput(trimmed);
      return undefined;
    }
    const handle = setTimeout(() => {
      searchCustomers({ search: trimmed, limit: 15 });
    }, 250);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, mode]);

  const pickGuest = async (guest) => {
    setSelectedGuest(guest);
    setSearch("");
    setRedeemables(null);
    try {
      const res = await fetchRedeemables(guest.guestId).unwrap();
      setRedeemables(res || null);
    } catch (err) {
      toast.error(err?.data?.error || "Could not load redeemables");
    }
  };

  const clearSelection = () => {
    setSelectedGuest(null);
    setRedeemables(null);
    setTimeout(() => searchInputRef.current?.focus(), 0);
  };

  const refreshRedeemables = async () => {
    if (!selectedGuest) return;
    try {
      const res = await fetchRedeemables(selectedGuest.guestId).unwrap();
      setRedeemables(res || null);
    } catch (err) {
      console.warn("[Redeem] refresh failed:", err?.data?.error);
    }
  };

  // Token entry path — used by the global scanner pipe AND by typing
  // a token directly in the search box. AS-T-* tickets fall back to
  // the ticket redeem flow; everything else hits the by-token lookup.
  const handleTokenInput = async (raw) => {
    const token = String(raw || "").trim().toUpperCase();
    if (!token) return;

    // Ticket code — direct redeem at gate.
    if (token.startsWith("AS-T-")) {
      try {
        const terminal = getTerminal();
        const res = await redeemTicket({
          ticketCode: token,
          terminalDeviceId: terminal?.deviceId || null,
          gateOrZone: terminal?.deviceName || null,
        }).unwrap();
        toast.success(
          `Redeemed · ${res?.data?.activity?.activityName || res?.data?.productType || "ticket"}`
        );
      } catch (err) {
        toast.error(err?.data?.error || "Ticket redeem failed");
      }
      setSearch("");
      return;
    }

    // Voucher / entitlement / membership token.
    try {
      const res = await lookupToken(token).unwrap();
      const data = res?.data;
      if (!data) {
        toast.error("Token not found");
        return;
      }
      // If we have a guest on the data, jump straight to their
      // redeemables list with the scanned artefact highlighted.
      const guest = data.guest;
      if (guest?.guestId) {
        await pickGuest({
          guestId: guest.guestId,
          guestName: guest.guestName,
          guestEmail: guest.guestEmail,
          guestPhone: guest.guestPhone,
        });
      } else {
        toast.message(`${data.kind || "Token"} found — no guest attached`);
      }
    } catch (err) {
      toast.error(err?.data?.message || "Token lookup failed");
    }
    setSearch("");
  };

  const searchResults = searchData?.data || [];

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      {/* Search / scan input */}
      <div
        style={{
          padding: "24px 28px",
          background: "var(--ink-25)",
          borderBottom: "1px solid var(--ink-100)",
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        <StatusPill tone="info" icon="search">
          Find customer or scan token
        </StatusPill>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 14,
            background: "white",
            border: "2px solid var(--ink-800)",
            borderRadius: 18,
            padding: "12px 18px",
            boxShadow: "0 6px 0 var(--ink-800)",
          }}
        >
          <Icon name="search" size={22} stroke={2} style={{ color: "var(--ink-700)" }} />
          <input
            ref={searchInputRef}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name / email / phone — or scan token"
            style={{
              all: "unset",
              flex: 1,
              fontSize: 16,
              color: "var(--ink-900)",
            }}
          />
          {(isSearching || isFetchingRedeemables) && (
            <span style={{ fontSize: 11, color: "var(--ink-500)" }}>…</span>
          )}
          {selectedGuest && (
            <button
              type="button"
              onClick={clearSelection}
              className="a-btn a-btn--ghost a-btn--sm"
            >
              <Icon name="x" size={14} /> Clear
            </button>
          )}
        </div>

        {/* Customer search results — only when nothing's selected and
            there's a non-token search term in flight. */}
        {!selectedGuest && search.trim() && !TOKEN_LOOKS_LIKE.test(search.trim()) && (
          <div
            style={{
              background: "white",
              border: "1px solid var(--ink-200)",
              borderRadius: 12,
              maxHeight: 260,
              overflowY: "auto",
            }}
          >
            {searchResults.length === 0 && !isSearching && (
              <div style={{ padding: 14, fontSize: 13, color: "var(--ink-500)" }}>
                No matches.
              </div>
            )}
            {searchResults.map((g) => (
              <button
                key={g.guestId}
                type="button"
                onClick={() => pickGuest(g)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  width: "100%",
                  padding: "10px 14px",
                  border: "none",
                  borderBottom: "1px solid var(--ink-100)",
                  background: "white",
                  cursor: "pointer",
                  textAlign: "left",
                }}
              >
                <Icon name="user-round" size={16} style={{ color: "var(--ink-500)" }} />
                <div style={{ flex: 1, lineHeight: 1.3 }}>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{g.guestName || "Guest"}</div>
                  <div style={{ fontSize: 11, color: "var(--ink-500)" }}>
                    {g.guestEmail || g.guestPhone || "no contact"}
                  </div>
                </div>
                <Icon name="chevron-right" size={14} style={{ color: "var(--ink-400)" }} />
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Selected customer's redeemables */}
      <div style={{ flex: 1, overflowY: "auto", padding: "20px 28px" }}>
        {selectedGuest ? (
          <SelectedGuestView
            guest={selectedGuest}
            redeemables={redeemables}
            isLoading={isFetchingRedeemables}
            onRefresh={refreshRedeemables}
          />
        ) : (
          <RecentActivity recent={recentRedemptions} />
        )}
      </div>
    </div>
  );
}

/* ── Selected guest view ─────────────────────────────────────── */
function SelectedGuestView({ guest, redeemables, isLoading, onRefresh }) {
  const posSettings = useEffectiveSettings();
  const [redeemMembership] = useRedeemMembershipMutation();
  const [scheduleVoucher] = useScheduleVoucherMutation();
  const [fetchAvailability] = useLazyGetAvailabilityQuery();
  const [redeemEntitlement] = useRedeemEntitlementMutation();
  const [linkParticipantFromWaiver] = useLinkParticipantFromWaiverMutation();
  const [selectedKeys, setSelectedKeys] = useState(new Set());
  const [batchBusy, setBatchBusy] = useState(false);
  const [waiverTarget, setWaiverTarget] = useState(null);

  const vouchers = redeemables?.vouchers || [];
  const entitlements = redeemables?.entitlements || [];
  const memberships = redeemables?.memberships || [];
  const ticketItems = [
    ...memberships.map((item) => ({ key: `membership-${item.membershipId}`, kind: "membership", item })),
    ...vouchers.map((item) => ({ key: `voucher-${item.bookingItemId}`, kind: "voucher", item })),
    ...entitlements.map((item) => ({ key: `entitlement-${item.entitlementId}`, kind: "entitlement", item })),
  ];
  const noneFound =
    vouchers.length === 0 && entitlements.length === 0 && memberships.length === 0;

  useEffect(() => {
    setSelectedKeys(new Set(ticketItems.map((item) => item.key)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticketItems.map((item) => item.key).join("|")]);

  const selectedItems = ticketItems.filter((item) => selectedKeys.has(item.key));
  const allSelected = ticketItems.length > 0 && selectedItems.length === ticketItems.length;

  const toggleOne = (key) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleAll = () => {
    setSelectedKeys(allSelected ? new Set() : new Set(ticketItems.map((item) => item.key)));
  };

  const redeemOne = async ({ kind, item }) => {
    if (item.requiresWaiver && !item.waiverAttached) {
      throw new Error("Attach waiver before redeeming.");
    }
    const terminal = getTerminal();
    if (kind === "membership") {
      const title = item.activityName || "Membership";
      const res = await redeemMembership({
        membershipId: item.membershipId,
        activityId: null,
        terminalDeviceId: terminal?.deviceId || null,
        gateOrZone: terminal?.deviceName || null,
      }).unwrap();
      return {
        ok: true,
        message: `${title}${Number.isFinite(res?.data?.redemptionsToday) ? ` (${res.data.redemptionsToday} today)` : ""}`,
      };
    }

    if (kind === "voucher") {
      const result = await actRedeemable(
        {
          id: `voucher-${item.bookingItemId}`,
          kind: "voucher",
          label: item.activityName || item.variationName || "Voucher",
          action: {
            type: "schedule_nearest",
            bookingItemId: item.bookingItemId,
            activityId: item.activityId || null,
            variationId: item.variationId || null,
          },
        },
        {
          deps: {
            scheduleVoucher,
            fetchAvailability,
            posSettings,
            terminal,
          },
        }
      );
      if (!result.ok) throw new Error(result.message || "Voucher redeem failed");
      return { ok: true, message: result.message || "Voucher redeemed" };
    }

    if (kind === "entitlement") {
      const res = await redeemEntitlement({
        entitlementId: item.entitlementId,
        quantity: 1,
        terminalDeviceId: terminal?.deviceId || null,
        gateOrZone: terminal?.deviceName || null,
      }).unwrap();
      return {
        ok: true,
        message: `${item.activityName || "Entitlement"} (${res?.data?.remainingQty ?? "?"} left)`,
      };
    }

    throw new Error("Unknown redeemable type");
  };

  const redeemMany = async (items) => {
    if (batchBusy || !items.length) return;
    setBatchBusy(true);
    const failures = [];
    let redeemed = 0;
    try {
      for (const ticket of items) {
        try {
          await redeemOne(ticket);
          redeemed += 1;
        } catch (err) {
          failures.push({
            label:
              ticket.item.activityName ||
              ticket.item.variationName ||
              ticket.item.redemptionToken ||
              ticket.kind,
            message: err?.data?.message || err?.data?.error || err.message || "Failed",
          });
        }
      }

      if (redeemed > 0 && failures.length === 0) {
        toast.success(`Redeemed ${redeemed} item${redeemed === 1 ? "" : "s"}`);
      } else if (redeemed > 0) {
        toast.warning(`Redeemed ${redeemed}; ${failures.length} failed`);
      } else {
        toast.error(failures[0]?.message || "Redeem failed");
      }

      if (failures.length) {
        console.warn("[Redeem] batch failures", failures);
      }
      await onRefresh?.();
    } finally {
      setBatchBusy(false);
    }
  };

  const attachWaiver = async (attached) => {
    const picked = Array.isArray(attached) ? attached[attached.length - 1] : null;
    const signatureId = Number(picked?.signatureId);
    const bookingId = Number(waiverTarget?.bookingId);
    if (!signatureId || !bookingId) return;
    try {
      await linkParticipantFromWaiver({
        bookingId,
        waiverSignatureId: signatureId,
        includeMinors: false,
        people: ["signer"],
      }).unwrap();
      toast.success("Waiver attached");
      setWaiverTarget(null);
      await onRefresh?.();
    } catch (err) {
      toast.error(err?.data?.error || err?.data?.message || "Could not attach waiver");
    }
  };

  if (isLoading && !redeemables) {
    return <div style={{ color: "var(--ink-500)", fontSize: 13 }}>Loading...</div>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <Section title="Customer and purchase details">
        <div
          style={{
            background: "white",
            border: "2px solid var(--ink-800)",
            borderRadius: 12,
            padding: "12px 16px",
            display: "grid",
            gridTemplateColumns: "minmax(180px, 1fr) repeat(3, minmax(78px, auto))",
            gap: 12,
            alignItems: "center",
          }}
        >
          <div>
            <div className="eyebrow" style={{ marginBottom: 2 }}>Customer</div>
            <div style={{ fontWeight: 800, fontSize: 16 }}>{guest.guestName || "Guest"}</div>
            <div style={{ fontSize: 12, color: "var(--ink-500)", marginTop: 2 }}>
              {guest.guestEmail || guest.guestPhone || "no contact"}
            </div>
          </div>
          <SummaryStat label="Memberships" value={memberships.length} />
          <SummaryStat label="Vouchers" value={vouchers.length} />
          <SummaryStat label="Items" value={entitlements.length} />
        </div>
      </Section>

      {noneFound && (
        <div
          style={{
            padding: 24,
            textAlign: "center",
            background: "var(--ink-50)",
            borderRadius: 10,
            color: "var(--ink-500)",
            fontSize: 13,
          }}
        >
          No active vouchers, memberships, or entitlements for this customer.
        </div>
      )}

      {!noneFound && (
        <Section title={`Redeem tickets (${memberships.length + vouchers.length + entitlements.length})`}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 10,
              padding: "8px 10px",
              background: "var(--ink-50)",
              border: "1px solid var(--ink-200)",
              borderRadius: 10,
            }}
          >
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, fontWeight: 800 }}>
              <input
                type="checkbox"
                checked={allSelected}
                onChange={toggleAll}
                disabled={batchBusy}
              />
              Select all
              <span style={{ color: "var(--ink-500)", fontWeight: 700 }}>
                {selectedItems.length} selected
              </span>
            </label>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <button
                type="button"
                className="a-btn a-btn--secondary a-btn--sm"
                onClick={() => redeemMany(selectedItems)}
                disabled={batchBusy || selectedItems.length === 0}
              >
                {batchBusy ? "Redeeming..." : `Redeem selected (${selectedItems.length})`}
              </button>
              <button
                type="button"
                className="a-btn a-btn--primary a-btn--sm"
                onClick={() => redeemMany(ticketItems)}
                disabled={batchBusy || ticketItems.length === 0}
              >
                Redeem all
              </button>
            </div>
          </div>

          {memberships.map((m) => {
            const key = `membership-${m.membershipId}`;
            return (
              <MembershipCard
                key={key}
                m={m}
                selected={selectedKeys.has(key)}
                onToggle={() => toggleOne(key)}
                disabled={batchBusy}
                onAttachWaiver={() => setWaiverTarget(m)}
              />
            );
          })}
          {vouchers.map((v) => {
            const key = `voucher-${v.bookingItemId}`;
            return (
              <VoucherCard
                key={key}
                v={v}
                selected={selectedKeys.has(key)}
                onToggle={() => toggleOne(key)}
                disabled={batchBusy}
                onAttachWaiver={() => setWaiverTarget(v)}
              />
            );
          })}
          {entitlements.map((e) => {
            const key = `entitlement-${e.entitlementId}`;
            return (
              <EntitlementCard
                key={key}
                e={e}
                selected={selectedKeys.has(key)}
                onToggle={() => toggleOne(key)}
                disabled={batchBusy}
                onAttachWaiver={() => setWaiverTarget(e)}
              />
            );
          })}
        </Section>
      )}
      <CartWaiverModal
        open={!!waiverTarget}
        mode="waiver"
        needed={1}
        attached={
          waiverTarget?.waiverSignatureId
            ? [
                {
                  signatureId: waiverTarget.waiverSignatureId,
                  name: guest.guestName || "Attached waiver",
                  coverage: 1,
                },
              ]
            : []
        }
        customer={{
          name: guest.guestName,
          email: guest.guestEmail,
          phone: guest.guestPhone,
        }}
        onChange={attachWaiver}
        onClose={() => setWaiverTarget(null)}
      />
    </div>
  );
}

function SummaryStat({ label, value }) {
  return (
    <div
      style={{
        minWidth: 76,
        padding: "8px 10px",
        borderRadius: 10,
        background: "var(--ink-50)",
        border: "1px solid var(--ink-200)",
        textAlign: "center",
      }}
    >
      <div style={{ fontSize: 10, fontWeight: 800, color: "var(--ink-500)", textTransform: "uppercase" }}>
        {label}
      </div>
      <div style={{ fontSize: 20, fontWeight: 900, color: "var(--ink-900)", lineHeight: 1.1 }}>
        {value}
      </div>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div>
      <div className="eyebrow" style={{ marginBottom: 8 }}>{title}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {children}
      </div>
    </div>
  );
}

/* ── Per-kind cards ──────────────────────────────────────────── */
function WaiverStatus({ item, onAttachWaiver, disabled }) {
  if (!item?.requiresWaiver) return null;

  if (item.waiverAttached) {
    return (
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 5,
          padding: "4px 8px",
          borderRadius: 999,
          background: "var(--color-success-soft)",
          color: "var(--color-success)",
          border: "1px solid var(--color-success)",
          fontSize: 11,
          fontWeight: 800,
          whiteSpace: "nowrap",
        }}
      >
        <Icon name="check" size={13} stroke={3} />
        Waiver attached
      </span>
    );
  }

  return (
    <button
      type="button"
      className="a-btn a-btn--secondary a-btn--sm"
      onClick={onAttachWaiver}
      disabled={disabled || !item.bookingId}
      title={item.bookingId ? "Attach a signed waiver before redeeming" : "No purchase booking found for this item"}
      style={{
        borderColor: "var(--color-danger)",
        color: "var(--color-danger)",
        whiteSpace: "nowrap",
      }}
    >
      Attach waiver
    </button>
  );
}

function MembershipCard({ m, selected, onToggle, disabled, onAttachWaiver }) {
  const title = m.activityName || "Membership";
  const purchasedLabel = m.purchasedAt
    ? new Date(m.purchasedAt).toLocaleDateString()
    : null;
  const expiresLabel = m.expiresAt
    ? new Date(m.expiresAt).toLocaleDateString()
    : null;

  return (
    <div
      style={{
        background: "white",
        border: "1.5px solid #6366F1",
        borderRadius: 12,
        padding: "12px 14px",
        display: "grid",
        gridTemplateColumns: "auto auto minmax(0, 1fr) auto",
        alignItems: "center",
        gap: 12,
      }}
    >
      <input
        type="checkbox"
        checked={selected}
        onChange={onToggle}
        disabled={disabled}
        aria-label={`Select ${title}`}
      />
      <Icon name="ticket" size={20} style={{ color: "#6366F1" }} />
      <div style={{ minWidth: 0, lineHeight: 1.4 }}>
        <div style={{ fontWeight: 700, fontSize: 14 }}>
          {title}
          {m.variationName ? ` · ${m.variationName}` : ""}
        </div>
        <div style={{ fontSize: 11, color: "var(--ink-500)" }}>
          <code style={{ fontFamily: "var(--font-mono)" }}>{m.redemptionToken}</code>
          {m.expiresAt ? ` · expires ${new Date(m.expiresAt).toLocaleDateString()}` : ""}
        </div>
        <div style={{ fontSize: 11, color: "var(--ink-600)", marginTop: 3 }}>
          Member #{m.membershipId}
          {m.bookingNumber ? ` - ${m.bookingNumber}` : ""}
          {purchasedLabel ? ` - bought ${purchasedLabel}` : ""}
          {expiresLabel ? ` - expires ${expiresLabel}` : ""}
          {m.paymentStatus ? ` - ${String(m.paymentStatus).toUpperCase()}` : ""}
          {Number.isFinite(m.redemptionsToday) ? ` - ${m.redemptionsToday} used today` : ""}
        </div>
      </div>
      <WaiverStatus item={m} onAttachWaiver={onAttachWaiver} disabled={disabled} />
    </div>
  );
}

function VoucherCard({ v, selected, onToggle, disabled, onAttachWaiver }) {
  const title = v.activityName || "Voucher";
  return (
    <div
      style={{
        background: "white",
        border: "1.5px solid #22C55E",
        borderRadius: 12,
        padding: "12px 14px",
        display: "flex",
        alignItems: "center",
        gap: 12,
      }}
    >
      <input
        type="checkbox"
        checked={selected}
        onChange={onToggle}
        disabled={disabled || !v.bookingItemId}
        aria-label={`Select ${title}`}
      />
      <Icon name="ticket" size={20} style={{ color: "#22C55E" }} />
      <div style={{ flex: 1, lineHeight: 1.4 }}>
        <div style={{ fontWeight: 700, fontSize: 14 }}>
          {title}
        </div>
        <div style={{ fontSize: 11, color: "var(--ink-500)" }}>
          <code style={{ fontFamily: "var(--font-mono)" }}>{v.redemptionToken}</code>
          {v.expiresAt ? ` · expires ${new Date(v.expiresAt).toLocaleDateString()}` : ""}
        </div>
      </div>
      <WaiverStatus item={v} onAttachWaiver={onAttachWaiver} disabled={disabled} />
    </div>
  );
}

function EntitlementCard({ e, selected, onToggle, disabled, onAttachWaiver }) {
  const title = e.activityName || "Voucher pack";
  return (
    <div
      style={{
        background: "white",
        border: "1.5px solid #F45B0A",
        borderRadius: 12,
        padding: "12px 14px",
        display: "flex",
        alignItems: "center",
        gap: 12,
      }}
    >
      <input
        type="checkbox"
        checked={selected}
        onChange={onToggle}
        disabled={disabled || e.remainingQty <= 0}
        aria-label={`Select ${title}`}
      />
      <Icon name="package" size={20} style={{ color: "#F45B0A" }} />
      <div style={{ flex: 1, lineHeight: 1.4 }}>
        <div style={{ fontWeight: 700, fontSize: 14 }}>
          {title}
          {e.variationName ? ` - ${e.variationName}` : ""}
        </div>
        <div style={{ fontSize: 11, color: "var(--ink-500)" }}>
          <code style={{ fontFamily: "var(--font-mono)" }}>{e.redemptionToken}</code>
          {" - "}
          <strong>{e.remainingQty}</strong> of {e.originalQty} left
          {e.expiresAt ? ` - expires ${new Date(e.expiresAt).toLocaleDateString()}` : ""}
        </div>
      </div>
      <WaiverStatus item={e} onAttachWaiver={onAttachWaiver} disabled={disabled} />
    </div>
  );
}

/* ── Recent redemptions (empty-state filler) ─────────────────── */
function RecentActivity({ recent }) {
  if (!recent.length) {
    return (
      <div style={{ padding: 28, textAlign: "center", color: "var(--ink-500)", fontSize: 13 }}>
        Search a customer or scan a token to begin.
      </div>
    );
  }
  return (
    <div>
      <div className="eyebrow" style={{ marginBottom: 12 }}>Recent activity</div>
      <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 8 }}>
        {recent.map((entry) => (
          <RecentRow key={entry.redemptionId} entry={entry} />
        ))}
      </ul>
    </div>
  );
}

function RecentRow({ entry }) {
  const ok = (entry.status || "success") === "success";
  const time = entry.redeemedAt
    ? new Date(entry.redeemedAt).toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
        second: "2-digit",
      })
    : "";
  return (
    <li
      style={{
        display: "grid",
        gridTemplateColumns: "auto 1fr auto",
        alignItems: "center",
        gap: 12,
        padding: "10px 14px",
        background: ok ? "var(--color-success-soft)" : "var(--color-danger-soft)",
        border: `1.5px solid ${ok ? "var(--color-success)" : "var(--color-danger)"}`,
        borderRadius: 10,
      }}
    >
      <Icon name={ok ? "check" : "x"} size={18} stroke={3} style={{ color: ok ? "var(--color-success)" : "var(--color-danger)" }} />
      <div style={{ lineHeight: 1.3 }}>
        <div style={{ fontWeight: 700, fontSize: 13 }}>
          {entry.code || "—"}
          {entry.activityName && (
            <span style={{ color: "var(--ink-500)", fontWeight: 500, marginLeft: 6 }}>
              · {entry.activityName}
            </span>
          )}
        </div>
        <div style={{ fontSize: 11, color: "var(--ink-600)" }}>
          {ok ? "Redeemed" : entry.status || "Failed"}
          {entry.gateOrZone ? ` · ${entry.gateOrZone}` : ""}
        </div>
      </div>
      <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--ink-500)" }}>
        {time}
      </div>
    </li>
  );
}
