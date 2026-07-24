import { baseApi } from "../../api/baseApi";

export const bookingApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    getAllBooking: builder.query({
      query: ({ page = 1, limit = 50, search = "", dateFrom = "", dateTo = "", status = [], paymentStatus = [], activityId = [] }) => ({
        url: "/bookings/all",
        params: {
          page,
          limit,
          search,
          dateFrom,
          dateTo,
          status: Array.isArray(status) ? status.join(",") : status,
          paymentStatus: Array.isArray(paymentStatus) ? paymentStatus.join(",") : paymentStatus,
          activityId: Array.isArray(activityId) ? activityId.join(",") : activityId,
        },
      }),
      providesTags: ["Bookings"],
    }),
    getBookingById: builder.query({
      query: (id) => `/bookings/${id}`,
      providesTags: (result, error, id) => [{ type: "Booking", id }],
    }),
    searchGuests: builder.query({
      query: (query) => `/bookings/search-guest?query=${encodeURIComponent(query)}`,
    }),
    searchBookingSuggestions: builder.query({
      query: ({ query = "", limit = 12, dateFrom = "", dateTo = "", status = [], paymentStatus = [] } = {}) => ({
        url: "/bookings/search-suggestions",
        params: {
          query,
          limit,
          dateFrom,
          dateTo,
          status: Array.isArray(status) ? status.join(",") : status,
          paymentStatus: Array.isArray(paymentStatus) ? paymentStatus.join(",") : paymentStatus,
        },
      }),
    }),
    createBooking: builder.mutation({
      // Idempotency-Key: a client-generated UUID passed by the cashier flow
      // (see CashierApp.handleCheckout). Retrying the same checkout after a
      // network hiccup carries the same key so the backend can dedupe and
      // return the original booking instead of creating a second one. The
      // key is stripped from the body before sending.
      query: ({ idempotencyKey, ...body } = {}) => ({
        url: "/bookings",
        method: "POST",
        body,
        headers: idempotencyKey ? { "Idempotency-Key": idempotencyKey } : undefined,
      }),
      invalidatesTags: ["Bookings"],
    }),
    // Same-day re-slot of a late arrival's session tickets.
    reslotBooking: builder.mutation({
      query: ({ bookingId, slotId }) => ({
        url: `/bookings/${bookingId}/reslot`,
        method: "POST",
        body: { slotId },
      }),
      invalidatesTags: (result, error, { bookingId }) => [
        { type: "Booking", id: bookingId },
        { type: "CheckIn", id: bookingId },
        { type: "Tickets", id: bookingId },
        "Bookings",
        "Availability",
      ],
    }),
    getAvailability: builder.query({
      query: ({ date, activityId }) => ({
        url: "/bookings/availability/sessions",
        params: { date, activityId },
      }),
      providesTags: ["Availability"],
    }),
    validateCart: builder.mutation({
      query: (body) => ({ url: "/bookings/validate-cart", method: "POST", body }),
    }),
    sendBookingConfirmation: builder.mutation({
      query: (body) => ({ url: "/payment/send-booking-confirmation", method: "POST", body }),
    }),
    recordPayment: builder.mutation({
      // See createBooking for the Idempotency-Key contract. For payment
      // record the key is even more important: a duplicate POST would
      // double-charge the booking's balance.
      query: ({ bookingId, idempotencyKey, ...body }) => ({
        url: `/payment/manual-payment/${bookingId}`,
        method: "POST",
        body,
        headers: idempotencyKey ? { "Idempotency-Key": idempotencyKey } : undefined,
      }),
      invalidatesTags: (result, error, { bookingId }) => [
        { type: "Booking", id: bookingId },
        { type: "CheckIn", id: bookingId },
        "Bookings",
      ],
    }),
    refundPayment: builder.mutation({
      query: ({ bookingId, idempotencyKey, ...body }) => ({
        url: `/payments/refund-requests`,
        method: "POST",
        body: {
          ...body,
          bookingId,
          sourceType: "booking",
          sourceId: bookingId,
          origin: "pos",
        },
        headers: {
          "Idempotency-Key": idempotencyKey || crypto.randomUUID(),
        },
      }),
      invalidatesTags: (result, error, { bookingId }) => [
        { type: "Booking", id: bookingId },
        "Bookings",
      ],
    }),
    getRefundPreview: builder.query({
      query: ({ bookingId, amount, cancelWhenCompleted, resolutionMethod } = {}) => ({
        url: "/payments/refund-requests/preview",
        params: {
          sourceType: "booking",
          sourceId: bookingId,
          bookingId,
          amount,
          cancelWhenCompleted: cancelWhenCompleted || undefined,
          resolutionMethod: resolutionMethod || "original_tender",
        },
      }),
    }),
    getRefundRequest: builder.query({
      query: (refundRequestId) => `/payments/refund-requests/${refundRequestId}`,
    }),

    // ── Card-on-terminal flow (Phase 4b) ─────────────────────────────
    // recordPayment with paymentMethod='card' returns
    //   { status: 'pending', transactionId, terminalSessionId }.
    // The cashier UI then polls getTerminalPaymentStatus every 1s until
    // it lands in a final state (captured | failed | cancelled), or
    // calls cancelTerminalPayment if the customer walks away.
    getTerminalPaymentStatus: builder.query({
      query: (transactionId) => `/payments/terminal/${transactionId}/status`,
      // Polling interval is set by the consumer via the hook options.
    }),
    cancelTerminalPayment: builder.mutation({
      query: ({ transactionId, reason }) => ({
        url: `/payments/terminal/${transactionId}/cancel`,
        method: "POST",
        body: { reason: reason || "cashier_cancel" },
      }),
      invalidatesTags: (result, error, { bookingId }) =>
        bookingId
          ? [{ type: "Booking", id: bookingId }, "Bookings"]
          : ["Bookings"],
    }),

    // Per-participant check-in roster + actions.
    getCheckInStatus: builder.query({
      query: (bookingId) => `/bookings/${bookingId}/check-in-status`,
      providesTags: (result, error, id) => [{ type: "CheckIn", id }],
    }),
    checkInParticipants: builder.mutation({
      query: ({ bookingId, participantIds, wristbandAssignments = [] }) => ({
        url: `/bookings/${bookingId}/check-in`,
        method: "POST",
        body: { participantIds, wristbandAssignments },
      }),
      invalidatesTags: (result, error, { bookingId }) => [
        { type: "CheckIn", id: bookingId },
        { type: "Tickets", id: bookingId },
        { type: "Booking", id: bookingId },
      ],
    }),
    undoParticipantCheckIn: builder.mutation({
      query: ({ bookingId, participantId }) => ({
        url: `/bookings/${bookingId}/participants/${participantId}/undo-check-in`,
        method: "POST",
      }),
      invalidatesTags: (result, error, { bookingId }) => [
        { type: "CheckIn", id: bookingId },
        { type: "Tickets", id: bookingId },
        { type: "Booking", id: bookingId },
      ],
    }),
    upsertParticipants: builder.mutation({
      query: ({ bookingId, participants }) => ({
        url: `/bookings/${bookingId}/participants/upsert`,
        method: "POST",
        body: { participants },
      }),
      invalidatesTags: (result, error, { bookingId }) => [
        { type: "CheckIn", id: bookingId },
        { type: "Tickets", id: bookingId },
        { type: "Booking", id: bookingId },
      ],
    }),
    // Lookup signed waivers in this location (cashier search modal)
    searchWaivers: builder.query({
      query: ({ search = "", limit = 12, page = 1, status = "active", contactOnly = false, sortBy, sortDir } = {}) => ({
        url: "/waivers/holders",
        params: {
          search,
          limit,
          page,
          status,
          contactOnly: contactOnly ? 1 : undefined,
          sortBy,
          sortDir,
        },
      }),
    }),
    getSignedWaiver: builder.query({
      query: (signatureId) => `/waivers/signed/${signatureId}`,
    }),
    getWaiverDefinition: builder.query({
      query: (waiverId) => `/waivers/${waiverId}`,
    }),
    linkParticipantFromWaiver: builder.mutation({
      // people (optional): ["signer", "minor:0", ...] — link only those.
      // Omit to keep legacy behaviour (signer + includeMinors).
      query: ({ bookingId, waiverSignatureId, includeMinors = true, people }) => ({
        url: `/bookings/${bookingId}/participants/from-waiver`,
        method: "POST",
        body: { waiverSignatureId, includeMinors, ...(people ? { people } : {}) },
      }),
      invalidatesTags: (result, error, { bookingId }) => [
        { type: "CheckIn", id: bookingId },
        { type: "Tickets", id: bookingId },
        { type: "Booking", id: bookingId },
      ],
    }),
    removeParticipant: builder.mutation({
      query: ({ bookingId, participantId }) => ({
        url: `/bookings/${bookingId}/participants/${participantId}`,
        method: "DELETE",
      }),
      invalidatesTags: (result, error, { bookingId }) => [
        { type: "CheckIn", id: bookingId },
        { type: "Tickets", id: bookingId },
        { type: "Booking", id: bookingId },
      ],
    }),
    getOrderAdjustmentCatalog: builder.query({
      query: ({ bookingId, search = "" }) => ({
        url: `/bookings/${bookingId}/order-adjustments/catalog`,
        params: search ? { search } : {},
      }),
    }),
    adjustBookingOrder: builder.mutation({
      query: ({ bookingId, ...body }) => ({
        url: `/bookings/${bookingId}/order-adjustments`,
        method: "POST",
        body,
      }),
      invalidatesTags: (result, error, { bookingId }) => [
        { type: "CheckIn", id: bookingId },
        { type: "Tickets", id: bookingId },
        { type: "Booking", id: bookingId },
        "Bookings",
      ],
    }),
  }),
});

export const {
  useGetAllBookingQuery,
  useGetBookingByIdQuery,
  useSearchGuestsQuery,
  useLazySearchGuestsQuery,
  useLazySearchBookingSuggestionsQuery,
  useCreateBookingMutation,
  useReslotBookingMutation,
  useGetAvailabilityQuery,
  useLazyGetAvailabilityQuery,
  useValidateCartMutation,
  useSendBookingConfirmationMutation,
  useRecordPaymentMutation,
  useRefundPaymentMutation,
  useGetRefundPreviewQuery,
  useGetRefundRequestQuery,
  useGetTerminalPaymentStatusQuery,
  useCancelTerminalPaymentMutation,
  useGetCheckInStatusQuery,
  useCheckInParticipantsMutation,
  useUndoParticipantCheckInMutation,
  useUpsertParticipantsMutation,
  useSearchWaiversQuery,
  useLazySearchWaiversQuery,
  useGetSignedWaiverQuery,
  useGetWaiverDefinitionQuery,
  useLinkParticipantFromWaiverMutation,
  useRemoveParticipantMutation,
  useGetOrderAdjustmentCatalogQuery,
  useAdjustBookingOrderMutation,
} = bookingApi;
