// Unified benefits API. Single surface for every benefit type
// (promo / member / gift_card / voucher / entitlement / and future
// manager / comp / employee / store_credit).
//
// Why this exists when discountApi + voucherApi already work:
//   • One response shape across all types → one display component
//   • Cross-type stacking rules enforced backend-side
//   • Single audit-write choke point on apply
//   • New types drop in server-side with no frontend changes
//
// Existing per-type endpoints stay live; existing panels can migrate
// at their own pace. New flows (kiosk, mobile, customer-portal benefit
// entry) should use these from day one.

import { baseApi } from "../../api/baseApi";

export const benefitsApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    // Validate any benefit type. Returns the normalized shape:
    //   { ok, type, unit, amount, label, sourceId, sourceCode, reason, metadata }
    //
    // Args: { type, code, context, alreadyApplied }
    //   type:           'promo' | 'member' | 'gift_card' | 'voucher' | 'entitlement'
    //   code:           promo code / gift card number / voucher token / null (for member)
    //   context:        { cartLines, subtotalAmount, guestId, bookingId?, pin?, amount? }
    //   alreadyApplied: [{type, ...}, …]  — for stacking-rule check
    validateBenefit: builder.mutation({
      query: (body) => ({
        url: "/benefits/validate",
        method: "POST",
        body,
      }),
    }),

    // Apply a benefit to a booking. Writes the audit row + runs the
    // type's side effects (gift card debit, entitlement decrement, …)
    // inside one transaction.
    //
    // Args: { type, code, context: {bookingId, ...}, reason }
    applyBenefit: builder.mutation({
      query: (body) => ({
        url: "/benefits/apply",
        method: "POST",
        body,
      }),
    }),

    // Reverse an applied benefit by its benefitApplicationId.
    revokeBenefit: builder.mutation({
      query: ({ id, reason = null }) => ({
        url: `/benefits/${id}/revoke`,
        method: "POST",
        body: { reason },
      }),
    }),

    // Server-computed voucher coverage preview for the cashier cart.
    // Sends applied voucher tokens + cart lines, returns per-token
    // coverage + total $ to subtract from outstanding. Same utility
    // runs on createBooking, so preview and submit math agree.
    previewVoucherCoverage: builder.mutation({
      query: (body) => ({
        url: "/benefits/preview-voucher-coverage",
        method: "POST",
        body,
      }),
    }),

    // Cross-type audit listing. Filters: type, sourceId, sourceCode,
    // bookingId, unit, from, to, actorUserId. Returns paginated rows.
    listBenefitApplications: builder.query({
      query: (params = {}) => ({
        url: "/benefit-applications",
        method: "GET",
        params,
      }),
    }),
  }),
});

export const {
  useValidateBenefitMutation,
  useApplyBenefitMutation,
  useRevokeBenefitMutation,
  usePreviewVoucherCoverageMutation,
  useListBenefitApplicationsQuery,
  useLazyListBenefitApplicationsQuery,
} = benefitsApi;
