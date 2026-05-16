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
    port: 1420,
    strictPort: true,
    host: "127.0.0.1",
    hmr: isTauriBuild ? { protocol: "ws", host: "127.0.0.1", port: 1420 } : true,
    // Don't reload when .env changes — credentials are loaded by the shell
    // before Tauri starts; reloading causes spurious restarts.
    watch: {
      ignored: ["**/.env", "**/.env.*", "!**/.env.example"],
    },
  },
  build: {
    outDir: "dist",
    sourcemap: true,
    target: "es2022",
  },
  envPrefix: ["VITE_", "TAURI_"],
});
