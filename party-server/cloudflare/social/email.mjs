import { unavailable } from "./http.mjs";

export async function sendLoginEmail(
  env,
  { email, code, challenge, local },
  fetcher = fetch,
  logger = console,
) {
  if (!env.RESEND_API_KEY) {
    if (!local) throw unavailable();
    // The only credential log is an explicit localhost-only development code.
    // Never include the email, session token or a Party ticket in this message.
    logger.info(
      `[OpenRetro local login] Código: ${code} (válido por 10 minutos)`,
    );
    return;
  }
  const response = await fetcher("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
      "Idempotency-Key": `openretro-login/${challenge}`,
    },
    body: JSON.stringify({
      from: env.EMAIL_FROM,
      to: [email],
      subject: "Seu código de acesso ao OpenRetro",
      text: `Seu código de acesso ao OpenRetro é: ${code}\n\nEle é válido por 10 minutos e só pode ser usado uma vez.\nSe não foi você, ignore este e-mail.`,
    }),
    signal: AbortSignal.timeout(10000),
  });
  // Provider responses can contain addresses; never log or relay their body.
  if (!response.ok) throw unavailable();
}
