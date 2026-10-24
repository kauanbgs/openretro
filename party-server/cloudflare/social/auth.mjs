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
import { emailQuotaKey, quota } from "./limits.mjs";
import { sendLoginEmail } from "./email.mjs";

const CODE_MS = 10 * 60 * 1000;
const SESSION_MS = 90 * 24 * 60 * 60 * 1000;
const RESEND_MS = 60 * 1000;
const invalidCode =
  "Código inválido ou expirado. Confira o e-mail ou peça outro código.";
const invalidSession = () =>
  new AccountError(401, "Sua sessão expirou. Entre novamente.");
export function publicUser(row) {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    friendCode: row.friend_code,
    showPlaying: Boolean(row.show_playing),
    appearOffline: Boolean(row.appear_offline),
    createdAt: row.created_at,
  };
}
function database(env, url) {
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
  const results = await db.batch([
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
        `INSERT INTO users (id, email, friend_code, created_at)
      SELECT ?, ?, ?, ? FROM login_codes WHERE email_hash = ? AND claim_id = ?
      ON CONFLICT(email) DO NOTHING`,
      )
      .bind(
        id,
        email,
        `jogador#${id.replaceAll("-", "").slice(0, 12)}`,
        now,
        subject,
        tokenHash,
      ),
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
async function authenticate(request, db, now) {
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
  if (url.pathname === "/api/auth/session")
    return {
      data: {
        user: publicUser(user),
        expiresAt: session.expires_at,
        needsProfile: !user.display_name,
      },
    };
  if (url.pathname === "/api/account/profile") {
    const patch = await readJson(request);
    const fields = Object.keys(patch);
    if (
      !fields.length ||
      fields.some(
        (key) => !["displayName", "showPlaying", "appearOffline"].includes(key),
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
    for (const key of ["showPlaying", "appearOffline"])
      if (key in patch && typeof patch[key] !== "boolean")
        throw new AccountError(400, "Dados do perfil inválidos.");
    // Patch each field atomically so a concurrent name edit cannot undo privacy.
    const updated = await db
      .prepare(
        `UPDATE users SET display_name = COALESCE(?, display_name),
      show_playing = COALESCE(?, show_playing), appear_offline = COALESCE(?, appear_offline)
      WHERE id = ? RETURNING *`,
      )
      .bind(
        name,
        "showPlaying" in patch ? Number(patch.showPlaying) : null,
        "appearOffline" in patch ? Number(patch.appearOffline) : null,
        user.id,
      )
      .first();
    if (!updated) throw invalidSession();
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
    return { status: 204 };
  }
  if (url.pathname === "/api/auth/logout-all") {
    await db
      .prepare("DELETE FROM sessions WHERE user_id = ?")
      .bind(user.id)
      .run();
    return { status: 204 };
  }
  if (url.pathname === "/api/account/export")
    return {
      data: await exportAccount(db, user, now, env.AUTH_PEPPER),
      attachment: true,
    };
  await db.batch([
    db
      .prepare("DELETE FROM login_codes WHERE email_hash = ?")
      .bind(await emailHash(env.AUTH_PEPPER, user.email)),
    db
      .prepare("DELETE FROM auth_rate_limits WHERE key = ?")
      .bind(await emailQuotaKey(env.AUTH_PEPPER, user.email)),
    db.prepare("DELETE FROM users WHERE id = ?").bind(user.id),
  ]);
  return { status: 204 };
}
