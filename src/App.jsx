import React from "react";
import { useSelector } from "react-redux";
import { Toaster } from "sonner";
import CashierPage from "./pages/cashier/CashierPage";
import Login from "./pages/Login";

export default function App() {
  const token = useSelector((s) => s.auth?.token);

  return (
    <>
      {token ? <CashierPage /> : <Login />}
      <Toaster
        position="top-center"
        richColors
        toastOptions={{
          style: {
            border: "2px solid var(--ink-800)",
            fontFamily: "var(--font-sans)",
          },
        }}
      />
    </>
  );
}
