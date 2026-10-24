// A separate Vite server replaces only the native account boundary for visual QA.
// The production app has no preview route or authentication bypass.
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
const server = await createServer({
  configFile: false,
  plugins: [
    react(),
    {
      name: "party-preview-account",
      enforce: "pre",
      resolveId(source) {
        if (source.endsWith("/services/social"))
          return path.resolve("tests/fixtures/partyGuestSocial.ts");
      },
    },
  ],
  server: {
    host: "127.0.0.1",
    port: 1421,
    strictPort: true,
    watch: {
      ignored: ["**/src-tauri/**", "**/party-server/**", "**/dist-runtime/**"],
    },
  },
});
await server.listen();
console.log(
  "Party guest preview: http://127.0.0.1:1421/tests/fixtures/party-guest.html",
);
