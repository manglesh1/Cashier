import { baseApi } from "../../api/baseApi";

// Cashier-side endpoints for voucher_pack vouchers + entitlements.
// See aeroSportsAdmin/docs/design-voucher-pack.md.

export const voucherApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    // Look up a voucher (slot-bound BookingItem) or entitlement
    // (stock-item ledger row) by its base64url redemption token.
    // Returns { kind: "voucher" | "entitlement", ... }.
    lookupVoucherByToken: builder.query({
      query: (token) => ({ url: `/vouchers/by-token/${token}` }),
    }),
    // Same query, lazy form for scanner-driven flows that fire on Enter.
    lazyLookupVoucherByToken: builder.query({
      query: (token) => ({ url: `/vouchers/by-token/${token}` }),
    }),

    // Decrement a stock-item entitlement at the counter.
    redeemEntitlement: builder.mutation({
      query: ({ entitlementId, quantity = 1 }) => ({
        url: `/vouchers/entitlements/${entitlementId}/redeem`,
        method: "POST",
        body: { quantity },
      }),
    }),
  }),
});

export const {
  useLookupVoucherByTokenQuery,
  useLazyLookupVoucherByTokenQuery,
  useRedeemEntitlementMutation,
} = voucherApi;
