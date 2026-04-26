import { createSlice } from "@reduxjs/toolkit";

const initialState = {
  token: null,
  user: null,
  venues: [],
};

const authSlice = createSlice({
  name: "auth",
  initialState,
  reducers: {
    loginSuccess: (state, action) => {
      state.token = action.payload.token;
      state.user = action.payload.user;
      state.venues = action.payload.venues || [];
    },
    logout: (state) => {
      state.token = null;
      state.user = null;
      state.venues = [];
    },
  },
});

export const { loginSuccess, logout } = authSlice.actions;
export default authSlice.reducer;
