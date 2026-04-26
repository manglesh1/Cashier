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

// Wrap baseQuery to auto-inject venueId on every request.
//
// The backend's getVenueFromRequest reads the venueId from query params
// first, then falls back to the venueId cookie. The cashier UI runs on a
// different origin from the API (CORS) so the cookie isn't sent — without
// this wrapper every venue-scoped endpoint sees venueId=null and either
// 401s ("Park resolution failed") or returns no rows.
//
// Source of truth: the paired terminal in localStorage. Falls back to the
// cookie (set during login) if the tablet isn't paired yet.
const baseQueryWithVenue = async (args, api, extraOptions) => {
  let venueId = null;
  try {
    const t = JSON.parse(localStorage.getItem("cashier:terminal") || "null");
    venueId = t?.venueId || null;
  } catch { /* noop */ }
  if (!venueId) venueId = Cookies.get("venueId") || null;

  if (venueId) {
    if (typeof args === "string") {
      const sep = args.includes("?") ? "&" : "?";
      args = `${args}${sep}venueId=${encodeURIComponent(venueId)}`;
    } else if (args && typeof args === "object") {
      args = {
        ...args,
        params: { ...(args.params || {}), venueId },
      };
    }
  }
  return rawBaseQuery(args, api, extraOptions);
};

export const baseApi = createApi({
  reducerPath: "api",
  baseQuery: baseQueryWithVenue,
  tagTypes: ["Reservation", "Reservations", "Tickets", "PresetBuilder", "PosDevice", "PosSettings"],
  endpoints: () => ({}),
  refetchOnReconnect: true,
});
