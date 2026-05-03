import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const port = Number(env.VITE_PORT || 5173);

  return {
    plugins: [react()],
    server: {
      host: "0.0.0.0",
      port,
      strictPort: true,
      allowedHosts: ["192.168.2.66", "192.168.2.91"],
      open: false,
    },
  };
});
