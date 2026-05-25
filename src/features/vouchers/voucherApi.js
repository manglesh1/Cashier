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

    // Resolve any constituent token to the WHOLE pack's inclusions
    // (schedulable vouchers + stock entitlements) for the one-screen flow.
    // Returns { kind: "pack", pack, vouchers[], entitlements[] }.
    lookupVoucherPackByToken: builder.query({
      query: (token) => ({ url: `/vouchers/pack/by-token/${token}` }),
    }),

    // Bind an unbound voucher (schedulable inclusion) to a slot — reduces the
    // slot's capacity server-side. Used by the auto-nearest-slot redeem.
    scheduleVoucher: builder.mutation({
      query: ({ bookingItemId, slotId }) => ({
        url: `/vouchers/${bookingItemId}/schedule`,
        method: "POST",
        body: { slotId },
      }),
      invalidatesTags: ["Redemption"],
    }),

    // Decrement a stock-item entitlement at the counter.
    redeemEntitlement: builder.mutation({
      query: ({ entitlementId, quantity = 1 }) => ({
        url: `/vouchers/entitlements/${entitlementId}/redeem`,
        method: "POST",
        body: { quantity },
      }),
      invalidatesTags: ["Redemption"],
    }),

    // Membership scan + redeem (digital-pass flow).
    redeemMembership: builder.mutation({
      query: ({ membershipId, activityId = null }) => ({
        url: `/memberships/${membershipId}/redeem`,
        method: "POST",
        body: { activityId },
      }),
    }),

    // Gift card lookup + redeem (apply-at-checkout flow).
    lookupGiftCard: builder.query({
      query: ({ code, pin = null }) => ({
        url: "/gift-cards/lookup",
        params: pin ? { code, pin } : { code },
      }),
    }),
    redeemGiftCard: builder.mutation({
      query: (body) => ({
        url: "/gift-cards/redeem",
        method: "POST",
        body,
      }),
    }),
  }),
});

export const {
  useLookupVoucherByTokenQuery,
  useLazyLookupVoucherByTokenQuery,
  useLazyLookupVoucherPackByTokenQuery,
  useScheduleVoucherMutation,
  useRedeemEntitlementMutation,
  useRedeemMembershipMutation,
  useLazyLookupGiftCardQuery,
  useRedeemGiftCardMutation,
} = voucherApi;
