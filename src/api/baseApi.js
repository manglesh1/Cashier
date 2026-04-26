import { createApi, fetchBaseQuery } from "@reduxjs/toolkit/query/react";

// Reads the API base from Vite env at build time:
//   VITE_API_BASE_URL=http://localhost:3000/api
// Falls back to /api so the dev server's proxy can rewrite if you'd
// rather configure one.
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "/api";

const baseQueryWithAuth = fetchBaseQuery({
  baseUrl: API_BASE_URL,
  prepareHeaders: (headers, { getState }) => {
    const token = getState()?.auth?.token;
    if (token) headers.set("Authorization", `Bearer ${token}`);
    return headers;
  },
});

export const baseApi = createApi({
  reducerPath: "api",
  baseQuery: baseQueryWithAuth,
  tagTypes: ["Reservation", "Reservations", "Tickets", "PresetBuilder", "PosDevice", "PosSettings"],
  endpoints: () => ({}),
  refetchOnReconnect: true,
});
