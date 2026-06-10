import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const port = Number(env.VITE_PORT || 5173);
  const apiTarget = env.VITE_API_PROXY_TARGET || "http://127.0.0.1:5171";
  const base = env.VITE_BASE_PATH || "/";

  return {
    base,
    plugins: [react()],
    preview: {
      host: "0.0.0.0",
      port,
      strictPort: true,
      allowedHosts: true,
      proxy: {
        "/api": {
          target: apiTarget,
          changeOrigin: true,
        },
      },
    },
    server: {
      host: "0.0.0.0",
      port,
      strictPort: true,
      allowedHosts: ["192.168.2.66", "192.168.2.91"],
      open: false,
      proxy: {
        "/api": {
          target: apiTarget,
          changeOrigin: true,
        },
      },
    },
  };
});
