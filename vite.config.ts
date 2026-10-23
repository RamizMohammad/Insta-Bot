import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

// In development the API is proxied, so the browser talks to one origin (no CORS needed).
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const target = env.VITE_API_PROXY_TARGET || "http://localhost:8000";
  return {
    plugins: [react()],
    resolve: { alias: { "@": "/src" } },
    server: {
      port: 5173,
      proxy: {
        "/api": { target, changeOrigin: true },
        "/health": { target, changeOrigin: true },
        "/ready": { target, changeOrigin: true },
      },
    },
    preview: { port: 4173 },
    build: { sourcemap: true, chunkSizeWarningLimit: 700 },
  };
});
