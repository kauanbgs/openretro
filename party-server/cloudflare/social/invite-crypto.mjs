import { hmac, verifyHmac } from "./crypto.mjs";
import { AccountError } from "./http.mjs";
export const INVITE_MS = 120000;
export const roomCode = (value) =>
  typeof value === "string" && /^[A-HJ-NP-Z2-9]{6}$/.test(value);
const uuid = (value) =>
  typeof value === "string" &&
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
export const inviteConfigured = (env) =>
  typeof env.PARTY_TICKET_SECRET === "string" &&
  env.PARTY_TICKET_SECRET.length >= 32;
export const roomCall = (env, code, action, value) =>
  env.ROOMS.get(env.ROOMS.idFromName(code)).fetch(
    `https://internal/social-${action}`,
    { method: "POST", body: JSON.stringify(value) },
  );
const encode = (value) =>
  btoa(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
export async function signInvite(env, data, now = Date.now()) {
  if (!inviteConfigured(env))
    throw new AccountError(
      503,
      "Os convites de amigos ainda não estão disponíveis.",
    );
  const payload = encode(
    JSON.stringify({
      v: 1,
      ...data,
      issuedAt: now,
      expiresAt: now + INVITE_MS,
      nonce: crypto.randomUUID(),
    }),
  );
  return `${payload}.${await hmac(env.PARTY_TICKET_SECRET, `party-invite.v1.${payload}`)}`;
}
export async function verifyInvite(env, token, now = Date.now()) {
  try {
    if (
      !inviteConfigured(env) ||
      typeof token !== "string" ||
      token.length > 2048 ||
      !/^[A-Za-z0-9_-]+\.[a-f0-9]{64}$/.test(token)
    )
      return null;
    const [encoded, signature] = token.split(".");
    if (
      !(await verifyHmac(
        env.PARTY_TICKET_SECRET,
        `party-invite.v1.${encoded}`,
        signature,
      ))
    )
      return null;
    const data = JSON.parse(
      atob(encoded.replace(/-/g, "+").replace(/_/g, "/")),
    );
    if (
      Object.keys(data).sort().join(",") !==
        "epoch,expiresAt,guestId,hostId,issuedAt,nonce,room,sessionId,v" ||
      data.v !== 1 ||
      !roomCode(data.room) ||
      ![
        data.hostId,
        data.guestId,
        data.sessionId,
        data.epoch,
        data.nonce,
      ].every(uuid) ||
      !Number.isSafeInteger(data.issuedAt) ||
      !Number.isSafeInteger(data.expiresAt) ||
      data.issuedAt > now + 5000 ||
      data.expiresAt <= now ||
      data.expiresAt <= data.issuedAt ||
      data.expiresAt - data.issuedAt > INVITE_MS
    )
      return null;
    return data;
  } catch {
    return null;
  }
}
