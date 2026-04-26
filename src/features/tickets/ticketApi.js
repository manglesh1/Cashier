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
      query: ({ bookingId, terminalDeviceId, gateOrZone }) => ({
        url: `/bookings/${bookingId}/tickets/check-in-all`,
        method: "POST",
        body: { terminalDeviceId, gateOrZone },
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

    // Redemption — single ticket scan
    redeemTicket: builder.mutation({
      query: ({ ticketCode, terminalDeviceId, gateOrZone, notes, managerOverride }) => ({
        url: `/tickets/${ticketCode}/redeem`,
        method: "POST",
        body: { terminalDeviceId, gateOrZone, notes, managerOverride },
      }),
      invalidatesTags: (result) => {
        if (!result?.data?.bookingId) return [];
        return [{ type: "Tickets", id: result.data.bookingId }];
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
  }),
});

export const {
  useGetBookingTicketsQuery,
  useIssueTicketsMutation,
  useRegenerateTicketCodesMutation,
  useCheckInAllTicketsMutation,
  useGetTicketByCodeQuery,
  useLazyGetTicketByCodeQuery,
  useRedeemTicketMutation,
  useVoidTicketMutation,
} = ticketApi;
