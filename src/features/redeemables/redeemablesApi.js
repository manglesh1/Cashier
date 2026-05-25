import { baseApi } from "../../api/baseApi";

// Unified scan resolver. One call resolves ANY code (gate ticket, voucher,
// voucher-pack constituent, stock entitlement) to { context, redeemables[] }.
// Each redeemable declares an action the cashier dispatches via actRedeemable.
export const redeemablesApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    resolveCode: builder.query({
      query: (code) => ({ url: `/redeemables/resolve/${encodeURIComponent(code)}` }),
      transformResponse: (resp) => resp?.data || null,
      providesTags: ["Redemption"],
    }),
  }),
});

export const { useLazyResolveCodeQuery } = redeemablesApi;
