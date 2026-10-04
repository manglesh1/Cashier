import { baseApi } from "../../api/baseApi";

// Provider-neutral card-present, server-driven flow.
//
//   readers → assigned/shared readers for the current POS station.
//   start  → backend starts collection on the selected internal terminalId.
//   status → poll until status is 'captured' (approved) or terminal-failed.
//   cancel → cancel the reader's in-flight action.
//
// All location-scoped: baseApi auto-injects locationId, but /start also
// needs it in the BODY (PaymentService reads ctx.locationId) — the caller
// supplies it explicitly.
export const terminalApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    getTerminalReaders: builder.query({
      query: ({ posDeviceId, currency }) => ({ url: "/payments/terminal/readers", params: { posDeviceId, currency } }),
      keepUnusedDataFor: 0,
    }),
    recoverTerminalCheckout: builder.query({
      query: (key) => ({ url: "/payments/terminal/checkout", params: { key } }),
    }),
    startTerminalPayment: builder.mutation({
      query: (body) => ({
        url: "/payments/terminal/start",
        method: "POST",
        body,
      }),
    }),
    getTerminalStatus: builder.query({
      query: (transactionId) => `/payments/terminal/${transactionId}/status`,
    }),
    cancelTerminalPayment: builder.mutation({
      query: ({ transactionId, reason }) => ({
        url: `/payments/terminal/${transactionId}/cancel`,
        method: "POST",
        body: { reason },
      }),
    }),
  }),
});

export const {
  useGetTerminalReadersQuery,
  useLazyRecoverTerminalCheckoutQuery,
  useStartTerminalPaymentMutation,
  useLazyGetTerminalStatusQuery,
  useCancelTerminalPaymentMutation,
} = terminalApi;
