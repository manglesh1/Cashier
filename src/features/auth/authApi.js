import { baseApi } from "../../api/baseApi";
import Cookies from "js-cookie";
import { loginSuccess } from "./authSlice";

const LAST_LOCATION_KEY = "lastSelectedLocation";

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
          // Mirror the admin app's behaviour for location persistence so the
          // first booking-API call has the right location context.
          const preferredLocation = data.locations?.[0];
          if (preferredLocation) {
            Cookies.set("locationId", preferredLocation.locationId, { expires: 2 / 24 });
            Cookies.set("state", preferredLocation.stateOrProvince || "Unknown", { expires: 2 / 24 });
            try {
              localStorage.setItem(
                LAST_LOCATION_KEY,
                JSON.stringify({
                  locationId: preferredLocation.locationId,
                  stateOrProvince: preferredLocation.stateOrProvince || "",
                })
              );
            } catch { /* noop */ }
          }
          dispatch(
            loginSuccess({
              token: data.token,
              user: data.user,
              locations: data.locations || [],
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
              locations: data.locations || [],
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
                  locationId: data.device.locationId,
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
