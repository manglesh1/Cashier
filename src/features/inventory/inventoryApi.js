import { baseApi } from "../../api/baseApi";

export const inventoryApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    getInventoryItemByBarcode: builder.query({
      query: (barcode) => ({ url: `/inventory/by-barcode/${barcode}` }),
    }),
  }),
});

export const {
  useLazyGetInventoryItemByBarcodeQuery,
} = inventoryApi;
