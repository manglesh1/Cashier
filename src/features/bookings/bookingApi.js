import { baseApi } from "../../api/baseApi";

export const bookingApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    getAllBooking: builder.query({
      query: ({ page = 1, limit = 50, search = "", dateFrom = "", dateTo = "", status = [], paymentStatus = [], productId = [] }) => ({
        url: "/reservations/all",
        params: {
          page,
          limit,
          search,
          dateFrom,
          dateTo,
          status: Array.isArray(status) ? status.join(",") : status,
          paymentStatus: Array.isArray(paymentStatus) ? paymentStatus.join(",") : paymentStatus,
          productId: Array.isArray(productId) ? productId.join(",") : productId,
        },
      }),
      providesTags: ["Reservations"],
    }),
    getBookingById: builder.query({
      query: (id) => `/reservations/${id}`,
      providesTags: (result, error, id) => [{ type: "Reservation", id }],
    }),
    searchGuests: builder.query({
      query: (query) => `/reservations/search-visitor?query=${encodeURIComponent(query)}`,
    }),
    createBooking: builder.mutation({
      query: (body) => ({ url: "/reservations", method: "POST", body }),
      invalidatesTags: ["Reservations"],
    }),
    sendBookingConfirmation: builder.mutation({
      query: (body) => ({ url: "/payment/send-reservation-confirmation", method: "POST", body }),
    }),
    paymentSendPaymentLink: builder.mutation({
      query: (body) => ({ url: "/payment/send-payment-link", method: "POST", body }),
    }),
    refundPayment: builder.mutation({
      query: ({ bookingMasterId, ...body }) => ({
        url: `/payment/manual-refund/${bookingMasterId}`,
        method: "POST",
        body,
      }),
      invalidatesTags: (result, error, { bookingMasterId }) => [
        { type: "Reservation", id: bookingMasterId },
        "Reservations",
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
