import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { igdbPlugin } from "./server/igdb";

export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss(), igdbPlugin()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: { ignored: ["**/src-tauri/**", "**/.cache/**"] },
  },
  envPrefix: ["VITE_", "TAURI_ENV_"],
  base: mode === "tizen" ? "./" : "/",
  build: {
    target: mode === "tizen" ? "chrome69" : "es2022",
    outDir: mode === "tizen" ? "dist-tizen" : "dist",
  },
}));
