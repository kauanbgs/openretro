import { hmac, verifyHmac } from "./crypto.mjs";
import { hubCall } from "./hub.mjs";
import { mailLocale } from "./email.mjs";

/** A message after this long without one in the conversation sends an email. */
export const QUIET_MS = 7 * 24 * 60 * 60 * 1000;
/** Alerts each account may cause and receive in 24 hours. */
export const ALERTS_PER_DAY = 2;
const DAY = 24 * 60 * 60 * 1000;
const offMessage = (id) => JSON.stringify(["email-alerts-off", id]);

export const alertsOffLink = async (env, origin, id) =>
  `${origin}/email/off?u=${id}&t=${await hmac(env.AUTH_PEPPER, offMessage(id))}`;

async function online(env, id) {
  if (!env.SOCIAL_HUB) return false;
  const response = await hubCall(env, id, "/online", { id });
  return response.ok && (await response.json()).online;
}

/**
 * Emails a friend request or a message to a player who is not in the app.
 * Never throws: a missed alert must not fail the request that caused it.
 */
export async function emailAlert(
  env,
  db,
  { kind, sender, receiver, origin, now },
) {
  try {
    if (!env.RESEND_API_KEY || !env.EMAIL_FROM) return;
    const target = await db
      .prepare("SELECT email,email_alerts,locale FROM users WHERE id=?")
      .bind(receiver)
      .first();
    // Players with the app open already see it there.
    if (!target?.email_alerts || (await online(env, receiver))) return;
    // The cap is checked and taken in the same statement.
    const reserved = await db
      .prepare(
        `INSERT INTO email_alerts (sender_id,receiver_id,kind,created_at)
        SELECT ?1,?2,?3,?4 WHERE
          (SELECT COUNT(*) FROM email_alerts WHERE sender_id=?1 AND created_at>?5) < ?6
          AND (SELECT COUNT(*) FROM email_alerts WHERE receiver_id=?2 AND created_at>?5) < ?6
        RETURNING id`,
      )
      .bind(sender.id, receiver, kind, now, now - DAY, ALERTS_PER_DAY)
      .first();
    if (!reserved) return;
    const name = sender.display_name ?? sender.friend_code;
    const off = await alertsOffLink(env, origin, receiver);
    // The text never carries the message itself.
    const en = mailLocale(target.locale) === "en";
    const [subject, line] =
      kind === "request"
        ? en
          ? [
              `${name} wants to be your friend on OpenRetro`,
              `${name} (${sender.friend_code}) sent you a friend request on OpenRetro.\nOpen OpenRetro to accept or decline.`,
            ]
          : [
              `${name} quer ser seu amigo no OpenRetro`,
              `${name} (${sender.friend_code}) te mandou um pedido de amizade no OpenRetro.\nAbra o OpenRetro para aceitar ou recusar.`,
            ]
        : en
          ? [
              `${name} sent you a message on OpenRetro`,
              `${name} (${sender.friend_code}) sent you a message on OpenRetro.\nOpen OpenRetro to read and reply.`,
            ]
          : [
              `${name} te mandou uma mensagem no OpenRetro`,
              `${name} (${sender.friend_code}) te mandou uma mensagem no OpenRetro.\nAbra o OpenRetro para ler e responder.`,
            ];
    const footer = en
      ? `You are getting this because you weren't in OpenRetro. To stop receiving these, go to:\n${off}`
      : `Você recebe este aviso porque não estava no OpenRetro. Para não receber mais, acesse:\n${off}`;
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
        "Idempotency-Key": `openretro-alert/${reserved.id}`,
      },
      body: JSON.stringify({
        from: env.EMAIL_FROM,
        to: [target.email],
        subject,
        text: `${line}\n\n${footer}`,
        headers: {
          "List-Unsubscribe": `<${off}>`,
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        },
      }),
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    // Provider and database errors may contain addresses; they are not logged.
  }
}

const page = (title, body) =>
  `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head><body><main><h1>${title}</h1>${body}</main></body></html>`;

/** The link in every alert: a page to confirm, and the one-click POST. */
export async function alertsOffRoute(request, env, url, headers) {
  const id = url.searchParams.get("u") ?? "",
    token = url.searchParams.get("t") ?? "";
  const reply = (status, html) =>
    new Response(html, {
      status,
      headers: {
        ...headers,
        "Content-Type": "text/html; charset=utf-8",
        "Content-Security-Policy":
          "default-src 'none'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
      },
    });
  const valid =
    env.SOCIAL_DB &&
    env.AUTH_PEPPER &&
    /^[a-f0-9-]{36}$/.test(id) &&
    /^[a-f0-9]{64}$/.test(token) &&
    (await verifyHmac(env.AUTH_PEPPER, offMessage(id), token));
  if (!valid)
    return reply(
      400,
      page("Link inválido", "<p>Confira o link do e-mail.</p>"),
    );
  if (request.method === "GET")
    return reply(
      200,
      page(
        "Parar de receber avisos por e-mail",
        `<p>Você não vai mais receber e-mails de pedidos de amizade e mensagens do OpenRetro. Dá para ligar de novo nas configurações da conta.</p><form method="post"><button type="submit">Parar de receber</button></form>`,
      ),
    );
  if (request.method !== "POST") return reply(405, page("Método inválido", ""));
  await env.SOCIAL_DB.prepare("UPDATE users SET email_alerts=0 WHERE id=?")
    .bind(id)
    .run();
  return reply(
    200,
    page(
      "Pronto",
      "<p>Você não vai mais receber avisos por e-mail. Dá para ligar de novo nas configurações da conta.</p>",
    ),
  );
}
