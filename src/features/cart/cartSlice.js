import { createSlice, nanoid } from "@reduxjs/toolkit";

// Cashier cart state. Lives in Redux (not useState) so the cart survives:
//   • route changes inside the POS (Sell → Check-in → Sell)
//   • accidental refreshes / pull-to-refresh on tablets
//   • full app reloads (redux-persist rehydrates from localStorage)
//
// Transient UI state (modal open flags, paymentBooking draft, scheduleRequiredItem)
// stays in component useState — we explicitly do NOT want a half-open payment
// dialog or in-progress schedule picker to survive a refresh.

const initialState = {
  items: [],
  cartCustomer: null,
  waiversAttached: [],
  ticketAssignments: {},
  appliedBenefits: { promo: null, member: null, vouchers: [], payments: [] },
  // Stable key for the current checkout attempt. Reused across retries
  // (so a duplicate createBooking on flaky wifi is deduped by the backend),
  // rotated on success or when the cashier explicitly clears the cart.
  checkoutKey: null,
};

const cartSlice = createSlice({
  name: "cart",
  initialState,
  reducers: {
    setCartItems: (state, action) => {
      state.items = action.payload;
    },
    setCartCustomer: (state, action) => {
      state.cartCustomer = action.payload;
    },
    setWaiversAttached: (state, action) => {
      state.waiversAttached = action.payload;
    },
    setTicketAssignments: (state, action) => {
      state.ticketAssignments = action.payload;
    },
    setAppliedBenefits: (state, action) => {
      state.appliedBenefits = action.payload;
    },
    // Generate a key if we don't have one yet. Called at the start of every
    // checkout so the same payload retried twice carries the same key.
    ensureCheckoutKey: (state) => {
      if (!state.checkoutKey) {
        state.checkoutKey = `co_${nanoid()}`;
      }
    },
    // After a successful booking, rotate so the next checkout gets a new key.
    rotateCheckoutKey: (state) => {
      state.checkoutKey = null;
    },
    clearCart: () => initialState,
  },
});

export const {
  setCartItems,
  setCartCustomer,
  setWaiversAttached,
  setTicketAssignments,
  setAppliedBenefits,
  ensureCheckoutKey,
  rotateCheckoutKey,
  clearCart,
} = cartSlice.actions;

export default cartSlice.reducer;
