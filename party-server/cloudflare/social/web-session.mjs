// Sessions for OpenRetro in the browser (the web build at openretro.com.br).
//
// The desktop app keeps its token in the OS vault and sends it as a Bearer
// header. A web page cannot hide a token from its own scripts, so the web build
// never sees one: the session lives in an HttpOnly cookie on this host.
// - __Host-: Secure, Path=/, no Domain, so only this exact host gets it.
// - SameSite=Strict: browsers send it only from the same site
//   (openretro.com.br and its subdomains), never from other sites.
// - It is accepted only when the request's Origin is the web build, so
//   another subdomain or a page without CORS cannot use it (CSRF).

export const SESSION_COOKIE = "__Host-openretro_session";

/** Where the web build is published. */
const WEB_ORIGINS = [
  "https://openretro.com.br",
  "https://www.openretro.com.br",
];
/** The web build's dev server (npm run dev:play), for a local server only. */
const DEV_WEB_ORIGINS = ["http://127.0.0.1:1422", "http://localhost:1422"];
const LOCAL_HOSTS = ["localhost", "127.0.0.1", "[::1]"];

/** The web build's origin, when the request comes from it. */
export function webOrigin(request) {
  const origin = request.headers.get("Origin");
  if (!origin) return null;
  if (WEB_ORIGINS.includes(origin)) return origin;
  // The dev origins only count on a server that runs on this machine.
  if (
    DEV_WEB_ORIGINS.includes(origin) &&
    LOCAL_HOSTS.includes(new URL(request.url).hostname)
  )
    return origin;
  return null;
}

/** The session token from the cookie, only for requests from the web build. */
export function cookieToken(request) {
  if (!webOrigin(request)) return null;
  for (const part of (request.headers.get("Cookie") || "").split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === SESSION_COOKIE) {
      const value = rest.join("=");
      return /^[a-f0-9]{64}$/.test(value) ? value : null;
    }
  }
  return null;
}

export function sessionCookie(token, expiresAt, now = Date.now()) {
  const maxAge = Math.max(0, Math.floor((expiresAt - now) / 1000));
  return `${SESSION_COOKIE}=${token}; Max-Age=${maxAge}; Path=/; Secure; HttpOnly; SameSite=Strict`;
}

export const clearedSessionCookie = () =>
  `${SESSION_COOKIE}=; Max-Age=0; Path=/; Secure; HttpOnly; SameSite=Strict`;
