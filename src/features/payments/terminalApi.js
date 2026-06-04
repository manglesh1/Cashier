import { baseApi } from "../../api/baseApi";

// Stripe Terminal (card-present) — server-driven flow.
//
//   start  → backend creates a PaymentIntent and tells the reader to
//            collect. Returns { transaction, status:'processing', readerId }.
//            We don't pass a readerId — the backend resolves the venue's
//            configured reader (Payments → Card terminals).
//   status → poll until status is 'captured' (approved) or terminal-failed.
//   cancel → cancel the reader's in-flight action.
//
// All location-scoped: baseApi auto-injects locationId, but /start also
// needs it in the BODY (PaymentService reads ctx.locationId) — the caller
// supplies it explicitly.
export const terminalApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
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
  useStartTerminalPaymentMutation,
  useLazyGetTerminalStatusQuery,
  useCancelTerminalPaymentMutation,
} = terminalApi;
