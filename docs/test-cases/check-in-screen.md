# Check-In Screen Test Cases

Scope: Cashier POS check-in screen, booking list buckets, guest check-in, waiver assignment, invoice/order adjustment, add-item popup, and payment rail.

## Preconditions

- User is logged into Cashier with a paired terminal and location.
- Today has at least one booking with session tickets.
- At least one booking has unpaid balance.
- At least one booking has 3+ guests.
- At least one booking has valid signed waiver coverage.
- At least one booking has party/session extras configured.
- Backend and Cashier frontend are restarted after latest changes.

## Booking List Buckets

### CHK-001 Upcoming Tab Shows Not-Started Bookings
- Open Cashier > Check-in.
- Select `Upcoming`.
- Expected: bookings with `checkedInGuests = 0` appear.
- Expected: bookings fully checked in do not appear.
- Expected: count on tab matches visible list count.

### CHK-002 In Progress Tab Shows Partial Check-ins
- Check in one guest from a multi-guest booking.
- Select `In Progress`.
- Expected: booking appears with partial check-in count.
- Expected: booking does not appear in `Upcoming`.

### CHK-003 Completed Tab Shows Last 2 Hours Only
- Fully check in a booking.
- Select `Completed`.
- Expected: booking appears after completion.
- Expected: older completed bookings outside 2 hours do not appear.
- Expected empty state says no bookings completed in last 2 hours when none qualify.

## Waiver And Guest Assignment

### CHK-004 Add From Waiver Opens Clean Search
- Open selected booking.
- Click `Add from waiver`.
- Type a search and close modal.
- Reopen `Add from waiver`.
- Expected: search field is empty.
- Expected: no stale search results are shown.

### CHK-005 Waiver Search Shows People Individually
- Search a waiver signer with minors.
- Expected: signer and each minor show as separate selectable cards.
- Expected: each card shows role and DOB when available.

### CHK-006 Assign Waiver To Missing Ticket
- Pick a waiver holder for a ticket requiring waiver.
- Expected: ticket row displays holder chip.
- Expected: warning changes from `Waiver required` to assignable/check-in ready.

## Check-In Actions

### CHK-007 Check In One Guest
- Click the check button on one eligible ticket row.
- Expected: ticket status updates to redeemed.
- Expected: check-in count increases.
- Expected: booking bucket may move from Upcoming to In Progress.

### CHK-008 Check In All Guests
- Ensure all required waivers are assigned.
- Click `All`.
- Expected: success toast says `Redeemed X of X`.
- Expected: all rows show checked-in/redeemed.
- Expected: booking moves to Completed.

### CHK-009 Check In All Failure Shows Error
- Use a booking with unresolved waiver-required tickets.
- Click `All`.
- Expected: toast is warning/error, not green success.
- Expected: message includes failure reason, such as `waiver required`.

## Payment Rail

### CHK-010 Payment Available Before Check-in
- Select unpaid booking with zero guests checked in.
- Expected: right rail shows `Payment available`.
- Expected: `Take payment` button is enabled.

### CHK-011 Payment Rail Shows Totals
- Select booking with subtotal, tax, and unpaid balance.
- Expected: invoice rail shows subtotal, discount if any, tax, amount paid, and balance due.

### CHK-012 Multiple Payments Update Balance
- Take partial payment.
- Close payment dialog.
- Expected: amount paid increases.
- Expected: balance due decreases.
- Expected: payment remains available if balance remains.

## Invoice Quantity Adjustment

### CHK-013 Increase Session Quantity
- Select booking with `STC Demo 1 Hour Jump Pass`.
- In invoice rail, click `+` on that line.
- Expected: quantity increases by 1.
- Expected: subtotal/total/balance update.
- Expected: one new ticket row appears after refresh.

### CHK-014 Decrease Session Quantity
- Select booking with multiple unredeemed session tickets.
- Click `-` on session line.
- Expected: quantity decreases by 1.
- Expected: subtotal/total/balance update.
- Expected: one unredeemed ticket is voided/removed from active check-in list.

### CHK-015 Cannot Reduce Below Redeemed Count
- Fully or partially check in guests.
- Try reducing session quantity below redeemed ticket count.
- Expected: update is blocked.
- Expected: error explains quantity cannot be below already checked-in guests.

## Add Item Popup

### CHK-016 Party Extras Tab
- Click `Add item`.
- Select `Party extras`.
- Expected: configured extras for the booked party/session are listed.
- Expected: each row shows product, variation, price, quantity controls, and Add button.

### CHK-017 All Products Search
- Click `Add item`.
- Select `All products`.
- Search for a snack/add-on.
- Expected: matching add-on/stock products appear.
- Expected: unrelated scheduled session products are not addable in this first pass.

### CHK-018 Add Extra Item
- In Add Item popup, choose an extra and click `Add`.
- Expected: modal closes.
- Expected: item appears in invoice rail.
- Expected: subtotal/total/balance update.

### CHK-019 Adjust Added Extra Quantity
- Add an extra item.
- Click `+` and `-` on that invoice line.
- Expected: quantity and line total update.
- Expected: reducing to zero removes the item.

## Embedded Booking Editor Refresh

### CHK-020 Admin Editor Save Refreshes Check-In
- Click `Edit booking`.
- Update order in embedded admin editor and save.
- Expected: check-in screen refreshes without needing Back.
- Expected: invoice items, tickets, totals, and payment rail reflect saved changes.

### CHK-021 Back To Check-In Refreshes
- Click `Edit booking`.
- Click `Back to check-in`.
- Expected: editor closes.
- Expected: selected booking, tickets, and payment rail refresh.

