// Cashier-side discount API — only the validate endpoint is needed.
// Mirrors how admin's PaymentTab uses the same endpoint.

import { baseApi } from "../../api/baseApi";

export const discountApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    validateDiscountCode: builder.query({
      query: (request) => {
        const payload = typeof request === "string" ? { code: request } : request || {};
        const code = String(payload.code || "").trim();
        const hasPricingContext =
          Number(payload.subtotalAmount || 0) > 0 ||
          (Array.isArray(payload.cartLines) && payload.cartLines.length > 0);
        if (!hasPricingContext) {
          return `/promos/validate/${encodeURIComponent(code)}?channel=POS`;
        }
        return {
          url: `/promos/validate/${encodeURIComponent(code)}?channel=POS`,
          method: "POST",
          body: {
            subtotalAmount: payload.subtotalAmount || 0,
            cartLines: payload.cartLines || [],
            channel: "POS",
          },
        };
      },
    }),
  }),
});

export const {
  useValidateDiscountCodeQuery,
  useLazyValidateDiscountCodeQuery,
} = discountApi;
