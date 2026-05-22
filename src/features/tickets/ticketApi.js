import { baseApi } from "../../api/baseApi";

export const ticketApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    // Booking-scoped reads
    getBookingTickets: builder.query({
      query: (bookingId) => `/bookings/${bookingId}/tickets`,
      providesTags: (result, error, id) => [{ type: "Tickets", id }],
    }),

    // Mint missing tickets for a booking (idempotent)
    issueTickets: builder.mutation({
      query: ({ bookingId, force = false }) => ({
        url: `/bookings/${bookingId}/tickets`,
        method: "POST",
        body: { force },
      }),
      invalidatesTags: (result, error, { bookingId }) => [
        { type: "Tickets", id: bookingId },
      ],
    }),

    regenerateTicketCodes: builder.mutation({
      query: ({ bookingId }) => ({
        url: `/bookings/${bookingId}/tickets/regenerate-codes`,
        method: "POST",
      }),
      invalidatesTags: (result, error, { bookingId }) => [
        { type: "Tickets", id: bookingId },
      ],
    }),

    checkInAllTickets: builder.mutation({
      query: ({ bookingId, terminalDeviceId, gateOrZone, allowEarlyCheckIn = false }) => ({
        url: `/bookings/${bookingId}/tickets/check-in-all`,
        method: "POST",
        body: { terminalDeviceId, gateOrZone, allowEarlyCheckIn },
      }),
      invalidatesTags: (result, error, { bookingId }) => [
        { type: "Tickets", id: bookingId },
        { type: "Booking", id: bookingId },
      ],
    }),

    // Scanner / lookup (no booking context required)
    getTicketByCode: builder.query({
      query: (ticketCode) => `/tickets/${ticketCode}`,
    }),

    // Recent redemptions feed — authoritative "Recent activity" (survives
    // refresh, shared across terminals). locationId is auto-injected by
    // baseApi; pass deviceId to narrow to this terminal.
    getRecentRedemptions: builder.query({
      query: ({ deviceId, limit = 20 } = {}) => ({
        url: "/tickets/redemptions/recent",
        params: { ...(deviceId ? { deviceId } : {}), limit },
      }),
      transformResponse: (resp) => resp?.data || [],
      providesTags: ["Redemption"],
    }),

    // Redemption — single ticket scan
    redeemTicket: builder.mutation({
      query: ({ ticketCode, terminalDeviceId, gateOrZone, notes, managerOverride, allowEarlyCheckIn = false }) => ({
        url: `/tickets/${ticketCode}/redeem`,
        method: "POST",
        body: { terminalDeviceId, gateOrZone, notes, managerOverride, allowEarlyCheckIn },
      }),
      invalidatesTags: (result) => {
        const tags = ["Redemption"];
        if (result?.data?.bookingId) tags.push({ type: "Tickets", id: result.data.bookingId });
        return tags;
      },
    }),

    voidTicket: builder.mutation({
      query: ({ ticketId, reason, managerOverride }) => ({
        url: `/tickets/${ticketId}/void`,
        method: "POST",
        body: { reason, managerOverride },
      }),
      invalidatesTags: (result) => {
        if (!result?.data?.bookingId) return ["Tickets"];
        return [{ type: "Tickets", id: result.data.bookingId }];
      },
    }),

    // Cashier picks an existing booking participant as this ticket's holder
    bindTicketHolder: builder.mutation({
      query: ({ ticketCode, participantId }) => ({
        url: `/tickets/${ticketCode}/bind`,
        method: "POST",
        body: { participantId },
      }),
      invalidatesTags: (result, error, { bookingId }) => [
        { type: "Tickets", id: bookingId },
        { type: "CheckIn", id: bookingId },
      ],
    }),
  }),
});

export const {
  useGetBookingTicketsQuery,
  useIssueTicketsMutation,
  useRegenerateTicketCodesMutation,
  useCheckInAllTicketsMutation,
  useGetTicketByCodeQuery,
  useLazyGetTicketByCodeQuery,
  useGetRecentRedemptionsQuery,
  useRedeemTicketMutation,
  useVoidTicketMutation,
  useBindTicketHolderMutation,
} = ticketApi;
