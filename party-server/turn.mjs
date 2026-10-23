import { createHmac, randomBytes } from "node:crypto";

/** Coturn REST authentication: only expiring credentials leave the server. */
export function turnConfiguration(config, now = Date.now()) {
  const urls = (config.TURN_URLS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (config.TURN_SECRET && urls.length) {
    if (urls.some((url) => !/^turns?:[^\s]+$/.test(url)))
      throw new Error("TURN_URLS deve conter endereços turn: ou turns:.");
    const username = `${Math.floor(now / 1000) + 14400}:${randomBytes(12).toString("hex")}`;
    const credential = createHmac("sha1", config.TURN_SECRET)
      .update(username)
      .digest("base64");
    return {
      iceServers: [{ urls, username, credential }],
      policy: "relay",
      relay: true,
    };
  }
  if (config.ALLOW_STUN_ONLY === "true")
    return { iceServers: [], policy: "all", relay: false };
  throw new Error(
    "O serviço de conexão está indisponível. Tente novamente mais tarde.",
  );
}
