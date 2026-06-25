import React, { useEffect, useState } from "react";
import { Icon } from "./Icon";
import { needsScheduleSelection } from "./cartPricing";
import {
  useLazyLookupVoucherByTokenQuery,
  useLazyLookupVoucherPackByTokenQuery,
} from "../../features/vouchers/voucherApi";

// Token shape — the existing search input doubles as a universal
// voucher / entitlement / pack lookup. Anything matching this pattern
// is asked of the backend on a debounce; on a hit the catalog tiles
// are replaced with the voucher's inclusions. Names with spaces fall
// through to the normal name-filter path.
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{6,}$/;
const VOUCHER_DEBOUNCE_MS = 300;

// Sections come from props (loaded from the device's terminal template).
// Falls back to a single "Quick" section using whatever items the parent
// supplied if no sections array is given.
export function CatalogGrid({
  sections = [],
  loading,
  error,
  onAdd,
  onAddVoucherInclusion,
  busyItemId = null,
}) {
  const [activeChip, setActiveChip] = useState("all");
  const [search, setSearch] = useState("");
  const [variantPicker, setVariantPicker] = useState(null);

  // ── Voucher lookup state ─────────────────────────────────────────
  const [voucherPack, setVoucherPack] = useState(null); // { kind, payload } | null
  const [voucherSearching, setVoucherSearching] = useState(false);
  const [voucherError, setVoucherError] = useState(null);
  const [lookupVoucher] = useLazyLookupVoucherByTokenQuery();
  const [lookupPack] = useLazyLookupVoucherPackByTokenQuery();

  useEffect(() => {
    const trimmed = search.trim();
    if (!trimmed || !TOKEN_SHAPE.test(trimmed)) {
      setVoucherPack(null);
      setVoucherError(null);
      setVoucherSearching(false);
      return undefined;
    }
    let cancelled = false;
    setVoucherSearching(true);
    setVoucherError(null);
    const timer = setTimeout(async () => {
      try {
        const packRes = await lookupPack(trimmed).unwrap().catch(() => null);
        if (cancelled) return;
        if (packRes?.data) {
          setVoucherPack({ kind: "pack", payload: packRes.data });
          setVoucherSearching(false);
          return;
        }
        const single = await lookupVoucher(trimmed).unwrap();
        if (cancelled) return;
        if (single?.data) {
          setVoucherPack({ kind: single.data.kind || "voucher", payload: single.data });
        } else {
          setVoucherError("No voucher matches that code.");
        }
      } catch (err) {
        if (cancelled) return;
        if (err?.status === 404) setVoucherError("No voucher matches that code.");
        else setVoucherError(err?.data?.message || "Lookup failed.");
      } finally {
        if (!cancelled) setVoucherSearching(false);
      }
    }, VOUCHER_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [search, lookupVoucher, lookupPack]);

  // Build a list of inclusions from the resolved voucher / pack so the
  // tiles can render uniformly regardless of whether it's a multi-item
  // pack, a single entitlement, or a single voucher.
  const voucherInclusions = (() => {
    if (!voucherPack) return [];
    if (voucherPack.kind === "pack") {
      const p = voucherPack.payload || {};
      return [
        ...(p.vouchers || []).map((v) => ({
          uid: `v:${v.bookingItemId}`,
          kind: "voucher",
          activityName: v.activityName || v.activity?.name || "Voucher item",
          activityId: v.activityId || v.activity?.activityId || null,
          variationId: v.variationId,
          variationName: v.variationName || v.variation?.name || null,
          requiresWaiver: !!v.requiresWaiver,
          status: v.status,
          remainingQty: v.status === "active" && !v.slotId ? 1 : 0,
          originalQty: 1,
          bookingItemId: v.bookingItemId,
          redemptionToken: v.redemptionToken,
        })),
        ...(p.entitlements || []).map((e) => ({
          uid: `e:${e.entitlementId}`,
          kind: "entitlement",
          activityName: e.activityName || e.activity?.name || "Stock-item credit",
          activityId: e.activityId || e.activity?.activityId || null,
          variationId: e.variationId,
          variationName: e.variationName || e.variation?.name || null,
          requiresWaiver: !!e.requiresWaiver,
          status: e.status,
          remainingQty: Number(e.remainingQty) || 0,
          originalQty: Number(e.originalQty) || 0,
          entitlementId: e.entitlementId,
          redemptionToken: e.redemptionToken,
        })),
      ];
    }
    // single voucher / entitlement (non-pack)
    const single = voucherPack.payload;
    if (voucherPack.kind === "entitlement") {
      return [{
        uid: `e:${single.entitlementId}`,
        kind: "entitlement",
        activityName: single.activityName || `Activity #${single.activityId}`,
        activityId: single.activityId,
        variationId: single.variationId,
        variationName: single.variationName,
        requiresWaiver: !!single.requiresWaiver,
        status: single.status,
        remainingQty: Number(single.remainingQty) || 0,
        originalQty: Number(single.originalQty) || 0,
        entitlementId: single.entitlementId,
        redemptionToken: search.trim(),
      }];
    }
    return [{
      uid: `v:${single.bookingItemId}`,
      kind: "voucher",
      activityName: single.activityName || `Activity #${single.activityId}`,
      activityId: single.activityId,
      variationId: single.variationId,
      variationName: single.variationName,
      requiresWaiver: !!single.requiresWaiver,
      status: single.status,
      remainingQty: single.status === "active" && !single.slotId ? 1 : 0,
      originalQty: 1,
      bookingItemId: single.bookingItemId,
      redemptionToken: search.trim(),
    }];
  })();
  const isVoucherMode = !!(voucherPack || voucherSearching || voucherError);

  const addWithVariant = (item, section, option = null) => {
    onAdd?.(buildChosenWithVariant(item, option), section);
    setVariantPicker(null);
  };

  const handleProductClick = (item, section) => {
    const options = item.variationOptions || [];
    if (options.length > 1) {
      setVariantPicker({ item, section });
      return;
    }
    addWithVariant(item, section, options[0] || null);
  };

  const matchesCatalogSearch = (item, rawQuery) => {
    if (!rawQuery) return true;
    const q = rawQuery.toLowerCase();
    const fields = [
      item.name,
      item.sub,
      item.id,
      item.sku,
      item.productSku,
      item.raw?.sku,
      item.raw?.SKU,
    ];
    const optionFields = (item.variationOptions || []).flatMap((option) => [
      option.sku,
      option.productSku,
      option.SKU,
      option.name,
    ]);
    return [...fields, ...optionFields].some((value) =>
      String(value || "").toLowerCase().includes(q)
    );
  };

  const visibleSections = sections
    .filter((s) => activeChip === "all" || s.title === activeChip)
    .map((s) => ({
      ...s,
      items: s.items.filter((it) => matchesCatalogSearch(it, search)),
    }))
    .filter((s) => s.items.length > 0);

  return (
    <div style={{ flex: "1 1 auto", minWidth: 0, minHeight: 0, overflow: "hidden", display: "flex", flexDirection: "column" }}>
      <div style={{ padding: "16px 28px", display: "flex", gap: 10, alignItems: "center", borderBottom: "1px solid var(--ink-100)", flexShrink: 0 }}>
        <SearchBar value={search} onChange={setSearch} />
        <div style={{ display: "flex", gap: 8, marginLeft: "auto", flexWrap: "wrap", justifyContent: "flex-end", minWidth: 0 }}>
          <button
            type="button"
            className={`chip ${activeChip === "all" ? "is-active" : ""}`}
            onClick={() => setActiveChip("all")}
            style={{ all: "unset", cursor: "pointer", padding: "6px 12px", borderRadius: 999, fontWeight: 700, fontSize: 12.5, color: activeChip === "all" ? "white" : "var(--ink-700)", background: activeChip === "all" ? "var(--ink-800)" : "white", border: "1.5px solid var(--ink-200)" }}
          >
            All
          </button>
          {sections.map((s) => (
            <button
              key={s.title}
              type="button"
              onClick={() => setActiveChip(s.title)}
              style={{ all: "unset", cursor: "pointer", padding: "6px 12px", borderRadius: 999, fontWeight: 700, fontSize: 12.5, color: activeChip === s.title ? "white" : "var(--ink-700)", background: activeChip === s.title ? "var(--ink-800)" : "white", border: "1.5px solid var(--ink-200)" }}
            >
              {s.title}
            </button>
          ))}
        </div>
      </div>

      <div style={{ flex: "1 1 auto", minHeight: 0, overflowY: "auto", overscrollBehavior: "contain", padding: "20px 28px 32px", display: "flex", flexDirection: "column", gap: 24 }}>
        {isVoucherMode ? (
          <VoucherInclusionsView
            searching={voucherSearching}
            error={voucherError}
            pack={voucherPack}
            inclusions={voucherInclusions}
            onAdd={(inclusion, qty) =>
              onAddVoucherInclusion?.(
                { ...inclusion, qty: qty || 1 },
                voucherPack
              )
            }
            onClear={() => setSearch("")}
          />
        ) : loading ? (
          <div style={{ padding: 60, textAlign: "center", color: "var(--ink-500)", fontWeight: 600 }}>
            Loading terminal template...
          </div>
        ) : error ? (
          <div style={{ padding: 60, textAlign: "center", color: "var(--color-danger)", fontWeight: 600 }}>
            Couldn't load this terminal's template. Pick a template in admin / POS / Terminals.
          </div>
        ) : visibleSections.length === 0 ? (
          <div style={{ padding: 60, textAlign: "center", color: "var(--ink-500)" }}>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>No activities in this template</div>
            <div style={{ fontSize: 13 }}>Configure sections in admin / POS / Terminal Presets.</div>
          </div>
        ) : (
          visibleSections.map((sec) => (
            <section key={sec.title}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 12 }}>
                <h2 style={{ margin: 0, fontFamily: "var(--font-display)", fontWeight: 800, fontSize: 22, letterSpacing: "-.01em" }}>{sec.title}</h2>
                <span className="eyebrow">{sec.items.length} item{sec.items.length === 1 ? "" : "s"}</span>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))", gap: 14 }}>
                {sec.items.map((it) => (
                  <ProductCard
                    key={it.id}
                    item={it}
                    tone={sec.tone}
                    busy={busyItemId != null && String(busyItemId) === String(it.id)}
                    onClick={() => handleProductClick(it, sec)}
                  />
                ))}
              </div>
            </section>
          ))
        )}
      </div>

      {variantPicker && (
        <VariantPickerDialog
          item={variantPicker.item}
          section={variantPicker.section}
          onClose={() => setVariantPicker(null)}
          onPick={addWithVariant}
        />
      )}
    </div>
  );
}

function ProductCard({ item, tone = "orange", onClick, busy = false }) {
  const accent = {
    orange: { bg: "var(--aero-orange-50)", fg: "var(--aero-orange-600)" },
    yellow: { bg: "var(--aero-yellow-50)", fg: "var(--aero-yellow-500)" },
    neutral: { bg: "var(--ink-50)", fg: "var(--ink-700)" },
  }[tone];
  const hasChoices = (item.variationOptions || []).length > 1;
  const requiresSchedule = needsScheduleSelection(item);

  return (
    <button
      onClick={busy ? undefined : onClick}
      disabled={busy}
      style={{
        all: "unset", cursor: "pointer",
        background: "var(--ink-0)",
        border: "2px solid var(--ink-800)",
        borderRadius: 18,
        boxShadow: "0 5px 0 var(--ink-800)",
        padding: 16,
        display: "flex", flexDirection: "column", gap: 10,
        transition: "transform var(--dur-fast) var(--ease-bounce), box-shadow var(--dur-fast)",
        position: "relative",
      }}
      onMouseDown={(e) => { e.currentTarget.style.transform = "translateY(5px)"; }}
      onMouseUp={(e) => { e.currentTarget.style.transform = ""; }}
      onMouseLeave={(e) => { e.currentTarget.style.transform = ""; }}
    >
      {item.badge && (
        <span style={{
          position: "absolute", top: -10, right: 14,
          background: "var(--aero-yellow-300)", color: "var(--ink-800)",
          fontSize: 10, fontWeight: 800, letterSpacing: ".08em",
          padding: "4px 8px", borderRadius: 999, border: "2px solid var(--ink-800)",
        }}>{item.badge}</span>
      )}
      <div style={{
        width: 44, height: 44, borderRadius: 12,
        background: accent.bg, color: accent.fg,
        display: "inline-flex", alignItems: "center", justifyContent: "center",
      }}>
        <Icon name={item.icon} size={24} />
      </div>
      <div style={{ minHeight: 44 }}>
        <div style={{ fontWeight: 700, fontSize: 16, lineHeight: 1.2 }}>{item.name}</div>
        {item.sub && <div style={{ fontSize: 12, color: "var(--ink-500)", marginTop: 2 }}>{item.sub}</div>}
        {(hasChoices || requiresSchedule) && (
          <div style={{ fontSize: 11, color: "var(--aero-orange-700)", fontWeight: 800, marginTop: 4 }}>
            {busy
              ? "Finding nearest slot…"
              : requiresSchedule
                ? "Nearest slot"
                : "Choose option"}
          </div>
        )}
      </div>
      <div className="display-num" style={{ fontSize: 24 }}>
        {Number.isFinite(item.price) ? `${hasChoices ? "From " : ""}$${Number(item.price).toFixed(2)}` : "-"}
      </div>
    </button>
  );
}

// Merges a chosen variation option onto a parent catalog item so the
// resulting cart line carries the variation's pricing, guest caps, etc.
// Pulled to module scope so other surfaces (e.g. the add-on suggestion
// strip in CashierApp) can reuse the same picker behavior as a catalog
// tile, end-to-end identical.
export function buildChosenWithVariant(item, option) {
  if (!option) return item;
  return {
    ...item,
    variationId: option.variationId,
    variationName: option.name,
    price: Number(option.price ?? item.price ?? 0),
    pricingMode: option.pricingMode || option.pricingType || item.pricingMode || item.pricingType || null,
    includedGuests: option.includedGuests ?? item.includedGuests ?? null,
    additionalPersonPrice: option.additionalPersonPrice ?? item.additionalPersonPrice ?? null,
    minGuests: option.minGuests ?? option.minimumGuests ?? item.minGuests ?? item.minimumGuests ?? null,
    maxGuests: option.maxGuests ?? option.maximumGuests ?? item.maxGuests ?? item.maximumGuests ?? null,
    sku: option.sku || option.SKU || item.sku || item.SKU || null,
    taxOverride: option.taxOverride || item.taxOverride || null,
    taxInclusive: option.taxInclusive === true || item.taxInclusive === true,
    taxAtSale: option.taxAtSale === true || item.taxAtSale === true,
    activityTaxOverride: option.activityTaxOverride || item.activityTaxOverride || null,
    activityTaxOverrideEnabled:
      option.activityTaxOverrideEnabled === true ||
      item.activityTaxOverrideEnabled === true,
    activityTaxOverrideRate:
      option.activityTaxOverrideRate ?? item.activityTaxOverrideRate ?? null,
  };
}

export function VariantPickerDialog({ item, section, onClose, onPick }) {
  const options = item.variationOptions || [];
  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 50,
        background: "rgba(0,0,0,0.35)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
      onMouseDown={onClose}
    >
      <div
        style={{
          width: "min(520px, 100%)",
          background: "var(--ink-0)",
          border: "2px solid var(--ink-800)",
          borderRadius: 18,
          boxShadow: "0 8px 0 var(--ink-800)",
          padding: 18,
        }}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div style={{ display: "flex", justifyContent: "space-between", gap: 16, marginBottom: 14 }}>
          <div>
            <div className="eyebrow">Choose option</div>
            <h2 style={{ margin: "2px 0 0", fontFamily: "var(--font-display)", fontSize: 24 }}>
              {item.name}
            </h2>
          </div>
          <button type="button" className="a-btn a-btn--ghost a-btn--sm" onClick={onClose}>x</button>
        </div>
        <div style={{ display: "grid", gap: 10 }}>
          {options.map((option) => (
            <button
              key={option.variationId}
              type="button"
              onClick={() => onPick(item, section, option)}
              style={{
                all: "unset",
                cursor: "pointer",
                border: "1.5px solid var(--ink-200)",
                borderRadius: 14,
                padding: "14px 16px",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                background: "var(--ink-0)",
              }}
            >
              <span style={{ fontWeight: 800, color: "var(--ink-800)" }}>{option.name}</span>
              <span className="display-num" style={{ fontSize: 20 }}>${Number(option.price || 0).toFixed(2)}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function SearchBar({ value, onChange }) {
  return (
    <div style={{
      display: "inline-flex", alignItems: "center", gap: 10,
      padding: "10px 14px", background: "#fff",
      border: "1.5px solid var(--ink-200)", borderRadius: 14,
      width: "clamp(240px, 30vw, 320px)", flexShrink: 0,
    }}>
      <Icon name="search" size={18} stroke={2} style={{ color: "var(--ink-500)" }} />
      <input
        value={value}
        onChange={(e) => onChange?.(e.target.value)}
        placeholder="Scan or search SKU, member, party..."
        style={{ all: "unset", flex: 1, fontSize: 14, color: "var(--ink-800)" }}
      />
      <kbd style={{ fontSize: 10, color: "var(--ink-500)", fontFamily: "var(--font-mono)", padding: "2px 6px", background: "var(--ink-50)", borderRadius: 4 }}>K</kbd>
    </div>
  );
}

ProductCard.displayName = "ProductCard";

// ── Voucher inclusions view ───────────────────────────────────────
// Renders when the catalog search detects a token-shaped query that
// resolves to a voucher / pack / entitlement. Replaces the catalog
// tiles. One tile per inclusion. Entitlements with remainingQty > 1
// get a quantity stepper before the Add button.
function VoucherInclusionsView({ searching, error, pack, inclusions, onAdd, onClear }) {
  const [qtyByUid, setQtyByUid] = React.useState({});

  if (searching) {
    return (
      <div style={{ padding: 60, textAlign: "center", color: "var(--ink-500)", fontWeight: 600 }}>
        Looking up voucher...
      </div>
    );
  }
  if (error) {
    return (
      <div style={{ padding: 60, textAlign: "center" }}>
        <div style={{ fontWeight: 800, color: "var(--ink-800)", marginBottom: 8 }}>
          Voucher not found
        </div>
        <div style={{ color: "var(--ink-500)", fontSize: 13, marginBottom: 16 }}>
          {error}
        </div>
        <button
          type="button"
          onClick={onClear}
          style={{
            cursor: "pointer", padding: "8px 16px", borderRadius: 10,
            border: "1.5px solid var(--ink-200)", background: "white",
            fontWeight: 700, color: "var(--ink-800)",
          }}
        >
          Clear search
        </button>
      </div>
    );
  }

  const packCtx = pack?.payload?.pack || pack?.payload || {};
  // Pack lookup nests guest under pack.guest; single-voucher lookup
  // puts it on payload root. Try both.
  const guestName =
    pack?.payload?.pack?.guest?.guestName ||
    pack?.payload?.guest?.guestName ||
    packCtx?.guest?.guestName ||
    null;

  return (
    <div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
        <h2 style={{ margin: 0, fontFamily: "var(--font-display)", fontWeight: 800, fontSize: 22, letterSpacing: "-.01em" }}>
          {packCtx?.name || "Voucher inclusions"}
        </h2>
        <span className="eyebrow">{inclusions.length} item{inclusions.length === 1 ? "" : "s"}</span>
        {guestName && (
          <span style={{ marginLeft: "auto", fontSize: 13, color: "var(--ink-600)" }}>
            Customer: <strong>{guestName}</strong>
          </span>
        )}
        <button
          type="button"
          onClick={onClear}
          style={{
            cursor: "pointer", padding: "4px 10px", borderRadius: 8,
            border: "1.5px solid var(--ink-200)", background: "white",
            fontSize: 11, fontWeight: 700, color: "var(--ink-700)",
            marginLeft: guestName ? 8 : "auto",
          }}
        >
          Back to catalog
        </button>
      </div>

      {/* Single-booking auto-add hint when the whole pack is just one
          inclusion. The cashier can still tap Add to confirm. */}
      {inclusions.length === 1 && inclusions[0].remainingQty > 0 && (
        <div style={{
          marginBottom: 14, padding: "10px 14px",
          background: "var(--aero-orange-50)", borderRadius: 12,
          color: "var(--aero-orange-700)", fontWeight: 700, fontSize: 13,
        }}>
          Single-booking voucher — tap Add to put it in the cart at $0.
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 14 }}>
        {inclusions.map((inc) => {
          const max = inc.remainingQty;
          const askQty = inc.kind === "entitlement" && (inc.originalQty || 0) > 1;
          const currentQty = qtyByUid[inc.uid] ?? 1;
          const setQty = (n) => setQtyByUid((prev) => ({ ...prev, [inc.uid]: Math.max(1, Math.min(max, n)) }));
          const usable = max > 0;
          return (
            <div
              key={inc.uid}
              style={{
                border: "1.5px solid var(--ink-200)", borderRadius: 14,
                padding: 14, background: usable ? "var(--ink-0)" : "var(--ink-50)",
                display: "flex", flexDirection: "column", gap: 10,
                opacity: usable ? 1 : 0.55,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <div style={{ fontSize: 11, fontWeight: 800, color: "var(--aero-orange-600)", textTransform: "uppercase", letterSpacing: 0.5 }}>
                  {inc.kind === "entitlement" ? "Pack credit" : "Voucher"}
                </div>
                {inc.requiresWaiver && (
                  <span
                    title="A signed waiver is required for this redemption."
                    style={{
                      fontSize: 10, fontWeight: 800, letterSpacing: 0.5,
                      padding: "2px 6px", borderRadius: 6, marginLeft: "auto",
                      background: "var(--aero-orange-50, #FFF3E6)",
                      color: "var(--aero-orange-700, #B85C00)",
                      border: "1px solid var(--aero-orange-200, #FFD6A8)",
                      textTransform: "uppercase",
                    }}
                  >
                    Waiver
                  </span>
                )}
              </div>
              <div style={{ fontWeight: 800, color: "var(--ink-900)", fontSize: 16, lineHeight: 1.2 }}>
                {inc.activityName}
              </div>
              {inc.variationName && inc.variationName !== inc.activityName && (
                <div style={{ fontSize: 12, color: "var(--ink-500)" }}>{inc.variationName}</div>
              )}
              <div style={{ fontSize: 12, color: "var(--ink-600)" }}>
                {inc.kind === "entitlement"
                  ? `${max}/${inc.originalQty} remaining`
                  : (usable ? `Status: ${inc.status}` : "Already redeemed")}
              </div>
              {usable && askQty && (
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <button
                    type="button"
                    onClick={() => setQty(currentQty - 1)}
                    disabled={currentQty <= 1}
                    style={{
                      cursor: currentQty <= 1 ? "default" : "pointer",
                      width: 32, height: 32, borderRadius: 8,
                      border: "1.5px solid var(--ink-200)", background: "white",
                      fontWeight: 700, color: "var(--ink-700)",
                    }}
                  >−</button>
                  <span style={{ minWidth: 28, textAlign: "center", fontWeight: 800, fontSize: 16 }}>{currentQty}</span>
                  <button
                    type="button"
                    onClick={() => setQty(currentQty + 1)}
                    disabled={currentQty >= max}
                    style={{
                      cursor: currentQty >= max ? "default" : "pointer",
                      width: 32, height: 32, borderRadius: 8,
                      border: "1.5px solid var(--ink-200)", background: "white",
                      fontWeight: 700, color: "var(--ink-700)",
                    }}
                  >+</button>
                  <span style={{ fontSize: 11, color: "var(--ink-500)" }}>max {max}</span>
                </div>
              )}
              <div style={{ flex: 1 }} />
              <button
                type="button"
                disabled={!usable}
                onClick={() => onAdd?.(inc, askQty ? currentQty : 1)}
                style={{
                  cursor: usable ? "pointer" : "default",
                  padding: "10px 14px", borderRadius: 10,
                  background: usable ? "var(--aero-orange-500, #FF8A00)" : "var(--ink-200)",
                  color: usable ? "white" : "var(--ink-500)",
                  fontWeight: 800, fontSize: 14, border: "none",
                }}
              >
                {usable ? `Add${askQty ? ` ${currentQty}` : ""} to cart · $0.00` : "Already redeemed"}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
