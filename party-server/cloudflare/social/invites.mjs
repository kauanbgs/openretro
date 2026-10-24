import { AccountError, readJson } from "./http.mjs";
import { related } from "./friends.mjs";
import { presenceFor } from "./hub.mjs";
import { quota } from "./limits.mjs";

import {
  inviteConfigured,
  roomCall,
  roomCode,
  signInvite,
} from "./invite-crypto.mjs";
export {
  inviteConfigured,
  signInvite,
  verifyInvite,
} from "./invite-crypto.mjs";
const uuid = (value) =>
  typeof value === "string" &&
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
export async function hostAvailable(env, social, now = Date.now()) {
  if (!social?.joinable || !env.SOCIAL_DB) return false;
  return !!(await env.SOCIAL_DB.withSession("first-primary")
    .prepare(
      `SELECT 1 FROM users u JOIN sessions s ON s.user_id=u.id WHERE u.id=? AND s.id=? AND s.expires_at>? AND u.appear_offline=0`,
    )
    .bind(social.owner, social.sessionId, now)
    .first());
}
export async function authorizedParty(env, owner, sessionId, party) {
  if (!party) return null;
  const response = await roomCall(env, party.code, "status", {
    owner,
    sessionId,
  });
  return response.ok && (await response.json()).joinable
    ? { code: party.code, joinable: true }
    : null;
}
export async function partyRoute(
  request,
  env,
  url,
  { db, user, session, now },
) {
  if (request.method !== "POST")
    throw new AccountError(405, "Método inválido.");
  const data = await readJson(request);
  if (url.pathname === "/api/friends/party/host") {
    if (
      Object.keys(data).some(
        (key) => !["code", "ticket", "joinable"].includes(key),
      ) ||
      !roomCode(data.code) ||
      typeof data.ticket !== "string" ||
      !/^[a-f0-9]{64}$/.test(data.ticket) ||
      typeof data.joinable !== "boolean"
    )
      throw new AccountError(400, "Dados do Party inválidos.");
    if (data.joinable && !inviteConfigured(env))
      throw new AccountError(
        503,
        "Os convites de amigos ainda não estão disponíveis.",
      );
    await quota(db, env.AUTH_PEPPER, "party-host", user.id, 120, now);
    const response = await roomCall(env, data.code, "bind", {
      owner: user.id,
      sessionId: session.id,
      ticket: data.ticket,
      joinable: data.joinable,
    });
    if (!response.ok)
      throw new AccountError(
        response.status,
        "Não foi possível atualizar o acesso dos amigos ao Party.",
      );
    return { data: { ok: true } };
  }
  if (url.pathname !== "/api/friends/party/join")
    throw new AccountError(404, "Página não encontrada.");
  if (Object.keys(data).length !== 1 || !uuid(data.friendId))
    throw new AccountError(400, "Jogador inválido.");
  await quota(db, env.AUTH_PEPPER, "party-invites", user.id, 60, now);
  if (!(await related(db, user.id, data.friendId)))
    throw new AccountError(403, "Este Party não está disponível para você.");
  const presence = await presenceFor(env, user.id, data.friendId);
  if (!presence.party?.joinable || presence.status === "offline")
    throw new AccountError(409, "Este amigo não está com um Party aberto.");
  const response = await roomCall(env, presence.party.code, "issue", {
    hostId: data.friendId,
    guestId: user.id,
    sessionId: session.id,
  });
  if (!response.ok)
    throw new AccountError(
      response.status,
      "Este Party não está disponível para você.",
    );
  return { data: await response.json() };
}
