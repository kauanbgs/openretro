import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss()],
  // The web build (--mode play) can be served from any folder of a site.
  base: mode === "play" ? "./" : "/",
  clearScreen: false,
  server: {
    port: mode === "play" ? 1422 : 1420,
    strictPort: true,
    watch: { ignored: ["**/src-tauri/**", "**/.cache/**"] },
  },
  envPrefix: ["VITE_", "TAURI_ENV_"],
  build: {
    target: "es2022",
    outDir: mode === "play" ? "dist-play" : "dist",
  },
}));
