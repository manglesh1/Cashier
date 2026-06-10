// Subscription-billing actions for recurring memberships, surfaced at
// the counter through the Redeem screen's MembershipCard. Mirrors the
// admin's Members-drawer API (my-admin-app `features/memberships/
// membershipApi.js`) but only exposes the at-the-counter actions:
//
//   • getMembershipBilling(membershipId) → load the recurring profile so
//     we can badge "PAST DUE · $X owed" on the card. Returns null when
//     the membership has no subscription (one-time purchase) so the card
//     just renders without a badge.
//   • collectMemberPayment(profileId)  → in-venue "Collect now". Settles
//     a past-due open invoice on the spot. Backend invalidates the
//     membership cache; we re-fetch the billing query via tags so the
//     badge disappears after a successful collect.
//
// 404 with error "no_subscription" is the explicit "this membership has
// no recurring profile" signal — we map that to null in the
// transformResponse path so the UI doesn't render an error state.
import { baseApi } from "../../api/baseApi";

export const membershipBillingApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    getMembershipBilling: builder.query({
      query: (membershipId) => `/payments/subscriptions/by-membership/${membershipId}`,
      transformResponse: (response) => response?.member || null,
      // 404 + error="no_subscription" → null, not an error. Anything
      // else propagates so the caller can show a real failure state.
      transformErrorResponse: (response) => {
        if (response?.status === 404 && response?.data?.error === "no_subscription") {
          return { noSubscription: true };
        }
        return response;
      },
      providesTags: (result, error, membershipId) => [
        { type: "MembershipBilling", id: `m-${membershipId}` },
      ],
    }),

    collectMemberPayment: builder.mutation({
      query: (profileId) => ({
        url: `/payments/subscriptions/${profileId}/collect`,
        method: "POST",
        body: {},
      }),
      // The backend membership cache invalidation also flips the profile
      // status to active. Invalidate every billing query so any card on
      // screen (search results, multi-member family) refreshes.
      invalidatesTags: ["MembershipBilling"],
    }),
  }),
  overrideExisting: false,
});

export const {
  useGetMembershipBillingQuery,
  useCollectMemberPaymentMutation,
} = membershipBillingApi;
