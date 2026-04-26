import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    strictPort: true,  // fail loudly if 5174 is taken instead of silently shifting
    open: false,
  },
});
