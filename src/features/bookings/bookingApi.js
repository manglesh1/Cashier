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
    createBooking: builder.mutation({
      query: (body) => ({ url: "/bookings", method: "POST", body }),
      invalidatesTags: ["Bookings"],
    }),
    sendBookingConfirmation: builder.mutation({
      query: (body) => ({ url: "/payment/send-booking-confirmation", method: "POST", body }),
    }),
    paymentSendPaymentLink: builder.mutation({
      query: (body) => ({ url: "/payment/send-payment-link", method: "POST", body }),
    }),
    refundPayment: builder.mutation({
      query: ({ bookingId, ...body }) => ({
        url: `/payment/manual-refund/${bookingId}`,
        method: "POST",
        body,
      }),
      invalidatesTags: (result, error, { bookingId }) => [
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
  useCreateBookingMutation,
  useSendBookingConfirmationMutation,
  usePaymentSendPaymentLinkMutation,
  useRefundPaymentMutation,
} = bookingApi;
