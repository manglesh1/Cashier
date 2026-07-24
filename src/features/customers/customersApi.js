// Cashier-side customers API. Powers the Redeem screen's
// customer-first lookup flow plus any other place that needs
// to search guests or pull their redeemable artefacts.

import { baseApi } from "../../api/baseApi";

const normalizeCustomer = (customer) => ({
  ...customer,
  id: customer.id ?? customer.customerId ?? customer.guestId,
  customerId: customer.customerId ?? customer.id ?? customer.guestId,
  customerName: customer.customerName ?? customer.name ?? customer.guestName,
  customerEmail: customer.customerEmail ?? customer.email ?? customer.guestEmail,
  customerPhone: customer.customerPhone ?? customer.phone ?? customer.guestPhone,
  guestId: customer.guestId ?? customer.customerId ?? customer.id,
  guestName: customer.guestName ?? customer.customerName ?? customer.name,
  guestEmail: customer.guestEmail ?? customer.customerEmail ?? customer.email,
  guestPhone: customer.guestPhone ?? customer.customerPhone ?? customer.phone,
  name: customer.name ?? customer.customerName ?? customer.guestName,
  email: customer.email ?? customer.customerEmail ?? customer.guestEmail,
  phone: customer.phone ?? customer.customerPhone ?? customer.guestPhone,
});

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
        data: (response?.data || []).map(normalizeCustomer),
      }),
    }),

    lookupCustomers: builder.query({
      query: ({ query = "", limit = 12 } = {}) => ({
        url: "/customers/lookup",
        method: "GET",
        params: { query, limit },
      }),
      transformResponse: (response) => ({
        ...response,
        data: (response?.data || []).map(normalizeCustomer),
      }),
    }),

    // GET /api/customers/:id?compact=1
    // Same customer profile endpoint used by the main Movira customer detail page.
    // Cashier keeps compact mode on by default so lookup selection opens quickly.
    getCustomerById: builder.query({
      query: ({ id, compact = true } = {}) => ({
        url: `/customers/${id}`,
        method: "GET",
        params: compact ? { compact: 1 } : undefined,
      }),
      transformResponse: (response) => ({
        ...response,
        data: response?.data ? normalizeCustomer(response.data) : response?.data,
      }),
      providesTags: (result, error, arg) => [
        { type: "Customers", id: arg?.id },
      ],
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
  useLazyLookupCustomersQuery,
  useGetCustomerByIdQuery,
  useLazyGetCustomerByIdQuery,
  useGetCustomerRedeemablesQuery,
  useLazyGetCustomerRedeemablesQuery,
} = customersApi;
