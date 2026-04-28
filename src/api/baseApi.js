import { createApi, fetchBaseQuery } from "@reduxjs/toolkit/query/react";
import Cookies from "js-cookie";

// Reads the API base from Vite env at build time:
//   VITE_API_BASE_URL=http://localhost:3000/api
// Falls back to /api so the dev server's proxy can rewrite if you'd
// rather configure one.
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "/api";

const rawBaseQuery = fetchBaseQuery({
  baseUrl: API_BASE_URL,
  prepareHeaders: (headers, { getState }) => {
    const token = getState()?.auth?.token;
    if (token) headers.set("Authorization", `Bearer ${token}`);
    return headers;
  },
});

// Wrap baseQuery to auto-inject locationId on every request.
//
// The backend's getLocationFromRequest reads the locationId from query params
// first, then falls back to the locationId cookie. The cashier UI runs on a
// different origin from the API (CORS) so the cookie isn't sent — without
// this wrapper every location-scoped endpoint sees locationId=null and either
// 401s ("Location resolution failed") or returns no rows.
//
// Source of truth: the paired terminal in localStorage. Falls back to the
// cookie (set during login) if the tablet isn't paired yet.
const baseQueryWithLocation = async (args, api, extraOptions) => {
  let locationId = null;
  try {
    const t = JSON.parse(localStorage.getItem("cashier:terminal") || "null");
    locationId = t?.locationId || null;
  } catch { /* noop */ }
  if (!locationId) locationId = Cookies.get("locationId") || null;

  if (locationId) {
    if (typeof args === "string") {
      const sep = args.includes("?") ? "&" : "?";
      args = `${args}${sep}locationId=${encodeURIComponent(locationId)}`;
    } else if (args && typeof args === "object") {
      args = {
        ...args,
        params: { ...(args.params || {}), locationId },
      };
    }
  }
  return rawBaseQuery(args, api, extraOptions);
};

export const baseApi = createApi({
  reducerPath: "api",
  baseQuery: baseQueryWithLocation,
  tagTypes: ["Booking", "Bookings", "Tickets", "CheckIn", "PresetBuilder", "PosDevice", "PosSettings"],
  endpoints: () => ({}),
  refetchOnReconnect: true,
});
