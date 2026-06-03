import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import fs from "node:fs";

// When running under `tauri dev`, TAURI_ENV_DEBUG is set
const isTauriBuild = process.env.TAURI_ENV_DEBUG !== undefined;

// Copy the standalone static landing pages into the web build output so the
// Vercel deployment serves each at its own path alongside the app shell.
// Build-only; the desktop (Tauri) bundle is unaffected at runtime.
function copyLandingPages() {
  // [source folder, output path under dist/]
  const pages: Array<[string, string]> = [
    ["landing", "landing"],
    ["landing v0.5", "landing-v0.5"],
    ["landing-immersive", "landing-immersive"],
  ];
  return {
    name: "copy-landing-pages",
    apply: "build" as const,
    closeBundle() {
      for (const [from, to] of pages) {
        const src = path.resolve(__dirname, from);
        const dest = path.resolve(__dirname, "dist", to);
        if (!fs.existsSync(src)) continue;
        fs.cpSync(src, dest, {
          recursive: true,
          filter: (s) => {
            const base = path.basename(s);
            return base !== "README.md" && base !== "vercel.json";
          },
        });
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), copyLandingPages()],
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
