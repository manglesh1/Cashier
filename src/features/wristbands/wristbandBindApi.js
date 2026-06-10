// RFID wristband bind + lookup endpoints. Backed by
// aeroSportsAdmin controllers/wristbandBindController.js.
//
//   bindWristband     ({ bookingId, participantId, rfidUid }) → success
//   unbindWristband   ({ bookingId, participantId })          → success
//   lookupWristband   ({ rfidUid })                            → participant + booking
//
// The Cashier's CheckIn screen calls bindWristband when a cashier arms
// a participant's "Bind" button and the next RFID scan lands. The
// lookup endpoint powers the gate-side flow: cashier scans an unbound
// wristband, lookup tells them which booking to open.

import { baseApi } from "../../api/baseApi";

export const wristbandBindApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    bindWristband: builder.mutation({
      query: (body) => ({
        url: "/wristbands/bind",
        method: "POST",
        body,
      }),
      // Refresh the booking's ticket list so the bound chip surfaces
      // on the row immediately. Same tag the check-in flow uses.
      invalidatesTags: (result, error, { bookingId }) => [
        { type: "Bookings", id: bookingId },
        { type: "Tickets", id: bookingId },
        "CheckIn",
      ],
    }),
    unbindWristband: builder.mutation({
      query: (body) => ({
        url: "/wristbands/bind",
        method: "DELETE",
        body,
      }),
      invalidatesTags: (result, error, { bookingId }) => [
        { type: "Bookings", id: bookingId },
        { type: "Tickets", id: bookingId },
        "CheckIn",
      ],
    }),
    lookupWristband: builder.mutation({
      query: (body) => ({
        url: "/wristbands/lookup",
        method: "POST",
        body,
      }),
    }),
  }),
  overrideExisting: false,
});

export const {
  useBindWristbandMutation,
  useUnbindWristbandMutation,
  useLookupWristbandMutation,
} = wristbandBindApi;
