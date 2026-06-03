import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import fs from "node:fs";

// When running under `tauri dev`, TAURI_ENV_DEBUG is set
const isTauriBuild = process.env.TAURI_ENV_DEBUG !== undefined;

// Copy the standalone immersive landing page into the web build output so the
// Vercel deployment serves it at /landing-immersive/ alongside the app shell.
// Build-only; the desktop (Tauri) bundle is unaffected at runtime.
function copyLandingImmersive() {
  return {
    name: "copy-landing-immersive",
    apply: "build" as const,
    closeBundle() {
      const src = path.resolve(__dirname, "landing-immersive");
      const dest = path.resolve(__dirname, "dist/landing-immersive");
      if (!fs.existsSync(src)) return;
      fs.cpSync(src, dest, {
        recursive: true,
        filter: (s) => {
          const base = path.basename(s);
          return base !== "README.md" && base !== "vercel.json";
        },
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), copyLandingImmersive()],
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
