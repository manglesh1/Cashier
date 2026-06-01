// UniversalSearch — single input at the top of the Sell screen that
// resolves anything the cashier types or scans:
//
//   • Voucher / entitlement token  → expand pack into cart
//   • (Phase 2) gift card prefix   → apply at payment time
//   • (Phase 2) email / phone      → attach guest
//   • (Phase 2) catalog SKU        → add to cart
//
// Phase 1 only handles voucher / voucher pack tokens. Everything else
// is intentionally a no-op so this can ship without touching the
// catalog or guest plumbing. The existing Voucher Counter screen
// stays as a scanner-first fallback for "no cart open" workflows.
//
// Wire-level: uses the existing GET /api/vouchers/by-token/:token
// (returns { kind, ... }) and GET /api/vouchers/pack/by-token/:token
// (returns the whole pack with inclusions). No backend changes.

import React, { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Icon } from "./Icon";
import {
  useLazyLookupVoucherByTokenQuery,
  useLazyLookupVoucherPackByTokenQuery,
} from "../../features/vouchers/voucherApi";

const DEBOUNCE_MS = 300;
const MIN_QUERY_CHARS = 6; // most redemption tokens are ≥ 8 chars

// Tokens we issue look like base64url -- letters, digits, hyphen,
// underscore. We use this only to suppress lookups for "obviously
// not a code" strings (e.g. spaces, punctuation). The backend is
// still the source of truth.
const TOKEN_SHAPE = /^[A-Za-z0-9_-]+$/;

export default function UniversalSearch({ onAddVoucherToCart }) {
  const [query, setQuery] = useState("");
  const [result, setResult] = useState(null); // { kind, payload } | { error } | null
  const [searching, setSearching] = useState(false);
  const inputRef = useRef(null);
  const debounceRef = useRef(null);

  const [lookupVoucher] = useLazyLookupVoucherByTokenQuery();
  const [lookupPack] = useLazyLookupVoucherPackByTokenQuery();

  // Auto-focus on mount so scanner-flow works ("scan opens Sell screen
  // → code drops straight into the input").
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Debounced lookup. Two-step: try pack-by-token first (whole-pack
  // shape is more useful when a code is part of a multi-item pack),
  // fall back to single voucher/entitlement lookup if no pack.
  useEffect(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }
    const trimmed = query.trim();
    if (!trimmed || trimmed.length < MIN_QUERY_CHARS || !TOKEN_SHAPE.test(trimmed)) {
      setResult(null);
      setSearching(false);
      return;
    }
    setSearching(true);
    debounceRef.current = setTimeout(async () => {
      try {
        // 1. Pack lookup: returns the whole pack's inclusions if the
        //    code belongs to one. Best shape for "expand into cart".
        const packRes = await lookupPack(trimmed).unwrap().catch(() => null);
        if (packRes?.data) {
          setResult({ kind: "pack", payload: packRes.data });
          setSearching(false);
          return;
        }
        // 2. Single voucher / entitlement lookup.
        const single = await lookupVoucher(trimmed).unwrap();
        if (single?.data) {
          setResult({ kind: single.data.kind || "unknown", payload: single.data });
        } else {
          setResult({ error: "No voucher matches that code." });
        }
      } catch (err) {
        const status = err?.status;
        if (status === 404) {
          setResult({ error: "No voucher matches that code." });
        } else {
          setResult({ error: err?.data?.message || "Lookup failed." });
        }
      } finally {
        setSearching(false);
      }
    }, DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, lookupVoucher, lookupPack]);

  const handleClear = () => {
    setQuery("");
    setResult(null);
    inputRef.current?.focus();
  };

  const handleAddToCart = (item) => {
    if (!onAddVoucherToCart) {
      toast.error("Cart wiring not connected yet.");
      return;
    }
    onAddVoucherToCart(item);
    toast.success("Added to cart");
    handleClear();
  };

  return (
    <div className="mb-3">
      <div className="relative">
        <div className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
          <Icon name="search" size={16} />
        </div>
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search or scan voucher, gift card, membership, customer..."
          className="w-full rounded-lg border border-gray-200 bg-white py-3 pl-10 pr-10 text-sm outline-none focus:border-orange-400"
          aria-label="Universal search"
          autoComplete="off"
          spellCheck={false}
        />
        {query && (
          <button
            type="button"
            onClick={handleClear}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
            aria-label="Clear search"
          >
            <Icon name="x" size={16} />
          </button>
        )}
      </div>

      {/* Result card */}
      {(searching || result) && (
        <div className="mt-2 rounded-lg border border-gray-200 bg-white shadow-sm">
          {searching ? (
            <div className="px-3 py-3 text-sm text-gray-500">Searching...</div>
          ) : result?.error ? (
            <div className="px-3 py-3 text-sm text-gray-500">{result.error}</div>
          ) : result?.kind === "pack" ? (
            <PackResult pack={result.payload} onAddToCart={handleAddToCart} />
          ) : result?.kind === "voucher" || result?.kind === "entitlement" ? (
            <SingleVoucherResult kind={result.kind} item={result.payload} onAddToCart={handleAddToCart} />
          ) : null}
        </div>
      )}
    </div>
  );
}

function PackResult({ pack, onAddToCart }) {
  const inclusions = [
    ...(pack.vouchers || []).map((v) => ({
      kind: "voucher",
      activityName: v.activityName || v.activity?.name || "—",
      quantity: 1,
      status: v.status,
      bookingItemId: v.bookingItemId,
      remainingQty: v.status === "active" ? 1 : 0,
    })),
    ...(pack.entitlements || []).map((e) => ({
      kind: "entitlement",
      activityName: e.activityName || e.activity?.name || "—",
      quantity: e.remainingQty,
      originalQty: e.originalQty,
      status: e.status,
      entitlementId: e.entitlementId,
      remainingQty: e.remainingQty,
    })),
  ];
  const hasRedeemable = inclusions.some((i) => i.remainingQty > 0);
  return (
    <div className="px-3 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-xs font-bold uppercase tracking-wide text-orange-600">
            Voucher pack
          </div>
          <div className="mt-0.5 text-sm font-semibold text-gray-900 truncate">
            {pack.pack?.name || "Voucher pack"}
          </div>
          {pack.pack?.bookingNumber && (
            <div className="text-xs text-gray-500">
              Booking {pack.pack.bookingNumber}
            </div>
          )}
        </div>
        {hasRedeemable && (
          <button
            type="button"
            onClick={() => onAddToCart({ kind: "pack", pack, inclusions })}
            className="rounded-md bg-orange-500 px-3 py-1.5 text-xs font-bold text-white hover:bg-orange-600"
          >
            Add all to cart
          </button>
        )}
      </div>
      <ul className="mt-2 divide-y divide-gray-100">
        {inclusions.map((inc, i) => (
          <li key={i} className="flex items-center justify-between gap-3 py-1.5">
            <div className="min-w-0 flex-1">
              <div className="text-xs font-medium text-gray-900 truncate">
                {inc.activityName}
              </div>
              <div className="text-[10px] text-gray-500">
                {inc.kind === "entitlement"
                  ? `${inc.remainingQty}/${inc.originalQty} remaining`
                  : `1 × · ${inc.status}`}
              </div>
            </div>
            {inc.remainingQty > 0 ? (
              <button
                type="button"
                onClick={() => onAddToCart({ kind: inc.kind, item: inc })}
                className="rounded border border-orange-300 px-2 py-0.5 text-[10px] font-bold text-orange-600 hover:bg-orange-50"
              >
                Add
              </button>
            ) : (
              <span className="text-[10px] text-gray-400">Used</span>
            )}
          </li>
        ))}
      </ul>
      {!hasRedeemable && (
        <div className="mt-2 rounded bg-gray-50 px-2 py-1 text-[10px] text-gray-500">
          Nothing left to redeem on this pack.
        </div>
      )}
    </div>
  );
}

function SingleVoucherResult({ kind, item, onAddToCart }) {
  const remaining = kind === "entitlement" ? item.remainingQty : item.status === "active" ? 1 : 0;
  return (
    <div className="px-3 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-xs font-bold uppercase tracking-wide text-orange-600">
            {kind === "entitlement" ? "Voucher entitlement" : "Voucher"}
          </div>
          <div className="mt-0.5 text-sm font-semibold text-gray-900 truncate">
            Activity #{item.activityId || item.variationId || "—"}
          </div>
          <div className="text-xs text-gray-500">
            {kind === "entitlement"
              ? `${remaining}/${item.originalQty} remaining`
              : `Status: ${item.status}`}
          </div>
        </div>
        {remaining > 0 ? (
          <button
            type="button"
            onClick={() => onAddToCart({ kind, item })}
            className="rounded-md bg-orange-500 px-3 py-1.5 text-xs font-bold text-white hover:bg-orange-600"
          >
            Add to cart
          </button>
        ) : (
          <span className="text-xs text-gray-400">No remaining balance</span>
        )}
      </div>
    </div>
  );
}
