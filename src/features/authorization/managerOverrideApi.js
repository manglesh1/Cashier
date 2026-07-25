import { baseApi } from "../../api/baseApi";

export const managerOverrideApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    verifyManagerOverride: builder.mutation({
      query: (body) => ({
        url: "/pos/manager-override/verify",
        method: "POST",
        body,
      }),
    }),
  }),
});

export const { useVerifyManagerOverrideMutation } = managerOverrideApi;
