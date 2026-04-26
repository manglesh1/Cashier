import { createSlice } from "@reduxjs/toolkit";

const initialState = {
  token: null,
  user: null,
  locations: [],
};

const authSlice = createSlice({
  name: "auth",
  initialState,
  reducers: {
    loginSuccess: (state, action) => {
      state.token = action.payload.token;
      state.user = action.payload.user;
      state.locations = action.payload.locations || [];
    },
    logout: (state) => {
      state.token = null;
      state.user = null;
      state.locations = [];
    },
  },
});

export const { loginSuccess, logout } = authSlice.actions;
export default authSlice.reducer;
