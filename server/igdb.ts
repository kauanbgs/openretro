import type { Plugin } from "vite";
import { loadEnv } from "vite";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  CatalogRequest,
  CatalogReply,
} from "../src/providers/metadata/types";

const fields =
  "id,name,slug,summary,first_release_date,genres.id,genres.name,platforms.id,platforms.name,cover.image_id,total_rating,total_rating_count";
const detailFields = `${fields},storyline,artworks.image_id,screenshots.image_id,involved_companies.developer,involved_companies.company.name`;
const sorts = {
  popular: "total_rating_count desc",
  rating: "total_rating desc",
  title: "name asc",
  newest: "first_release_date desc",
  oldest: "first_release_date asc",
};

export function buildIgdbQuery(request: CatalogRequest): {
  endpoint: string;
  body: string;
} {
  if (
    !request ||
    !["platforms", "genres", "games", "game"].includes(request.kind)
  )
    throw new Error("Unsupported catalog operation.");
  const page = request.page ?? 1;
  if (!Number.isInteger(page) || page < 1 || page > 1000)
    throw new Error("Invalid catalog page.");
  const ids = request.ids ?? [];
  if (
    !Array.isArray(ids) ||
    ids.length > 100 ||
    ids.some((id) => !Number.isSafeInteger(id) || id < 1)
  )
    throw new Error("Invalid catalog identifiers.");
  if (
    request.genreId !== undefined &&
    (!Number.isSafeInteger(request.genreId) || request.genreId < 1)
  )
    throw new Error("Invalid genre.");
  if (request.sort !== undefined && !Object.hasOwn(sorts, request.sort))
    throw new Error("Invalid catalog sort order.");
  if (request.kind === "platforms")
    return {
      endpoint: "platforms",
      body: "fields id,name,slug,abbreviation; sort id asc; limit 500;",
    };
  if (request.kind === "genres")
    return {
      endpoint: "genres",
      body: "fields id,name; sort name asc; limit 500;",
    };
  if (!ids.length) throw new Error("Choose at least one supported console.");
  if (request.kind === "game") {
    if (ids.length !== 1) throw new Error("Choose one game.");
    return {
      endpoint: "games",
      body: `fields ${detailFields}; where id = ${ids[0]}; limit 1;`,
    };
  }
  const query = (request.query ?? "").trim();
  if (query.length > 120)
    throw new Error("Search must be 120 characters or fewer.");
  const conditions = [`platforms = (${ids.join(",")})`];
  if (request.genreId) conditions.push(`genres = (${request.genreId})`);
  const sort = request.sort ?? "popular";
  if (!query && sort === "rating") conditions.push("total_rating_count >= 5");
  const order = query
    ? `search ${JSON.stringify(query)};`
    : `sort ${sorts[sort]};`;
  return {
    endpoint: "games",
    body: `fields ${fields}; ${order} where ${conditions.join(" & ")}; limit 25; offset ${(page - 1) * 24};`,
  };
}

export function sanitizeIgdbReply(
  body: unknown,
  request: CatalogRequest,
): CatalogReply {
  if (!Array.isArray(body))
    throw new Error("IGDB returned an invalid response.");
  const games = request.kind === "games";
  return {
    data: {
      [request.kind === "game" ? "games" : request.kind]: games
        ? body.slice(0, 24)
        : body,
    },
    hasNext: games && body.length > 24,
    page: request.page ?? 1,
    remainingAllowance: null,
  };
}

export function igdbPlugin(): Plugin {
  let root = "",
    mode = "";
  let queue: Promise<unknown> = Promise.resolve();
  let lastRequest = 0;
  let token:
    | {
        value: string;
        expires: number;
        clientId: string;
        secretFingerprint: string;
      }
    | undefined;
  const inFlight = new Map<string, Promise<CatalogReply>>();
  const credentials = () => {
    const env = loadEnv(mode, root, "");
    return {
      clientId: env.IGDB_CLIENT_ID?.trim() ?? "",
      clientSecret: env.IGDB_CLIENT_SECRET?.trim() ?? "",
    };
  };
  return {
    name: "openretro-igdb",
    configResolved(config) {
      root = config.root;
      mode = config.mode;
    },
    configureServer(server) {
      server.middlewares.use("/api/igdb", async (req, res) => {
        res.setHeader("Content-Type", "application/json");
        res.setHeader("Cache-Control", "no-store");
        const fail = (status: number, message: string) => {
          res.statusCode = status;
          res.end(JSON.stringify({ error: message }));
        };
        const host = req.headers.host;
        if (
          !host ||
          !["127.0.0.1:1420", "localhost:1420"].includes(host) ||
          (req.headers.origin &&
            !["http://127.0.0.1:1420", "http://localhost:1420"].includes(
              req.headers.origin,
            ))
        )
          return fail(
            403,
            "Catalog access is limited to the local OpenRetro app.",
          );
        const { clientId, clientSecret } = credentials();
        if (req.method === "GET" && req.url === "/status") {
          res.end(
            JSON.stringify({
              configured: Boolean(clientId && clientSecret),
              provider: "igdb",
            }),
          );
          return;
        }
        if (
          req.method !== "POST" ||
          req.url !== "/query" ||
          !req.headers["content-type"]?.startsWith("application/json")
        )
          return fail(400, "Invalid catalog request.");
        if (!clientId || !clientSecret)
          return fail(
            503,
            "IGDB_NOT_CONFIGURED: Add IGDB_CLIENT_ID and IGDB_CLIENT_SECRET to .env.local.",
          );
        let raw = "";
        try {
          for await (const chunk of req) {
            raw += chunk;
            if (raw.length > 8192)
              return fail(413, "Catalog request is too large.");
          }
          const request = JSON.parse(raw) as CatalogRequest;
          const query = buildIgdbQuery(request);
          const cacheKey = createHash("sha256")
            .update(`${query.endpoint}:${query.body}`)
            .digest("hex");
          const cacheDir = path.join(root, ".cache", "igdb"),
            cacheFile = path.join(cacheDir, `${cacheKey}.json`);
          const ttl = ["platforms", "genres"].includes(request.kind)
            ? 7 * 86400000
            : 86400000;
          try {
            const cached = JSON.parse(await readFile(cacheFile, "utf8"));
            if (Date.now() - cached.savedAt < ttl) {
              res.end(JSON.stringify(cached.value));
              return;
            }
          } catch {
            /* Cache misses do not prevent an API request. */
          }
          let pending = inFlight.get(cacheKey);
          if (!pending) {
            const task = async () => {
              const secretFingerprint = createHash("sha256")
                .update(clientSecret)
                .digest("hex");
              for (let attempt = 0; attempt < 2; attempt++) {
                if (
                  !token ||
                  token.expires <= Date.now() ||
                  token.clientId !== clientId ||
                  token.secretFingerprint !== secretFingerprint
                ) {
                  let auth: Response;
                  try {
                    auth = await fetch("https://id.twitch.tv/oauth2/token", {
                      method: "POST",
                      headers: {
                        "Content-Type": "application/x-www-form-urlencoded",
                      },
                      body: new URLSearchParams({
                        client_id: clientId,
                        client_secret: clientSecret,
                        grant_type: "client_credentials",
                      }),
                      signal: AbortSignal.timeout(20000),
                      redirect: "error",
                    });
                  } catch {
                    throw new Error(
                      "Twitch authentication could not be reached. Check your connection.",
                    );
                  }
                  if (!auth.ok)
                    throw new Error(
                      "Twitch rejected the application credentials. Check Client ID and Client Secret, and use a Confidential application.",
                    );
                  const value = (await auth.json().catch(() => {
                    throw new Error(
                      "Twitch returned an invalid authentication response.",
                    );
                  })) as {
                    access_token?: string;
                    expires_in?: number;
                  };
                  if (!value.access_token || !value.expires_in)
                    throw new Error(
                      "Twitch returned an invalid authentication response.",
                    );
                  token = {
                    value: value.access_token,
                    expires:
                      Date.now() + Math.max(0, value.expires_in - 60) * 1000,
                    clientId,
                    secretFingerprint,
                  };
                }
                const delay = Math.max(0, 300 - (Date.now() - lastRequest));
                if (delay) await new Promise((r) => setTimeout(r, delay));
                lastRequest = Date.now();
                let response: Response;
                try {
                  response = await fetch(
                    `https://api.igdb.com/v4/${query.endpoint}`,
                    {
                      method: "POST",
                      headers: {
                        "Client-ID": clientId,
                        Authorization: `Bearer ${token.value}`,
                        "Content-Type": "text/plain",
                      },
                      body: query.body,
                      signal: AbortSignal.timeout(20000),
                      redirect: "error",
                    },
                  );
                } catch {
                  throw new Error(
                    "IGDB could not be reached. Check your connection and try again.",
                  );
                }
                if (response.status === 401 && attempt === 0) {
                  token = undefined;
                  continue;
                }
                if (response.status === 401 || response.status === 403)
                  throw new Error(
                    "IGDB rejected the credentials. Check your Twitch application settings.",
                  );
                if (response.status === 429)
                  throw new Error(
                    "IGDB rate limit reached. Wait a moment and try again.",
                  );
                if (!response.ok)
                  throw new Error(
                    `IGDB could not complete this query (HTTP ${response.status}). Try again later.`,
                  );
                const text = await response.text();
                if (text.length > 8388608)
                  throw new Error(
                    "IGDB response exceeded the safe size limit.",
                  );
                let parsed: unknown;
                try {
                  parsed = JSON.parse(text);
                } catch {
                  throw new Error(
                    "IGDB returned an invalid response. Try again later.",
                  );
                }
                const value = sanitizeIgdbReply(parsed, request);
                // Credentials and OAuth tokens are never persisted with public metadata.
                try {
                  await mkdir(cacheDir, { recursive: true });
                  await writeFile(
                    cacheFile,
                    JSON.stringify({ savedAt: Date.now(), value }),
                  );
                } catch {
                  /* A read-only cache does not make the catalog unavailable. */
                }
                return value;
              }
              throw new Error("IGDB authentication expired. Try again.");
            };
            pending = queue.then(task, task);
            queue = pending.catch(() => {});
            inFlight.set(cacheKey, pending);
            void pending
              .finally(() => inFlight.delete(cacheKey))
              .catch(() => {});
          }
          res.end(JSON.stringify(await pending));
        } catch (e) {
          fail(
            400,
            e instanceof Error ? e.message : "The catalog request failed.",
          );
        }
      });
    },
  };
}
