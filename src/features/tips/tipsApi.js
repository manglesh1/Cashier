import { baseApi } from "../../api/baseApi";

// Tip endpoints (backend routes/tips). The in-checkout tip is recorded as
// a dedicated `tips`-table row (NOT a PaymentTransaction) via `standaloneTip`,
// so the payment hot path is untouched and Booking totals never include
// tip. `overrideAllowed` is a pre-check the Tip step uses to know whether
// a manager PIN is required before the cashier self-assigns a host tip.

export const tipsApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    // POST /api/tips/override-allowed → { requiresManagerCode }
    checkTipOverride: builder.mutation({
      query: (body) => ({
        url: "/tips/override-allowed",
        method: "POST",
        body,
      }),
    }),
    // POST /api/tips/standalone → creates a tip-only transaction.
    standaloneTip: builder.mutation({
      query: (body) => ({
        url: "/tips/standalone",
        method: "POST",
        body,
      }),
      invalidatesTags: (result, error, { bookingId }) =>
        bookingId ? [{ type: "Booking", id: bookingId }] : [],
    }),
  }),
});

export const {
  useCheckTipOverrideMutation,
  useStandaloneTipMutation,
} = tipsApi;
