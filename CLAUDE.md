# AeroSports Cashier (POS) — working notes for Claude

Kiosk/POS web app for cashiers at an aerosports/trampoline park. Pairs to a
terminal, then runs Sell / Find / Redeem / Vouchers / Check-in / Guest /
Waiver / Refund. Backend is the Express + Sequelize app at
`C:/AeroSports/aeroSportsAdmin` (DB: Postgres). Admin React app is at
`C:/AeroSports/my-admin-app`.

## Run / verify
- Dev: `npm run dev` (Vite, port 5173). Build: `npx vite build`. Tests:
  `npm test` (node --test on `src/**/*.test.js`).
- Backend syntax check a controller: `node -e "require('./controllers/x.js')"`.
- Backend migrations: `npm run migrate` (sequelize-cli). `predev` runs them.
- **After backend changes, the backend server must restart** (nodemon).
- **POS settings now refresh LIVE** — the heartbeat (`/pos/devices/heartbeat`,
  every 60s + once on app load) returns fresh `effectiveSettings`
  (`buildEffectiveSettings`); the cashier writes them via
  `updateTerminalSettings` and dispatches `cashier:settings-updated` so
  `useEffectiveSettings` re-reads. So an admin edit takes effect within ~1
  beat — **no re-pair needed** for setting changes (re-pair is still only for
  first-time bootstrap / switching terminals).

## Architecture
- **Routing:** `HashRouter` in `main.jsx`. `CashierApp.jsx` derives the active
  screen from `useLocation()` (`screen = pathname.split('/')[1] || 'sell'`);
  sidebar uses `useNavigate`. Unknown routes redirect to `/sell`. Kiosk = no
  address bar; refresh keeps the tab. `beforeunload` guard when cart non-empty.
- **State:** cart lives in Redux `cartSlice` (`features/cart/cartSlice.js`),
  persisted via redux-persist (whitelist `["auth","cart"]` in `store/index.js`)
  so refresh/reboot don't lose the cart. Transient UI (paymentBooking, modals,
  scheduleRequiredItem) stays in component `useState` on purpose.
  - **Recent activity/scans** were plain `useState([])` → blanked on every hard
    refresh. Two different fixes by screen:
    - **Redeem "Recent activity" → BACKEND-driven.** The backend logs every
      redeem to `TicketRedemptions` (redeemedAt, sourceToken, activityId,
      terminalDeviceId, gateOrZone, status). New endpoint
      `GET /tickets/redemptions/recent?locationId=&deviceId=&limit=`
      (`ticketController.getRecentRedemptions`, location-scoped via the
      redemption's booking, optional deviceId). Cashier:
      `useGetRecentRedemptionsQuery({ deviceId })` (`Redemption` tag);
      `redeemTicket` invalidates `Redemption` so the feed auto-refreshes after a
      scan. Source of truth, survives refresh, shared across terminals. NOTE:
      shows successful redemptions only (failed scans → toast, not the list).
    - **VoucherCounter "Recent scans" → persisted local list.** It redeems mixed
      types (vouchers/memberships/gift cards/tickets) and only TICKET redemptions
      land in `TicketRedemptions`, so the backend feed would be incomplete here.
      Kept on `lib/usePersistentState.js` (localStorage `useState`, key
      `cashier:recent:vouchers`, capped 12) so it survives reload and still
      covers every action type.
- **Icons:** Lucide is BUNDLED (`main.jsx` wraps `createIcons({ icons })` onto
  `window.lucide`). The old unpkg CDN script was removed (kiosk works offline).

## Shared libs (src/lib)
- `money.js` — `roundMoney` (Math.round(x*100)/100, NOT toFixed), `moneyFmt`,
  `toCents`. Use these everywhere; don't redefine.
- `hardware.js` — `openCashDrawer()` + `printReceipt()`. Dispatch a window
  CustomEvent and wait 2s for an ack from the kiosk hardware agent.
- `scanner.js` — `attachScannerListener()` (call once in CashierApp). Detects
  USB-HID barcode bursts and dispatches `cashier:scan`. Redeem subscribes.
- `useEffectiveSettings.js` — merged location+device settings from the paired
  terminal snapshot (localStorage). FALLBACKS define defaults.

## Hardware-agent event contract
| App emits | Agent acks | Fallback if no ack (2s) |
|---|---|---|
| `cashier:open-cash-drawer` `{requestId,bookingId,…}` | `cashier:cash-drawer-opened` `{requestId}` | toast "Cash drawer did not respond…" |
| `cashier:print-receipt` `{requestId,bookingId,…}` | `cashier:receipt-printed` `{requestId}` | toast "No printer connected — use Email receipt." (OS dialog suppressed by choice) |
| (agent emits) | `cashier:scan` `{code,source}` | n/a |

## POS settings keys (per location/device, via pair payload)
- `joinGraceMinutes` (default 15) + `minRemainingMinutes` (default 0 = OFF) —
  walk-in slot selection. A running slot is offered if `elapsed<=grace` AND
  (only when `minRemaining>0`) `remaining>=minRemaining`.
  - **joinGraceMinutes 0** = only upcoming slots (no late-join at all).
  - **minRemainingMinutes 0 / empty** = no minimum-remaining check, join window only.
  - These gate the AUTO-assign flow ONLY (`pickNearestSession`). The manual
    picker always lets the cashier select any not-yet-ended slot — see Manual
    schedule picker. When both are 0, tapping a timed product whose only slot is
    already running auto-assigns nothing (toast → manual picker opens).
  - Edits apply LIVE via the heartbeat (see Run/verify) — within ~60s, or
    instantly on the next app load. No re-pair needed. NOTE: a cart line added
    under the OLD setting persists (redux-persist), so clear/re-add it to see
    the new behaviour for an already-added product.
  Admin `PosSettingsPage` ("Walk-in slot selection") exposes BOTH as toggles:
  - "Allow joining a slot that already started" toggle — off → stores 0 (upcoming
    only); on → reveals a `NumberRow` ("Join window after start") default 15.
  - "Require a minimum time remaining" toggle — off → stores 0; on → reveals a
    `NumberRow` ("Minimum time remaining") default 15.
  Each NumberRow sits inside a `<NestedSetting>` component (left red-accent
  border + faint bg, indented 28px). Toggle off collapses it. Stored on
  `PosSettings` (migration folded into `20260426190000-add-cashier-settings.js`),
  emitted by `posController` `mergeSettings`/pair.
- `taxRate` (percent, e.g. 10) + `taxCalculation` ("add_to_price" |
  "include_in_price") — from the location's default `TaxRate` via
  `getLocationTaxConfig`, emitted in the pair payload. CartPanel computes tax
  with these so cart total == booking total (was a 5%-vs-10% mismatch bug).
- `hasCashDrawer`, `openDrawerForCashOnly`, discount limits, etc.

## Key flows & decisions
- **Sell — nearest-slot auto-assign:** tapping a slot product fetches today's
  availability and auto-picks the nearest sellable slot (`scheduleHelpers
  .autoScheduleLine` / `pickNearestSession`), dropping straight into the cart.
  Falls back to the manual picker only if nothing's free / lookup fails.
- **Manual schedule picker (`ScheduleRequiredDialog`):** for TODAY shows every
  slot that hasn't ENDED yet — running + future (`isSessionNotEnded`); future
  dates show all. The join-grace / min-remaining settings do NOT apply here:
  they gate auto-assign only, so a cashier can always manually drop a walk-in
  into an ongoing slot at their discretion. "Change time" on a cart line opens
  it. (`isSessionSelectableNow` still encodes the AUTO selectability rule and
  is unit-tested, but the picker no longer uses it.)
- **Customer is OPTIONAL at checkout** (`requiresCustomerForCheckout` returns
  false unless an explicit per-product flag). Vouchers/memberships/gift cards
  still need a delivery email (separate guard). Cart customer card is editable
  (click) + removable (×); modal pre-fills for edit; single "Done" saves.
- **Checkout (`CashierPaymentDialog`) + Check-in payment (`CheckIn`):** at
  parity. Both: idempotency keys on createBooking/recordPayment, synchronous
  submit-lock (no double-charge), shared cash-drawer ack, ad-hoc receipt email
  field, discount gated by limit/manager. Charge uses validate-cart's
  authoritative pricing (no tax drift).
- **Split tender (gift card + cash/card/check) — SELL flow.** In
  `CashierPaymentDialog`, gift card is no longer a mutually-exclusive method —
  it's an APPLIED CREDIT (lookup → Apply panel) that covers up to its balance,
  and the method selector (cash/card/check) settles the REMAINDER in the same
  Complete. Flow: create booking UNPAID (draft) → `gift-cards/redeem` for the
  card portion → `recordPayment` for the remainder → booking paid. Receipt shows
  "$X gift card + $Y method". If the card covers the full balance, the method
  step is skipped (pure gift card). NOTE: the Check-in take-payment modal
  (`CheckIn` `PaymentModal`) still uses the OLD single-tender gift card — split
  tender there is the remaining parity item.
- **Check number capture.** Selecting Check reveals a check-number field. It's
  stored as the PaymentTransaction `referenceNumber` (`CHK-<n>`) AND in remarks
  (`Check #<n>`). Threaded through `recordPayment` (existing booking / split
  remainder) and through `createBooking` for draft sales (new `referenceNumber`
  + initial-payment `remarks` on the first PaymentTransaction). Check-in modal:
  pending (same parity follow-up).
- **Check-in buckets:** route by status — fully checked-in → Completed,
  partial → In Progress, else Upcoming. Row pill shows Checked in / N/N in /
  Ready / N waivers missing. Bucketing compares `checkedInGuests >= totalGuests`.
  Backend `getAllBookings` derives BOTH from TICKETS when any exist:
  `totalGuests` = active (non-void/refunded) ticket count, `checkedInGuests` =
  redeemed ticket count. This (a) counts redeemed transferable tickets that have
  no participant (participant.checkedInAt alone undercounted → a fully-redeemed
  party stayed in Upcoming), and (b) avoids the party double-count where
  noOfTickets is summed across two resource-block booking items (15+15=30 vs 15
  real tickets). Unpaid/no-ticket bookings fall back to summed noOfTickets +
  participant check-ins.
- **Select all (check-in):** selects every VISIBLE ticket that's individually
  checkable — `isTicketReadyForCheckIn` (issued + no blocker) — to match the
  per-row checkboxes. It does NOT use `buildCheckInAllPlan.readyCodes` (that's
  stricter: it skips transferable tickets with no participant for the AUTO
  "Check in all" flow). Without this, paid party tickets — no waiver, no
  participant linked — were individually selectable but Select all picked
  nothing. The AUTO "Check in all" button still uses the stricter `allBulkPlan`.
- **Early arrival (same day):** cashier can check in a not-yet-started slot
  today, no manager (`allowEarlyCheckIn`, backend gates to same calendar day).
  Future-day still blocked.
- **Ticket validity = SLOT SESSION window, not the booking line's resource
  block.** A multi-resource session (e.g. a 120-min party held across two
  consecutive 1-hour resource blocks) lands on a booking item whose `timeto` is
  only the end of block #1, so tickets would expire mid-session (a 13:00–15:00
  party expiring at 14:00). Backend `ticketService.buildEnrichedLine` now widens
  ticket `validFrom`/`validUntil` to the `ScheduleDetails` slot's `fromTime`/
  `toTime` (loaded via `loadSlotWindowMap`) — widen-only, never shortening. So
  check-in is allowed for the whole booked duration. (One-off DB correction was
  run to widen 65 already-minted tickets across existing party bookings.)
- **Move to available slot — expired AND ongoing:** the banner shows for an
  EXPIRED session (orange, "time has passed") AND for an in-progress one (blue,
  "Session in progress — check in here, or move…"). Ongoing sessions stay fully
  checkable; the move is optional. Backend `POST /bookings/:id/reslot` accepts
  any active, non-cancelled slot-bound booking (capacity-correct re-slot, also
  revives expired tickets).
- **Waiver people selection:** linking a waiver that covers signer + minors
  shows a chooser; only the picked people are linked (backend `people`
  param: `["signer","minor:0",…]`). Prevents auto-adding the guardian.
- **Refund:** real flow — search booking → amount + reason → manager override →
  `POST /payment/manual-refund/:id` (manager-gated endpoint).
- **Voucher counter:** `/vouchers/by-token/:token` now falls back to a
  **Ticket by ticketCode** (`kind:"ticket"`) so stock-item/add-on tickets
  (AS-T-…) resolve and redeem there.
- **Gift card payment (checkout + check-in):** the `gift_card` method is a
  REAL tender now. Cashier enters card code+PIN → `gift-cards/lookup` shows
  balance → on Complete, `gift-cards/redeem {code,pin,amount,bookingId}`
  decrements the card AND records the booking payment atomically (and syncs
  tickets if it makes the booking paid). Applies `min(payableBalance,
  cardBalance)`; any shortfall stays as the booking's balance due (partial
  tender — no split-tender UI yet, finish the rest with another method via
  Find/Take-payment). Draft sale: the booking is created UNPAID first
  (`completeDraftCheckout` skips the payment payload when `payment.giftCard`),
  then the gift card is redeemed against the new bookingId. Edge: a pure
  multi-voucher cart paid by gift card only pays the first booking.
- **Waiver page (`WaiverDetail`):** uses the SAME backend handler as admin
  (`getSignedWaiverView`, `/waivers/signed/:id`) which returns
  `agreedCheckboxes[]`, `formResponses[]`, `guest{name,email,phone,address,
  postcode}`, `minors[]`, `signatureImage`, `waiver{name,content,locationName}`.
  Detail mirrors admin's structured cards (DetailCard/Field): Holder details,
  Covered guests, Additional responses (`formResponses`), Document, Signature.
  (No separate "Agreed terms" card — the agreed ✓ lines already live inside the
  Document, and the Document is NOT an inner scrollbox; the page scrolls.)
  Document body is HTML with `[CHECKBOX]…[/CHECKBOX]` markers — rendered via
  `dangerouslySetInnerHTML` after `cleanWaiverHtml` turns each marker into a
  green "✓ …" agreed line (`.waiver-doc` scoped <style>). Signature: `<img>`
  only when `data:image`; otherwise a TYPED name shown in italic serif (was a
  broken <img>). The left holder list mirrors admin's Waiver-Holders TABLE
  columns adapted for touch — each card row shows Name(+minor chip),
  "Signed by" (guardian), and a DOB / Signed / Expires mini-grid + status pill
  (master-detail kept instead of a cramped 6-col table on a narrow panel).
- **No-slot items (stock items + add-ons) must be captured at booking creation.**
  Backend `createBooking`/`updateBooking` build line items from `sessions`. A
  session with no slotId is recorded as a `purchasedItem` (priced by
  `buildPurchasedItems`, which allows ADD_ON + STOCK_ITEM). The capture gate used
  to require `s.isAddon`, so a STOCK item (e.g. "Birthday Bowl of Popcorn",
  `productType:"stock_item"` → `isAddon` false) was silently DROPPED: the booking
  saved with 0 items / total $0 while the cashier still charged the guest, so the
  admin balance went NEGATIVE (paid − 0 = −$6.60). Fix: capture ANY no-slot
  session with a valid variationId + quantity (`buildPurchasedItems` filters to
  the allowed types). `totalAmount` seeds from `purchasedItems` so the total is
  correct and balance lands at 0.
- **No-slot items must also MINT TICKETS.** Standalone stock items / add-ons live
  only on `booking.purchasedItems` (no `BookingItem` row). Ticket minting
  (`ticketService.loadTicketableLines`) used to build lines only from
  `BookingItem` rows + bundle-inclusion snapshots (`isBundleInclusion`) +
  no-schedule artifacts (voucher/membership/gift card/entitlement) — so a
  standalone stock/add-on got NO ticket. Added `buildStandalonePurchasedItemLines`:
  any non-bundle `purchasedItems` entry with activityId+variationId becomes a
  ticket line. COUNT = quantity purchased (one AS-T- ticket per unit, resolved
  by the voucher counter). Mints on PAID bookings (unpaid waits for payment,
  then post-payment finalize syncs). Two rules that matter:
  - **Validity = end of the PURCHASE DAY.** validFrom null (usable now),
    validUntil = dateOfBooking 23:59:59 — stock/add-ons expire the night they're
    sold (not a forever / "no validity window" ticket).
  - **Do NOT set a ticketLineKey/externalKey on these lines.** The sync counts
    existing tickets under the plain bookingItemId::activityId::variationId key
    (they carry no membership/gift_card/entitlement note, so getTicketExternalKey
    is null). A custom key made the EXPECTED key (external::...) never match the
    EXISTING key, so missing = expected - 0 and every redemption/sync minted a
    fresh REPLACEMENT (ticket count crept up on each redeem). Unset key keeps both
    sides equal so the count stays fixed at the purchased quantity.
    isCountableTicket already counts issued + redeemed + partially_redeemed, so a
    used single-use ticket is never re-minted.
- **Receipt email:** `send-booking-confirmation` accepts an `email` override
  (walk-ins with no email on file); backfills the guest email if empty.
- **Guest identity = email.** `createBooking` find-or-create normalizes email
  (trim + case-insensitive). Guest lookup collapses results by email. Existing
  dupes merged via `scripts/mergeDuplicateGuests.js` (dry-run default;
  `--apply`, `--email=`). Keeps the named profile, repoints all guest FKs,
  deletes dupes; resilient to unique-constraint collisions via savepoints.
- **A booking must NEVER silently rename a returning guest.** `createBooking`
  used to overwrite an existing guest's `guestName` from `guestInfo.guestName`
  on every booking. That payload name mirrors the booking name, which can be a
  descriptive "Name - Product" string (the no-schedule loop sets
  `bookingName = \`${guestName} - ${item.name}\``; the cart customer is also set
  to the waiver holder). Once a combined value reached `createBooking`, the
  guest was permanently renamed (e.g. "Bimal Gayali - Birthday Bowl Popcorn"),
  and since the cashier then sends that stored name back, it stuck. Fix:
  `createBooking` only fills `guestName` when the guest has no real name yet
  (empty / "Walk-in" placeholder); a real name is never overwritten by a
  booking. Real edits go through the audited Edit-booking / customer page
  (`editBooking`, which keeps name in its updatable set on purpose). Repaired
  data: guest, the 2 stock bookings' names, and 2 BookingParticipant
  displayNames. `GuestWaiverSignature.signedByName` was already clean.

## Gotchas / conventions
- **Rules of Hooks:** all hooks BEFORE any early return. A `useMemo`/`useRef`
  after `if (!open) return null` crashes ("rendered more hooks…"). esbuild does
  NOT catch an undefined LOCAL reference — it surfaces at runtime, so the
  `CashierScreenBoundary` (+ modal boundaries in CashierApp) are load-bearing.
- Dialogs are wrapped in error boundaries so a modal crash can't white-screen
  the whole POS.
- Walk-in guest name is derived from the stable `checkoutKey` (not Math.random)
  so retries don't create differently-named bookings.
- **Scheduled cart-line label:** a line keeps a clean `sectionTitle` (e.g.
  "Party Bookings") SEPARATE from the displayed `meta` ("title - date - time").
  `buildScheduledLine` rebuilds `meta` from `sectionTitle`, and `editCartItem`
  passes `sectionTitle` (not `meta`) into the picker. This stops "Change time"
  from prepending the previous meta onto the new one — which used to compound
  the label on every edit (e.g. three time ranges stacked on one line).

## Known gaps / TODO
- **Check** payment method has no check-number capture (records a "check"
  payment only). Gift card is now fully implemented (see Key flows).
- Gift-card **split tender** (gift card + another method in one go) isn't a
  single flow yet — partial gift card leaves a balance to collect separately.
- `Payment.jsx` and `ShiftClose.jsx` are stubs, hidden from the sidebar. Shift
  close (till count / Z-report) is unbuilt; "End shift" just logs out.
- Bundle ~1.3MB (Lucide full set) — acceptable for a cached kiosk; could
  code-split `CheckIn.jsx` (large) if cold-start matters.
- Print falls back to a message (no OS dialog) when no printer agent.
