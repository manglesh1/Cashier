import { baseApi } from "../../api/baseApi";

export const ticketApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    // Booking-scoped reads
    getBookingTickets: builder.query({
      query: (bookingMasterId) => `/reservations/${bookingMasterId}/tickets`,
      providesTags: (result, error, id) => [{ type: "Tickets", id }],
    }),

    // Mint missing tickets for a booking (idempotent)
    issueTickets: builder.mutation({
      query: ({ bookingMasterId, force = false }) => ({
        url: `/reservations/${bookingMasterId}/tickets`,
        method: "POST",
        body: { force },
      }),
      invalidatesTags: (result, error, { bookingMasterId }) => [
        { type: "Tickets", id: bookingMasterId },
      ],
    }),

    regenerateTicketCodes: builder.mutation({
      query: ({ bookingMasterId }) => ({
        url: `/reservations/${bookingMasterId}/tickets/regenerate-codes`,
        method: "POST",
      }),
      invalidatesTags: (result, error, { bookingMasterId }) => [
        { type: "Tickets", id: bookingMasterId },
      ],
    }),

    checkInAllTickets: builder.mutation({
      query: ({ bookingMasterId, terminalDeviceId, gateOrZone }) => ({
        url: `/reservations/${bookingMasterId}/tickets/check-in-all`,
        method: "POST",
        body: { terminalDeviceId, gateOrZone },
      }),
      invalidatesTags: (result, error, { bookingMasterId }) => [
        { type: "Tickets", id: bookingMasterId },
        { type: "Reservation", id: bookingMasterId },
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
        if (!result?.data?.bookingMasterId) return [];
        return [{ type: "Tickets", id: result.data.bookingMasterId }];
      },
    }),

    voidTicket: builder.mutation({
      query: ({ ticketId, reason, managerOverride }) => ({
        url: `/tickets/${ticketId}/void`,
        method: "POST",
        body: { reason, managerOverride },
      }),
      invalidatesTags: (result) => {
        if (!result?.data?.bookingMasterId) return ["Tickets"];
        return [{ type: "Tickets", id: result.data.bookingMasterId }];
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
