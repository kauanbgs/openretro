import { database } from "./auth.mjs";
import { AccountError, readJson } from "./http.mjs";
import { quota } from "./limits.mjs";

export const FEEDBACK_KINDS = ["problem", "idea", "opinion"];
const EVENT_KINDS = ["view", "accept", "download"];
const MESSAGE_MAX = 1500;
const HOUR = 60 * 60 * 1000;
const notFound = () => new AccountError(404, "Este convite não existe.");

/** How long a first feedback must be to earn the Steam key. */
export const REWARD_MIN = 40;
const KEYS_MAX = 200;
const claimedKey = async (db, slug) =>
  (
    await db
      .prepare("SELECT steam_key FROM playtest_keys WHERE slug = ?")
      .bind(slug)
      .first()
  )?.steam_key ?? null;
/** Hands this invite one random unclaimed key, or null when none are left. */
async function claimKey(db, slug, now) {
  try {
    const row = await db
      .prepare(
        `UPDATE playtest_keys SET slug = ?, claimed_at = ?
         WHERE id = (SELECT id FROM playtest_keys WHERE slug IS NULL ORDER BY RANDOM() LIMIT 1)
         RETURNING steam_key`,
      )
      .bind(slug, now)
      .first();
    return row?.steam_key ?? null;
  } catch {
    // A parallel request claimed for this invite first.
    return claimedKey(db, slug);
  }
}
/** One key per line, in the letters, digits and dashes Steam keys use. */
export function parseKeys(text) {
  const lines = String(text ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length > KEYS_MAX)
    throw new AccountError(400, `Use no máximo ${KEYS_MAX} chaves.`);
  for (const line of lines)
    if (!/^[A-Za-z0-9-]{5,40}$/.test(line))
      throw new AccountError(400, `Chave inválida: ${line.slice(0, 60)}`);
  return [...new Set(lines)];
}
/** Replaces the unclaimed keys; keys already given away stay as they are. */
export async function saveKeys(db, text, now) {
  const keys = parseKeys(text);
  await db.batch([
    db.prepare("DELETE FROM playtest_keys WHERE slug IS NULL"),
    ...keys.map((key) =>
      db
        .prepare(
          "INSERT OR IGNORE INTO playtest_keys (steam_key,created_at) VALUES (?,?)",
        )
        .bind(key, now),
    ),
  ]);
  return keys;
}

const SOURCES_MAX = 20;
/** One HTTPS address per line, as the app's Sources screen accepts them. */
export function parseSources(text) {
  const lines = String(text ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length > SOURCES_MAX)
    throw new AccountError(400, `Use no máximo ${SOURCES_MAX} fontes.`);
  for (const line of lines) {
    let address;
    try {
      address = new URL(line);
    } catch {
      throw new AccountError(400, `Endereço inválido: ${line.slice(0, 60)}`);
    }
    if (
      address.protocol !== "https:" ||
      address.username ||
      address.password ||
      line.length > 500
    )
      throw new AccountError(
        400,
        `A fonte precisa ser um endereço HTTPS sem usuário e senha: ${line.slice(0, 60)}`,
      );
  }
  return [...new Set(lines)];
}
export async function readSources(db) {
  const row = await db
    .prepare("SELECT value FROM playtest_settings WHERE key = 'sources'")
    .first();
  return row?.value ? row.value.split("\n") : [];
}
export async function saveSources(db, text, now) {
  const sources = parseSources(text);
  await db
    .prepare(
      `INSERT INTO playtest_settings (key,value,updated_at) VALUES ('sources',?,?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    )
    .bind(sources.join("\n"), now)
    .run();
  return sources;
}

/** The invites, from the PLAYTEST_STREAMERS variable: "slug=Name, other=Name". */
export function streamers(env) {
  const list = new Map();
  for (const entry of String(env.PLAYTEST_STREAMERS ?? "").split(",")) {
    const at = entry.indexOf("=");
    const slug = entry.slice(0, at).trim().toLowerCase();
    const name = entry.slice(at + 1).trim();
    if (at > 0 && /^[a-z0-9-]{2,40}$/.test(slug) && name) list.set(slug, name);
  }
  return list;
}

export async function playtestRoute(request, env, url) {
  const match =
    /^\/api\/playtest\/([a-z0-9-]{2,40})(?:\/(event|feedback|sources|reward))?$/.exec(
      url.pathname,
    );
  const name = match && streamers(env).get(match[1]);
  if (!name) throw notFound();
  const [, slug, action] = match;
  if (!action) {
    if (request.method !== "GET") throw notFound();
    return { data: { name } };
  }
  const reads = action === "sources" || action === "reward";
  if (request.method !== (reads ? "GET" : "POST")) throw notFound();
  const db = database(env, url),
    now = Date.now(),
    visitor = request.headers.get("CF-Connecting-IP") || "local";
  if (action === "reward") {
    await quota(db, env.AUTH_PEPPER, "playtest-reward", visitor, 60, now);
    return { data: { key: await claimedKey(db, slug) } };
  }
  if (action === "sources") {
    await quota(db, env.AUTH_PEPPER, "playtest-sources", visitor, 60, now);
    return { data: { sources: await readSources(db) } };
  }
  if (action === "event") {
    const { kind } = await readJson(request);
    if (!EVENT_KINDS.includes(kind))
      throw new AccountError(400, "Dados inválidos.");
    await quota(db, env.AUTH_PEPPER, "playtest-event", visitor, 60, now);
    await db
      .prepare(
        "INSERT INTO playtest_events (slug,kind,created_at) VALUES (?,?,?)",
      )
      .bind(slug, kind, now)
      .run();
    return { data: {}, status: 201 };
  }
  const { kind, message } = await readJson(request, 8192);
  const text = typeof message === "string" ? message.trim() : "";
  if (!FEEDBACK_KINDS.includes(kind) || text.length < 5)
    throw new AccountError(400, "Escreva pelo menos algumas palavras.");
  if (text.length > MESSAGE_MAX)
    throw new AccountError(
      400,
      `O texto pode ter até ${MESSAGE_MAX} caracteres.`,
    );
  await quota(
    db,
    env.AUTH_PEPPER,
    "playtest-feedback",
    visitor,
    8,
    now,
    HOUR,
    "Você já enviou bastante feedback. Tente de novo daqui a pouco.",
  );
  await db
    .prepare(
      "INSERT INTO playtest_feedback (slug,kind,message,created_at) VALUES (?,?,?,?)",
    )
    .bind(slug, kind, text, now)
    .run();
  // A longer first message earns a random Steam key, once per invite.
  const earned = text.length >= REWARD_MIN;
  const key = earned
    ? ((await claimedKey(db, slug)) ?? (await claimKey(db, slug, now)))
    : await claimedKey(db, slug);
  return {
    data: { reward: earned || key ? { key } : null },
    status: 201,
  };
}

/** What the admin panel shows: one row per invite plus the latest feedback. */
export async function playtestOverview(env, db) {
  const sources = await readSources(db);
  const [events, feedback, latest, keys] = await db.batch([
    db.prepare(
      "SELECT slug, kind, COUNT(*) AS n, MAX(created_at) AS last FROM playtest_events GROUP BY slug, kind",
    ),
    db.prepare(
      "SELECT slug, COUNT(*) AS n, MAX(created_at) AS last FROM playtest_feedback GROUP BY slug",
    ),
    db.prepare(
      "SELECT id, slug, kind, message, created_at FROM playtest_feedback ORDER BY id DESC LIMIT 100",
    ),
    db.prepare(
      "SELECT steam_key, slug, claimed_at FROM playtest_keys ORDER BY id",
    ),
  ]);
  const names = streamers(env);
  const rows = new Map(
    [...names].map(([slug, name]) => [
      slug,
      { slug, name, view: 0, accept: 0, download: 0, feedback: 0, lastAt: 0 },
    ]),
  );
  const row = (slug) =>
    rows.get(slug) ??
    rows
      .set(slug, {
        slug,
        name: slug,
        view: 0,
        accept: 0,
        download: 0,
        feedback: 0,
        lastAt: 0,
      })
      .get(slug);
  for (const { slug, kind, n, last } of events.results) {
    const r = row(slug);
    r[kind] = n;
    r.lastAt = Math.max(r.lastAt, last);
  }
  for (const { slug, n, last } of feedback.results) {
    const r = row(slug);
    r.feedback = n;
    r.lastAt = Math.max(r.lastAt, last);
  }
  return {
    sources,
    keys: {
      available: keys.results.filter((k) => !k.slug).map((k) => k.steam_key),
      claimed: keys.results
        .filter((k) => k.slug)
        .map((k) => ({
          slug: k.slug,
          name: names.get(k.slug) ?? k.slug,
          key: k.steam_key,
          at: k.claimed_at,
        })),
    },
    streamers: [...rows.values()].sort(
      (a, b) => b.lastAt - a.lastAt || a.name.localeCompare(b.name),
    ),
    feedback: latest.results.map((f) => ({
      id: f.id,
      slug: f.slug,
      name: names.get(f.slug) ?? f.slug,
      kind: f.kind,
      message: f.message,
      at: f.created_at,
    })),
  };
}
