import {
  codeMessage,
  emailHash,
  hmac,
  loginCode,
  randomToken,
  sha256,
  verifyHmac,
} from "./crypto.mjs";
import {
  AccountError,
  localDevelopment,
  normalizeEmail,
  readJson,
  unavailable,
} from "./http.mjs";
import { USER_QUOTA_SCOPES, emailQuotaKey, quota } from "./limits.mjs";
import { sendLoginEmail } from "./email.mjs";
import { notifyUsers } from "./friends.mjs";
import {
  availableFriendCode,
  chosenTag,
  friendCodeFor,
} from "./friend-code.mjs";

const CODE_MS = 10 * 60 * 1000;
const SESSION_MS = 90 * 24 * 60 * 60 * 1000;
const RESEND_MS = 60 * 1000;
const invalidCode =
  "Código inválido ou expirado. Confira o e-mail ou peça outro código.";
const invalidSession = () =>
  new AccountError(401, "Sua sessão expirou. Entre novamente.");
/** The preset icons the app draws; 0 to AVATARS - 1. */
export const AVATARS = 15;
// A new account starts with a random icon; the player can change it later.
const randomAvatar = () =>
  crypto.getRandomValues(new Uint32Array(1))[0] % AVATARS;
const validAvatar = (value) =>
  Number.isInteger(value) && value >= 0 && value < AVATARS;
/** Accounts named before codes followed names still read "jogador#…". The
 * session check moves them to their name when that code is free; SQL alone
 * cannot strip accents, so this runs here instead of in a migration. */
async function alignFriendCode(db, user) {
  if (!user.display_name) return user;
  const wanted = friendCodeFor(
    user.display_name,
    user.friend_code.split("#")[1],
  );
  if (wanted === user.friend_code) return user;
  const updated = await db
    .prepare(
      `UPDATE users SET friend_code = ? WHERE id = ? AND friend_code = ?
      AND NOT EXISTS (SELECT 1 FROM users other WHERE other.friend_code = ? AND other.id <> ?) RETURNING *`,
    )
    .bind(wanted, user.id, user.friend_code, wanted, user.id)
    .first();
  return updated ?? user;
}
export function publicUser(row) {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    friendCode: row.friend_code,
    avatar: row.avatar ?? 0,
    showPlaying: Boolean(row.show_playing),
    appearOffline: Boolean(row.appear_offline),
    discoverable: Boolean(row.discoverable),
    shareHistory: Boolean(row.share_history),
    createdAt: row.created_at,
  };
}
export function database(env, url) {
  if (
    url.protocol !== "https:" &&
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
  )
    throw new AccountError(
      400,
      "Use uma conexão HTTPS para acessar sua conta.",
    );
  if (
    !env.SOCIAL_DB ||
    typeof env.AUTH_PEPPER !== "string" ||
    env.AUTH_PEPPER.length < 32
  )
    throw unavailable();
  if (env.SOCIAL_DEV_MODE === "true" && !localDevelopment(env, url))
    throw unavailable();
  // Auth must not read stale replicas after a logout or a consumed code.
  return env.SOCIAL_DB.withSession("first-primary");
}
async function start(request, env, db, url, now) {
  const { email: raw } = await readJson(request);
  const email = normalizeEmail(raw);
  const local = localDevelopment(env, url);
  if (
    (!env.RESEND_API_KEY && !local) ||
    (env.RESEND_API_KEY && (!env.EMAIL_FROM || /[\r\n]/.test(env.EMAIL_FROM)))
  )
    throw unavailable();
  const ip = request.headers.get("CF-Connecting-IP") || "local";
  await quota(
    db,
    env.AUTH_PEPPER,
    "start-ip",
    `${Math.floor(now / 86400000)}:${ip}`,
    10,
    now,
  );
  const subject = await emailHash(env.AUTH_PEPPER, email);
  const previous = await db
    .prepare("SELECT created_at FROM login_codes WHERE email_hash = ?")
    .bind(subject)
    .first();
  if (previous && previous.created_at > now - RESEND_MS)
    throw new AccountError(
      429,
      "Aguarde um minuto antes de pedir outro código.",
      Math.max(1, Math.ceil((previous.created_at + RESEND_MS - now) / 1000)),
    );
  await quota(db, env.AUTH_PEPPER, "start-email", email, 3, now);
  const code = loginCode(),
    challenge = crypto.randomUUID();
  const digest = await hmac(
    env.AUTH_PEPPER,
    codeMessage(subject, challenge, code),
  );
  // The conditional UPSERT also prevents two simultaneous sends during cooldown.
  const inserted = await db
    .prepare(
      `INSERT INTO login_codes
    (email_hash, challenge_id, code_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(email_hash) DO UPDATE SET challenge_id = excluded.challenge_id,
    code_hash = excluded.code_hash, created_at = excluded.created_at,
    expires_at = excluded.expires_at, attempts = 0, used_at = NULL, claim_id = NULL
    WHERE login_codes.created_at <= ? RETURNING challenge_id`,
    )
    .bind(subject, challenge, digest, now, now + CODE_MS, now - RESEND_MS)
    .first();
  if (!inserted)
    throw new AccountError(
      429,
      "Aguarde um minuto antes de pedir outro código.",
      60,
    );
  try {
    await sendLoginEmail(env, { email, code, challenge, local });
  } catch {
    await db
      .prepare(
        "DELETE FROM login_codes WHERE email_hash = ? AND challenge_id = ?",
      )
      .bind(subject, challenge)
      .run();
    throw unavailable();
  }
  // No account lookup or creation happens here; registered emails get the same reply.
  return {
    status: 202,
    data: {
      message:
        "Se o e-mail estiver correto, você receberá um código de acesso.",
      resendAfter: 60,
    },
  };
}
async function verify(request, env, db, now) {
  const data = await readJson(request),
    email = normalizeEmail(data.email);
  const ip = request.headers.get("CF-Connecting-IP") || "local";
  await quota(
    db,
    env.AUTH_PEPPER,
    "verify-ip",
    `${Math.floor(now / 86400000)}:${ip}`,
    30,
    now,
  );
  const subject = await emailHash(env.AUTH_PEPPER, email);
  const row = await db
    .prepare("SELECT * FROM login_codes WHERE email_hash = ?")
    .bind(subject)
    .first();
  const candidate =
    typeof data.code === "string" && /^\d{6}$/.test(data.code) ? data.code : "";
  const matches = await verifyHmac(
    env.AUTH_PEPPER,
    codeMessage(subject, row?.challenge_id || "", candidate),
    row?.code_hash || "0".repeat(64),
  );
  if (!row || row.used_at !== null || row.expires_at <= now)
    throw new AccountError(401, invalidCode);
  if (row.attempts >= 5)
    throw new AccountError(
      429,
      "Este código atingiu o limite de tentativas. Peça outro código.",
      Math.max(1, Math.ceil((row.expires_at - now) / 1000)),
    );
  const token = randomToken(),
    tokenHash = await sha256(token),
    id = crypto.randomUUID();
  const expires = now + SESSION_MS;
  // Code consumption, account creation and session issuance are one D1 transaction.
  // A concurrent verifier cannot issue a session from somebody else's claim.
  let results;
  for (let retry = 0; retry < 5; retry++) {
    const friendCode = await availableFriendCode(db);
    try {
      results = await db.batch([
        db
          .prepare(
            `UPDATE login_codes SET attempts = attempts + 1,
      used_at = CASE WHEN ? = 1 THEN ? ELSE NULL END,
      claim_id = CASE WHEN ? = 1 THEN ? ELSE NULL END
      WHERE email_hash = ? AND challenge_id = ? AND used_at IS NULL
      AND expires_at > ? AND attempts < 5 RETURNING attempts, claim_id`,
          )
          .bind(
            Number(matches),
            now,
            Number(matches),
            tokenHash,
            subject,
            row.challenge_id,
            now,
          ),
        db
          .prepare(
            `INSERT INTO users (id, email, friend_code, avatar, created_at)
      SELECT ?, ?, ?, ?, ? FROM login_codes WHERE email_hash = ? AND claim_id = ?
      ON CONFLICT(email) DO NOTHING`,
          )
          .bind(id, email, friendCode, randomAvatar(), now, subject, tokenHash),
        db
          .prepare(
            `INSERT INTO sessions (token_hash, id, user_id, created_at, last_seen_at, expires_at)
      SELECT ?, ?, users.id, ?, ?, ? FROM users JOIN login_codes
      ON login_codes.email_hash = ? AND login_codes.claim_id = ? WHERE users.email = ?`,
          )
          .bind(
            tokenHash,
            crypto.randomUUID(),
            now,
            now,
            expires,
            subject,
            tokenHash,
            email,
          ),
        db
          .prepare(
            "SELECT users.* FROM users JOIN sessions ON sessions.user_id = users.id WHERE sessions.token_hash = ?",
          )
          .bind(tokenHash),
      ]);
      break;
    } catch (error) {
      // A competing signup can reserve the same candidate; the failed batch
      // rolls back OTP consumption too, so retry the whole transaction.
      if (retry === 4 || !String(error.message).includes("users.friend_code"))
        throw error;
    }
  }
  const user = results[3].results[0];
  if (!user) {
    if (results[0].results[0]?.attempts === 5)
      throw new AccountError(
        429,
        "Este código atingiu o limite de tentativas. Peça outro código.",
        Math.max(1, Math.ceil((row.expires_at - now) / 1000)),
      );
    throw new AccountError(401, invalidCode);
  }
  return {
    data: {
      token,
      expiresAt: expires,
      user: publicUser(user),
      needsProfile: !user.display_name,
    },
  };
}
export async function authenticate(request, db, now) {
  const authorization = request.headers.get("Authorization") || "";
  if (!/^Bearer [a-f0-9]{64}$/.test(authorization)) throw invalidSession();
  const tokenHash = await sha256(authorization.slice(7));
  const session = await db
    .prepare(
      `UPDATE sessions SET last_seen_at = ?, expires_at = ?
    WHERE token_hash = ? AND expires_at > ? RETURNING id, user_id, created_at, last_seen_at, expires_at`,
    )
    .bind(now, now + SESSION_MS, tokenHash, now)
    .first();
  if (!session) throw invalidSession();
  const user = await db
    .prepare("SELECT * FROM users WHERE id = ?")
    .bind(session.user_id)
    .first();
  if (!user) throw invalidSession();
  return { user, session, tokenHash };
}
async function exportAccount(db, user, now, pepper) {
  const queries = [
    [
      "recentGames",
      "SELECT title,console,cover,last_played_at,play_seconds FROM recent_games WHERE user_id=? ORDER BY last_played_at DESC,title,console",
      [user.id],
    ],
    [
      "loginChallenges",
      "SELECT created_at, expires_at, attempts, used_at FROM login_codes WHERE email_hash = ?",
      [await emailHash(pepper, user.email)],
    ],
    [
      "loginQuota",
      "SELECT count, expires_at FROM auth_rate_limits WHERE key = ?",
      [await emailQuotaKey(pepper, user.email)],
    ],
    [
      "friendQuota",
      `SELECT count, expires_at FROM auth_rate_limits WHERE key IN (${USER_QUOTA_SCOPES.map(() => "?").join(",")})`,
      await Promise.all(
        USER_QUOTA_SCOPES.map((scope) =>
          hmac(pepper, JSON.stringify(["auth-quota", scope, user.id])),
        ),
      ),
    ],
    [
      "sessions",
      "SELECT id, created_at, last_seen_at, expires_at FROM sessions WHERE user_id = ? AND expires_at > ?",
      [user.id, now],
    ],
    [
      "friendRequests",
      "SELECT * FROM friend_requests WHERE sender_id = ? OR receiver_id = ?",
      [user.id, user.id],
    ],
    [
      "friendships",
      "SELECT * FROM friendships WHERE user_id = ? OR friend_id = ?",
      [user.id, user.id],
    ],
    [
      "blocks",
      "SELECT user_id, blocked_id, created_at FROM blocks WHERE user_id = ?",
      [user.id],
    ],
    [
      "directMessages",
      "SELECT id, sender_id, receiver_id, body, created_at FROM direct_messages WHERE sender_id = ? OR receiver_id = ? ORDER BY id",
      [user.id, user.id],
    ],
    [
      "messageReads",
      "SELECT peer_id, last_read_id FROM message_reads WHERE user_id = ?",
      [user.id],
    ],
  ];
  const results = await db.batch(
    queries.map(([, sql, args]) => db.prepare(sql).bind(...args)),
  );
  return {
    exportedAt: now,
    user: publicUser(user),
    ...Object.fromEntries(
      queries.map(([name], i) => [name, results[i].results]),
    ),
  };
}
export async function accountRoute(request, env, url) {
  const routes = {
    "/api/auth/start": "POST",
    "/api/auth/verify": "POST",
    "/api/auth/session": "GET",
    "/api/auth/logout": "POST",
    "/api/auth/logout-all": "POST",
    "/api/account/export": "GET",
    "/api/account": "DELETE",
    "/api/account/profile": "PATCH",
  };
  if (!(url.pathname in routes))
    throw new AccountError(404, "Página não encontrada.");
  if (request.method !== routes[url.pathname])
    throw new AccountError(405, "Método inválido.");
  if (
    url.protocol !== "https:" &&
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
  )
    throw new AccountError(
      400,
      "Use uma conexão HTTPS para acessar sua conta.",
    );
  const db = database(env, url),
    now = Date.now();
  if (url.pathname === "/api/auth/start")
    return start(request, env, db, url, now);
  if (url.pathname === "/api/auth/verify") return verify(request, env, db, now);
  const { user, session, tokenHash } = await authenticate(request, db, now);
  if (url.pathname === "/api/auth/session") {
    const current = await alignFriendCode(db, user);
    return {
      data: {
        user: publicUser(current),
        expiresAt: session.expires_at,
        needsProfile: !current.display_name,
      },
    };
  }
  if (url.pathname === "/api/account/profile") {
    const patch = await readJson(request);
    const fields = Object.keys(patch);
    if (
      !fields.length ||
      fields.some(
        (key) =>
          ![
            "displayName",
            "showPlaying",
            "appearOffline",
            "friendTag",
            "avatar",
            "discoverable",
            "shareHistory",
          ].includes(key),
      )
    )
      throw new AccountError(400, "Dados do perfil inválidos.");
    let name = null;
    if ("displayName" in patch) {
      if (typeof patch.displayName !== "string")
        throw new AccountError(
          400,
          "Use um nome com 3 a 24 caracteres, sem caracteres de controle.",
        );
      name = patch.displayName.trim();
      if (
        [...name].length < 3 ||
        [...name].length > 24 ||
        /[\p{C}\p{Zl}\p{Zp}]/u.test(name)
      )
        throw new AccountError(
          400,
          "Use um nome com 3 a 24 caracteres, sem caracteres de controle.",
        );
    }
    for (const key of [
      "showPlaying",
      "appearOffline",
      "discoverable",
      "shareHistory",
    ])
      if (key in patch && typeof patch[key] !== "boolean")
        throw new AccountError(400, "Dados do perfil inválidos.");
    if ("avatar" in patch && !validAvatar(patch.avatar))
      throw new AccountError(400, "Escolha um dos ícones do OpenRetro.");
    // The code follows the name: renaming changes the part before the #.
    // Friendships are kept by account id, so existing friends stay.
    const friendCode =
      "friendTag" in patch || name !== null
        ? friendCodeFor(
            name ?? user.display_name,
            "friendTag" in patch
              ? chosenTag(patch.friendTag)
              : user.friend_code.split("#")[1],
          )
        : null;
    // Patch each field atomically so a concurrent name edit cannot undo privacy.
    const updated = await db
      .prepare(
        `UPDATE users SET display_name = COALESCE(?, display_name),
      show_playing = COALESCE(?, show_playing), appear_offline = COALESCE(?, appear_offline), friend_code = COALESCE(?, friend_code),
      avatar = COALESCE(?, avatar), discoverable = COALESCE(?, discoverable), share_history = COALESCE(?, share_history)
      WHERE id = ? AND NOT EXISTS (SELECT 1 FROM users other WHERE other.friend_code = ? AND other.id <> ?) RETURNING *`,
      )
      .bind(
        name,
        "showPlaying" in patch ? Number(patch.showPlaying) : null,
        "appearOffline" in patch ? Number(patch.appearOffline) : null,
        friendCode,
        "avatar" in patch ? patch.avatar : null,
        "discoverable" in patch ? Number(patch.discoverable) : null,
        "shareHistory" in patch ? Number(patch.shareHistory) : null,
        user.id,
        friendCode,
        user.id,
      )
      .first();
    if (!updated) {
      if (
        !(await db
          .prepare("SELECT 1 FROM users WHERE id=?")
          .bind(user.id)
          .first())
      )
        throw invalidSession();
      throw new AccountError(
        409,
        "Esse código de amigo já está em uso. Escolha outros 4 caracteres.",
      );
    }
    const contacts =
      updated.friend_code !== user.friend_code ||
      updated.display_name !== user.display_name ||
      updated.avatar !== user.avatar
        ? (
            await db
              .prepare(
                "SELECT friend_id AS id FROM friendships WHERE user_id=? UNION SELECT receiver_id AS id FROM friend_requests WHERE sender_id=? UNION SELECT sender_id AS id FROM friend_requests WHERE receiver_id=?",
              )
              .bind(user.id, user.id, user.id)
              .all()
          ).results.map((row) => row.id)
        : [];
    await notifyUsers(env, [user.id, ...contacts]);
    return {
      data: {
        user: publicUser(updated),
        expiresAt: session.expires_at,
        needsProfile: !updated.display_name,
      },
    };
  }
  if (url.pathname === "/api/auth/logout") {
    await db
      .prepare("DELETE FROM sessions WHERE token_hash = ?")
      .bind(tokenHash)
      .run();
    await notifyUsers(env, [user.id]);
    return { status: 204 };
  }
  if (url.pathname === "/api/auth/logout-all") {
    await db
      .prepare("DELETE FROM sessions WHERE user_id = ?")
      .bind(user.id)
      .run();
    await notifyUsers(env, [user.id]);
    return { status: 204 };
  }
  if (url.pathname === "/api/account/export")
    return {
      data: await exportAccount(db, user, now, env.AUTH_PEPPER),
      attachment: true,
    };
  const formerFriends = await db
    .prepare("SELECT friend_id FROM friendships WHERE user_id=?")
    .bind(user.id)
    .all();
  const quotaKeys = await Promise.all(
    USER_QUOTA_SCOPES.map((scope) =>
      hmac(env.AUTH_PEPPER, JSON.stringify(["auth-quota", scope, user.id])),
    ),
  );
  await db.batch([
    db
      .prepare("DELETE FROM login_codes WHERE email_hash = ?")
      .bind(await emailHash(env.AUTH_PEPPER, user.email)),
    db
      .prepare("DELETE FROM auth_rate_limits WHERE key = ?")
      .bind(await emailQuotaKey(env.AUTH_PEPPER, user.email)),
    db.prepare("DELETE FROM users WHERE id = ?").bind(user.id),
    db
      .prepare(
        `DELETE FROM auth_rate_limits WHERE key IN (${quotaKeys.map(() => "?").join(",")})`,
      )
      .bind(...quotaKeys),
  ]);
  await notifyUsers(env, [
    user.id,
    ...formerFriends.results.map((row) => row.friend_id),
  ]);
  return { status: 204 };
}
