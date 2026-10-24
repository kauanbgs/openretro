// Standalone visual fixture; production has no seeded account or simulation route.
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
const server = await createServer({
  configFile: false,
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 1422,
    strictPort: true,
    watch: {
      ignored: ["**/src-tauri/**", "**/party-server/**", "**/.cache/**"],
    },
  },
});
await server.listen();
console.log(
  "Social preview: http://127.0.0.1:1422/tests/fixtures/social-preview.html",
);
