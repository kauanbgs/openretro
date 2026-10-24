import { AccountError, readJson } from "./http.mjs";
import { validPresence } from "./hub.mjs";
import { quota } from "./limits.mjs";

export async function historyRoute(request, env, { db, user, now }) {
  if (request.method !== "POST")
    throw new AccountError(405, "Método inválido.");
  const body = await readJson(request);
  let game;
  try {
    if (
      Object.keys(body).some((k) => !["game", "playSeconds"].includes(k)) ||
      !Number.isSafeInteger(body.playSeconds) ||
      body.playSeconds < 0 ||
      body.playSeconds > 31 * 86400
    )
      throw new Error("invalid");
    game = validPresence({ status: "online", playing: body.game }, now).playing;
    if (
      !game ||
      game.startedAt < now - 31 * 86400000 ||
      body.playSeconds * 1000 > now - game.startedAt + 60000
    )
      throw new Error("invalid");
  } catch {
    throw new AccountError(400, "Histórico de jogos inválido.");
  }
  await quota(db, env.AUTH_PEPPER, "history-write", user.id, 120, now);
  // A batch is atomic: concurrent devices cannot grow the account past ten games.
  // An older session may finish after a newer one; it must not replace its data.
  await db.batch([
    db
      .prepare(
        `INSERT INTO recent_games(user_id,title,console,cover,last_played_at,play_seconds)
      VALUES(?,?,?,?,?,?) ON CONFLICT(user_id,title,console) DO UPDATE SET
      cover=excluded.cover,last_played_at=excluded.last_played_at,
      play_seconds=CASE WHEN excluded.last_played_at=recent_games.last_played_at
        THEN MAX(recent_games.play_seconds,excluded.play_seconds) ELSE excluded.play_seconds END
      WHERE excluded.last_played_at>=recent_games.last_played_at`,
      )
      .bind(
        user.id,
        game.title,
        game.console,
        game.cover,
        game.startedAt,
        body.playSeconds,
      ),
    db
      .prepare(
        `DELETE FROM recent_games WHERE user_id=? AND rowid NOT IN
      (SELECT rowid FROM recent_games WHERE user_id=? ORDER BY last_played_at DESC,title,console LIMIT 10)`,
      )
      .bind(user.id, user.id),
  ]);
  return { status: 204 };
}
