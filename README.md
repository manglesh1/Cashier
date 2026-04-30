# Aerosports Cashier

Standalone front-end for counter-staff terminals. Runs separately from
the manager / admin app so cashier devices don't ship the full admin
bundle and ops folks can deploy / restart it on its own.

## What it does

- Sell catalog (loaded from the device's terminal template)
- Cart → reservation create
- Ticket scan / redeem at the gate
- Today's check-in queue with one-tap "check in N tickets"
- Guest lookup with visit history
- Stub screens for Payment / Refund / Shift close (wire when backends land)

## Run locally

```bash
npm install
cp .env.example .env  # edit URLs if backend/admin are on different hosts
npm run dev           # http://localhost:5173
```

## Configuration

Two env vars (read at build time):

| Var                  | Default                    | What it points at                         |
|----------------------|----------------------------|-------------------------------------------|
| `VITE_API_BASE_URL`  | `/api`                     | aeroSportsAdmin REST root                 |
| `VITE_ADMIN_URL`     | `http://localhost:5172`    | The admin app — opened in a new tab for actions the cashier defers (take payment, send waiver) |

## Architecture

- **Auth** — uses the same `/auth/login` endpoint as admin. Token + user
  + venues persist via `redux-persist` so a tablet refresh doesn't
  log the cashier out.
- **API** — RTK Query with one `baseApi` slice; per-feature slices
  (`bookingApi`, `ticketApi`, `posApi`) extend it via `injectEndpoints`.
- **Tickets** — every booking mints tickets server-side. The cashier
  scans / redeems tickets via the same endpoints the admin uses. See
  `aeroSportsAdmin/utils/tickets/ticketService.js` for issuance rules.

## Deferred work

Outside the scope of this initial app skeleton — wire as the underlying
backends ship:

- **Payment**: needs `POST /reservations/:id/capture-payment` on the
  backend (cash + terminal). Today the cashier creates the booking and
  hands off to admin via the new-tab link.
- **Shift / drawer**: needs `Shifts` table + 3 endpoints
  (`open`, `current`, `close`). Today the screen is a visual stub.
- **Refund**: backend exists (`POST /payment/manual-refund/:id`) — wire
  the screen to it.
