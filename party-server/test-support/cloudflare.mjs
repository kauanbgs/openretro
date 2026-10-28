import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";

export async function runtime(bindings = {}, options = {}) {
  const social = (
    await readdir(new URL("../cloudflare/social/", import.meta.url))
  ).filter((name) => name.endsWith(".mjs"));
  return new Miniflare(
    convertV4MiniflareOptions({
      modules: [
        "worker.mjs",
        "turn.mjs",
        ...social.map((name) => `social/${name}`),
      ].map((name) => ({
        type: "ESModule",
        path: fileURLToPath(new URL(`../cloudflare/${name}`, import.meta.url)),
      })),
      compatibilityDate: "2026-10-23",
      durableObjects: {
        DIRECTORY: { className: "PartyDirectory", useSQLite: true },
        ROOMS: { className: "PartyRoom", useSQLite: true },
        SOCIAL_HUB: { className: "SocialHub", useSQLite: true },
      },
      bindings: { ALLOW_LOCAL_TEST: "true", ...bindings },
      serviceBindings: {
        ASSETS: async (request) => {
          const path = new URL(request.url).pathname;
          if (
            ![
              "/index.html",
              "/guest.js",
              "/guest.css",
              "/privacy.html",
              "/privacy.css",
              "/admin.html",
              "/admin.js",
              "/admin.css",
              "/nunito-sans.woff2",
            ].includes(path)
          )
            return new Response("Not found", { status: 404 });
          return new Response(
            await readFile(new URL(`../public${path}`, import.meta.url)),
            {
              headers: {
                "Content-Type": path.endsWith(".woff2")
                  ? "font/woff2"
                  : path.endsWith(".html")
                    ? "text/html; charset=utf-8"
                    : path.endsWith(".js")
                      ? "text/javascript"
                      : "text/css",
              },
            },
          );
        },
      },
      ...options,
    }),
  );
}
