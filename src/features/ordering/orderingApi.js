import { baseApi } from "../../api/baseApi";

export const orderingApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    getPublicMenu: builder.query({
      query: (locationId) => `/public/ordering/${locationId}/menu`,
      providesTags: ["OrderingMenu"],
    }),
    placePublicOrder: builder.mutation({
      query: ({ locationId, tableId, items }) => ({
        url: `/public/ordering/${locationId}/${tableId}/order`,
        method: "POST",
        body: { items },
      }),
      invalidatesTags: ["OrderingMenu", "TableOrders", "PhysicalInventory", "PublicTableOrders"],
    }),
    getPublicTableOrders: builder.query({
      query: ({ locationId, tableId }) => `/public/ordering/${locationId}/${tableId}/orders`,
      providesTags: ["PublicTableOrders"],
    }),
    getTables: builder.query({
      query: () => "/tables",
      providesTags: ["Tables"],
    }),
    createTable: builder.mutation({
      query: (tableData) => ({
        url: "/tables",
        method: "POST",
        body: tableData,
      }),
      invalidatesTags: ["Tables"],
    }),
    generateTables: builder.mutation({
      query: (count) => ({
        url: "/tables/generate",
        method: "POST",
        body: { count },
      }),
      invalidatesTags: ["Tables"],
    }),
    deleteTable: builder.mutation({
      query: (id) => ({
        url: `/tables/${id}`,
        method: "DELETE",
      }),
      invalidatesTags: ["Tables"],
    }),
    getActiveOrders: builder.query({
      query: () => "/tables/orders",
      providesTags: ["TableOrders"],
    }),
    updateOrderStatus: builder.mutation({
      query: ({ id, ...data }) => ({
        url: `/tables/orders/${id}/status`,
        method: "PUT",
        body: data,
      }),
      invalidatesTags: ["TableOrders"],
    }),
  }),
});

export const {
  useGetPublicMenuQuery,
  usePlacePublicOrderMutation,
  useGetTablesQuery,
  useCreateTableMutation,
  useGenerateTablesMutation,
  useDeleteTableMutation,
  useGetActiveOrdersQuery,
  useUpdateOrderStatusMutation,
  useGetPublicTableOrdersQuery,
} = orderingApi;
