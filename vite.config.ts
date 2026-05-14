import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

// When running under `tauri dev`, TAURI_ENV_DEBUG is set
const isTauriBuild = process.env.TAURI_ENV_DEBUG !== undefined;

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  server: {
    // Tauri expects the dev server on 1420; plain `pnpm dev` uses 1420 too
    // (set in the `dev` script) so the URL stays consistent.
    port: 1420,
    strictPort: true,
    host: "127.0.0.1",
    // Tauri reads HMR over the same port — no separate WS port needed
    hmr: isTauriBuild ? { protocol: "ws", host: "127.0.0.1", port: 1420 } : true,
  },
  build: {
    outDir: "dist",
    sourcemap: true,
    target: "es2022",
  },
  // Prevent Vite from mangling the environment variable Tauri injects
  envPrefix: ["VITE_", "TAURI_"],
});
