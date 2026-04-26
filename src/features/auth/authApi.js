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

    // ── POS clock-in (tile-grid + PIN) ──────────────────────────────
    getClockInOptions: builder.query({
      query: (deviceId) => ({
        url: "/pos/clock-in/options",
        params: { deviceId },
      }),
    }),
    clockIn: builder.mutation({
      query: ({ deviceId, userId, pin }) => ({
        url: "/pos/clock-in",
        method: "POST",
        body: { deviceId, userId, pin },
      }),
      onQueryStarted: async (_arg, { dispatch, queryFulfilled }) => {
        try {
          const { data } = await queryFulfilled;
          dispatch(
            loginSuccess({
              token: data.token,
              user: data.user,
              venues: data.venues || [],
            })
          );

          // Refresh the terminal snapshot in localStorage with the
          // current device data the server just returned. Important
          // because a template might have been assigned / changed since
          // the tablet was paired — the pairing-time snapshot is stale.
          if (data?.device?.deviceId) {
            try {
              const existing = JSON.parse(localStorage.getItem("cashier:terminal") || "{}");
              localStorage.setItem(
                "cashier:terminal",
                JSON.stringify({
                  ...existing,
                  deviceId: data.device.deviceId,
                  deviceName: data.device.deviceName,
                  venueId: data.device.venueId,
                  templateId: data.device.templateId,
                })
              );
            } catch { /* noop */ }
          }
        } catch (error) {
          console.error("Cashier clock-in failed:", error);
        }
      },
    }),
  }),
});

export const {
  useLoginMutation,
  useLogoutMutation,
  useGetClockInOptionsQuery,
  useClockInMutation,
} = authApi;
