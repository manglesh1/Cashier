// Cashier-side customers API. Powers the Redeem screen's
// customer-first lookup flow plus any other place that needs
// to search guests or pull their redeemable artefacts.

import { baseApi } from "../../api/baseApi";

export const customersApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    // GET /api/customers?search=<query>&limit=&page=
    // Backend filters by guest name, email, or phone (iLike).
    // Returns { data: Guest[], total, page, limit }.
    searchCustomers: builder.query({
      query: ({ search = "", limit = 20, page = 1 } = {}) => ({
        url: "/customers",
        method: "GET",
        params: { search, limit, page },
      }),
      transformResponse: (response) => ({
        ...response,
        data: (response?.data || []).map((guest) => ({
          ...guest,
          guestId: guest.guestId ?? guest.id,
          guestName: guest.guestName ?? guest.name,
          guestEmail: guest.guestEmail ?? guest.email,
          guestPhone: guest.guestPhone ?? guest.phone,
        })),
      }),
    }),

    // GET /api/customers/:id/redeemable
    // Returns the guest's currently active redeemable artefacts:
    //   { guest, vouchers[], entitlements[], memberships[] }
    // Each item carries a `kind` and the IDs/token the panel needs
    // to fire the right redeem endpoint downstream.
    getCustomerRedeemables: builder.query({
      query: (guestId) => ({
        url: `/customers/${guestId}/redeemable`,
        method: "GET",
      }),
      // Invalidate when a redemption mutation flips state — keeps the
      // list in sync without manual refetches.
      providesTags: (result, error, guestId) => [
        { type: "Redeemables", id: guestId },
      ],
    }),
  }),
});

export const {
  useLazySearchCustomersQuery,
  useGetCustomerRedeemablesQuery,
  useLazyGetCustomerRedeemablesQuery,
} = customersApi;
