import { createServer } from "vite";
import react from "@vitejs/plugin-react";
const server = await createServer({
  configFile: false,
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 1425,
    strictPort: true,
    watch: {
      ignored: ["**/src-tauri/**", "**/party-server/**", "**/.cache/**"],
    },
  },
});
await server.listen();
console.log(
  "Game page preview: http://127.0.0.1:1425/tests/fixtures/game-preview.html",
);
