import { createSlice } from "@reduxjs/toolkit";

export const CASHIER_SESSION_MAX_MS = 8 * 60 * 60 * 1000;

const initialState = {
  token: null,
  user: null,
  locations: [],
  session: null,
};

const authSlice = createSlice({
  name: "auth",
  initialState,
  reducers: {
    loginSuccess: (state, action) => {
      const now = Date.now();
      state.token = action.payload.token;
      state.user = action.payload.user;
      state.locations = action.payload.locations || [];
      state.session = {
        loggedInAt: action.payload.loggedInAt || now,
        expiresAt: action.payload.expiresAt || now + CASHIER_SESSION_MAX_MS,
      };
    },
    logout: (state) => {
      state.token = null;
      state.user = null;
      state.locations = [];
      state.session = null;
    },
  },
});

export const { loginSuccess, logout } = authSlice.actions;
export default authSlice.reducer;
