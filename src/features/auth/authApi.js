import { baseApi } from "../../api/baseApi";
import Cookies from "js-cookie";
import { loginSuccess } from "./authSlice";

const LAST_VENUE_KEY = "lastSelectedVenue";

export const authApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    login: builder.mutation({
      query: (credentials) => ({
        url: "/auth/login",
        method: "POST",
        body: credentials,
      }),
      onQueryStarted: async (_arg, { dispatch, queryFulfilled }) => {
        try {
          const { data } = await queryFulfilled;
          // Mirror the admin app's behaviour for venue persistence so the
          // first booking-API call has the right park context.
          const preferredVenue = data.venues?.[0];
          if (preferredVenue) {
            Cookies.set("venueId", preferredVenue.venueId, { expires: 2 / 24 });
            Cookies.set("state", preferredVenue.stateOrProvince || "Unknown", { expires: 2 / 24 });
            try {
              localStorage.setItem(
                LAST_VENUE_KEY,
                JSON.stringify({
                  venueId: preferredVenue.venueId,
                  stateOrProvince: preferredVenue.stateOrProvince || "",
                })
              );
            } catch { /* noop */ }
          }
          dispatch(
            loginSuccess({
              token: data.token,
              user: data.user,
              venues: data.venues || [],
            })
          );
        } catch (error) {
          console.error("Cashier login failed:", error);
        }
      },
    }),
    logout: builder.mutation({
      query: () => ({
        url: "/auth/logout",
        method: "POST",
      }),
    }),
  }),
});

export const { useLoginMutation, useLogoutMutation } = authApi;
