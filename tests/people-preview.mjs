// This dedicated server replaces IPC only; it never connects to real accounts.
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
const server = await createServer({
  configFile: false,
  plugins: [
    react(),
    {
      name: "people-preview-ipc",
      enforce: "pre",
      resolveId(source) {
        if (source.endsWith("/transport"))
          return path.resolve("tests/fixtures/peopleTransport.ts");
      },
    },
  ],
  server: {
    host: "127.0.0.1",
    port: 1423,
    strictPort: true,
    watch: {
      ignored: ["**/src-tauri/**", "**/party-server/**", "**/.cache/**"],
    },
  },
});
await server.listen();
console.log(
  "People preview: http://127.0.0.1:1423/tests/fixtures/people-preview.html",
);
