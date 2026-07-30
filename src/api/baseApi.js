import { createApi, fetchBaseQuery } from "@reduxjs/toolkit/query/react";
import Cookies from "js-cookie";

// Reads the API base from Vite env at build time:
//   VITE_API_BASE_URL=http://localhost:5171/api/cashier
// Falls back to /api so the dev server's proxy can rewrite if you'd
// rather configure one.
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "/api/cashier";

const rawBaseQuery = fetchBaseQuery({
  baseUrl: API_BASE_URL,
  prepareHeaders: (headers, { getState }) => {
    headers.set("X-Client-App", "cashier");
    const token = getState()?.auth?.token;
    if (token) headers.set("Authorization", `Bearer ${token}`);
    return headers;
  },
});

// Wrap baseQuery to send the paired location as request context.
//
// Source of truth: the paired terminal in localStorage. Falls back to the
// cookie (set during login) if the tablet isn't paired yet.
const baseQueryWithLocation = async (args, api, extraOptions) => {
  const requestUrl = typeof args === "string" ? args : args?.url || "";
  let locationId = null;
  const state = api.getState?.();
  locationId = state?.auth?.locations?.[0]?.locationId || null;
  try {
    const t = JSON.parse(localStorage.getItem("cashier:terminal") || "null");
    if (!locationId) locationId = t?.locationId || null;
  } catch { /* noop */ }
  if (!locationId) locationId = Cookies.get("locationId") || null;

  if (locationId && requestUrl !== "/pos/pair") {
    if (typeof args === "string") {
      args = {
        url: args,
        headers: { "X-Location-Id": String(locationId) },
      };
    } else if (args && typeof args === "object") {
      args = {
        ...args,
        headers: {
          ...(args.headers || {}),
          "X-Location-Id": String(locationId),
        },
      };
    }
  }
  return rawBaseQuery(args, api, extraOptions);
};

export const baseApi = createApi({
  reducerPath: "api",
  baseQuery: baseQueryWithLocation,
  tagTypes: ["Booking", "Bookings", "Customers", "Tickets", "CheckIn", "Availability", "PresetBuilder", "PosDevice", "PosSettings", "Redemption", "MembershipBilling"],
  endpoints: () => ({}),
  refetchOnReconnect: true,
});
