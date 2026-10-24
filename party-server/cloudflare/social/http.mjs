export class AccountError extends Error {
  constructor(status, message, retryAfter = 0) {
    super(message);
    this.status = status;
    this.retryAfter = retryAfter;
  }
}
export const unavailable = () =>
  new AccountError(
    503,
    "O serviço de conta está indisponível. Tente novamente mais tarde.",
  );
export function normalizeEmail(value) {
  if (typeof value !== "string")
    throw new AccountError(400, "Digite um e-mail válido.");
  const email = value.trim().toLowerCase();
  if (
    email.length > 254 ||
    !/^[a-z0-9.!#$%&'*+\/=?^_`{|}~-]{1,64}@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/.test(
      email,
    )
  )
    throw new AccountError(400, "Digite um e-mail válido.");
  const [name, domain] = email.split("@");
  if (
    name.startsWith(".") ||
    name.endsWith(".") ||
    name.includes("..") ||
    domain.split(".").some((label) => label.length > 63)
  )
    throw new AccountError(400, "Digite um e-mail válido.");
  return email;
}
export async function readJson(request) {
  if (
    request.headers.get("Content-Type")?.split(";")[0].trim().toLowerCase() !==
    "application/json"
  )
    throw new AccountError(415, "Envie os dados no formato JSON.");
  // Content-Length is untrusted and may be absent on streamed requests.
  const reader = request.body?.getReader();
  if (!reader) throw new AccountError(400, "Dados inválidos.");
  const parts = [];
  let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > 2048) {
        await reader.cancel();
        throw new AccountError(413, "Os dados enviados são grandes demais.");
      }
      parts.push(value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const part of parts) {
      bytes.set(part, offset);
      offset += part.length;
    }
    const data = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    );
    if (!data || typeof data !== "object" || Array.isArray(data))
      throw new Error();
    return data;
  } catch (error) {
    if (error instanceof AccountError) throw error;
    throw new AccountError(400, "Dados inválidos.");
  } finally {
    reader.releaseLock();
  }
}
export const localDevelopment = (env, url) =>
  env.SOCIAL_DEV_MODE === "true" &&
  ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
