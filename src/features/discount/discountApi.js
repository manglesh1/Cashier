// Cashier-side discount API — only the validate endpoint is needed.
// Mirrors how admin's PaymentTab uses the same endpoint.

import { baseApi } from "../../api/baseApi";

export const discountApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    validateDiscountCode: builder.query({
      query: (code) => `/promos/validate/${encodeURIComponent(code)}`,
    }),
  }),
});

export const {
  useValidateDiscountCodeQuery,
  useLazyValidateDiscountCodeQuery,
} = discountApi;
