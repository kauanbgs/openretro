import { accountRoute } from "./auth.mjs";
import { AccountError } from "./http.mjs";
import { friendsRoute } from "./friends.mjs";
import { adminRoute } from "./admin.mjs";
import { playtestRoute } from "./playtest.mjs";

export async function socialResponse(request, env, { allowed, headers }) {
  const reply = (data, status, extra = {}) =>
    new Response(status === 204 ? null : JSON.stringify(data), {
      status,
      headers: {
        ...headers,
        "Content-Type": "application/json; charset=utf-8",
        ...extra,
      },
    });
  if (!allowed) return reply({ error: "Origem não permitida." }, 403);
  if (request.method === "OPTIONS")
    return reply(null, 204, {
      "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Max-Age": "600",
    });
  try {
    const pathname = new URL(request.url).pathname;
    const result = await (
      pathname.startsWith("/api/admin/")
        ? adminRoute
        : pathname.startsWith("/api/playtest/")
          ? playtestRoute
          : pathname === "/social" || pathname.startsWith("/api/friends")
            ? friendsRoute
            : accountRoute
    )(request, env, new URL(request.url));
    if (result.response) return result.response;
    // Routes may add headers, such as the web build's session cookie.
    const { data, status = 200, attachment, headers: extra = {} } = result;
    return reply(data, status, {
      ...extra,
      ...(attachment
        ? {
            "Content-Disposition":
              'attachment; filename="openretro-conta.json"',
          }
        : {}),
    });
  } catch (error) {
    if (error instanceof AccountError)
      return reply(
        {
          error: error.message,
          ...(error.retryAfter ? { retryAfter: error.retryAfter } : {}),
        },
        error.status,
        error.retryAfter ? { "Retry-After": String(error.retryAfter) } : {},
      );
    // D1/provider errors may contain PII. Return a stable message without logging them.
    return reply(
      {
        error:
          "O serviço de conta está indisponível. Tente novamente mais tarde.",
      },
      503,
    );
  }
}
