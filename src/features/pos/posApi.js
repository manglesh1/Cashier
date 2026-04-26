import { baseApi } from "../../api/baseApi";

export const posApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    // Device pairing — public endpoint (tablet has no token yet)
    pairDevice: builder.mutation({
      query: ({ code, appVersion }) => ({
        url: "/pos/pair",
        method: "POST",
        body: { code, appVersion },
      }),
    }),
    deviceHeartbeat: builder.mutation({
      query: ({ deviceId, appVersion }) => ({
        url: "/pos/devices/heartbeat",
        method: "POST",
        body: { deviceId, appVersion },
      }),
    }),

    // Templates (presets)
    getAllPosTemplates: builder.query({
      query: () => "/pos/templates",
      providesTags: ["PosTemplate"],
    }),
    createPosTemplate: builder.mutation({
      query: (data) => ({ url: "/pos/templates", method: "POST", body: data }),
      invalidatesTags: ["PosTemplate"],
    }),
    updatePosTemplate: builder.mutation({
      query: ({ id, ...data }) => ({ url: `/pos/templates/${id}`, method: "PUT", body: data }),
      invalidatesTags: ["PosTemplate"],
    }),
    deletePosTemplate: builder.mutation({
      query: (id) => ({ url: `/pos/templates/${id}`, method: "DELETE" }),
      invalidatesTags: ["PosTemplate"],
    }),

    // Preset builder — full preset with sections & products
    getPresetFull: builder.query({
      query: (id) => `/pos/templates/${id}/full`,
      providesTags: (result, error, id) => [{ type: "PresetBuilder", id }],
    }),

    // Sections
    createPresetSection: builder.mutation({
      query: ({ presetId, ...data }) => ({ url: `/pos/templates/${presetId}/sections`, method: "POST", body: data }),
      invalidatesTags: (result, error, { presetId }) => [{ type: "PresetBuilder", id: presetId }],
    }),
    updatePresetSection: builder.mutation({
      query: ({ sectionId, ...data }) => ({ url: `/pos/sections/${sectionId}`, method: "PUT", body: data }),
      invalidatesTags: ["PresetBuilder"],
    }),
    deletePresetSection: builder.mutation({
      query: ({ sectionId, presetId }) => ({ url: `/pos/sections/${sectionId}`, method: "DELETE" }),
      invalidatesTags: (result, error, { presetId }) => [{ type: "PresetBuilder", id: presetId }],
    }),
    reorderPresetSections: builder.mutation({
      query: ({ presetId, order }) => ({ url: `/pos/templates/${presetId}/sections/reorder`, method: "PUT", body: { order } }),
      invalidatesTags: (result, error, { presetId }) => [{ type: "PresetBuilder", id: presetId }],
    }),

    // Section products
    addSectionProducts: builder.mutation({
      query: ({ sectionId, products }) => ({ url: `/pos/sections/${sectionId}/products`, method: "POST", body: { products } }),
      invalidatesTags: ["PresetBuilder"],
    }),
    updateSectionProduct: builder.mutation({
      query: ({ productItemId, ...data }) => ({ url: `/pos/section-products/${productItemId}`, method: "PUT", body: data }),
      invalidatesTags: ["PresetBuilder"],
    }),
    removeSectionProduct: builder.mutation({
      query: (productItemId) => ({ url: `/pos/section-products/${productItemId}`, method: "DELETE" }),
      invalidatesTags: ["PresetBuilder"],
    }),

    // Devices — accepts venueId (required by backend's getVenueFromRequest)
    getAllPosDevices: builder.query({
      query: (venueId) => ({ url: "/pos/devices", params: venueId ? { venueId } : {} }),
      providesTags: ["PosDevice"],
    }),
    getPosDeviceById: builder.query({
      query: (id) => `/pos/devices/${id}`,
      providesTags: ["PosDevice"],
    }),
    createPosDevice: builder.mutation({
      query: (data) => ({ url: "/pos/devices", method: "POST", body: data }),
      invalidatesTags: ["PosDevice"],
    }),
    updatePosDevice: builder.mutation({
      query: ({ id, ...data }) => ({ url: `/pos/devices/${id}`, method: "PUT", body: data }),
      invalidatesTags: ["PosDevice"],
    }),
    deletePosDevice: builder.mutation({
      query: (id) => ({ url: `/pos/devices/${id}`, method: "DELETE" }),
      invalidatesTags: ["PosDevice"],
    }),

    // Settings
    getPosSettings: builder.query({
      query: () => "/pos/settings",
      providesTags: ["PosSettings"],
    }),
    updatePosSettings: builder.mutation({
      query: (data) => ({ url: "/pos/settings", method: "PUT", body: data }),
      invalidatesTags: ["PosSettings"],
    }),
  }),
});

export const {
  usePairDeviceMutation,
  useDeviceHeartbeatMutation,
  useGetAllPosTemplatesQuery,
  useCreatePosTemplateMutation,
  useUpdatePosTemplateMutation,
  useDeletePosTemplateMutation,
  useGetPresetFullQuery,
  useCreatePresetSectionMutation,
  useUpdatePresetSectionMutation,
  useDeletePresetSectionMutation,
  useReorderPresetSectionsMutation,
  useAddSectionProductsMutation,
  useUpdateSectionProductMutation,
  useRemoveSectionProductMutation,
  useGetAllPosDevicesQuery,
  useGetPosDeviceByIdQuery,
  useCreatePosDeviceMutation,
  useUpdatePosDeviceMutation,
  useDeletePosDeviceMutation,
  useGetPosSettingsQuery,
  useUpdatePosSettingsMutation,
} = posApi;
