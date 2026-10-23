/** The permanent token is used only by the Worker; clients receive expiring ICE credentials. */
export async function cloudflareTurn(env, fetcher = fetch) {
  if (env.ALLOW_LOCAL_TEST === "true")
    return { iceServers: [], policy: "all", relay: false };
  if (!env.TURN_KEY_ID || !env.TURN_API_TOKEN)
    throw new Error(
      "O serviço de conexão está indisponível. Tente novamente mais tarde.",
    );
  const response = await fetcher(
    `https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(env.TURN_KEY_ID)}/credentials/generate-ice-servers`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.TURN_API_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ttl: 14400 }),
      signal: AbortSignal.timeout(10000),
    },
  );
  if (!response.ok)
    throw new Error(
      "O serviço de conexão está indisponível. Tente novamente mais tarde.",
    );
  const result = await response.json();
  const servers = Array.isArray(result.iceServers)
    ? result.iceServers
    : [result.iceServers];
  const iceServers = servers
    .filter((server) => server && server.username && server.credential)
    .map((server) => ({
      ...server,
      // Browser WebRTC cannot use TURN over port 53. Keep only relay URLs.
      urls: (Array.isArray(server.urls) ? server.urls : [server.urls]).filter(
        (url) =>
          typeof url === "string" &&
          /^turns?:/.test(url) &&
          !/:53(?:\?|$)/.test(url),
      ),
    }))
    .filter((server) => server.urls.length);
  if (!iceServers.length)
    throw new Error(
      "O serviço de conexão está indisponível. Tente novamente mais tarde.",
    );
  return { iceServers, policy: "relay", relay: true };
}
