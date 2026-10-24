const encoder = new TextEncoder();
export const hex = (bytes) =>
  [...new Uint8Array(bytes)]
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("");
export const randomToken = () =>
  hex(crypto.getRandomValues(new Uint8Array(32)));
export const sha256 = async (value) =>
  hex(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
async function key(pepper) {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(pepper),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}
export async function hmac(pepper, value) {
  return hex(
    await crypto.subtle.sign("HMAC", await key(pepper), encoder.encode(value)),
  );
}
export async function verifyHmac(pepper, value, expected) {
  // Native HMAC verification compares fixed-size signatures in constant time.
  const signature = Uint8Array.from(expected.match(/../g), (part) =>
    parseInt(part, 16),
  );
  return crypto.subtle.verify(
    "HMAC",
    await key(pepper),
    signature,
    encoder.encode(value),
  );
}
export function loginCode() {
  // Rejection sampling avoids modulo bias in the six-digit code space.
  let number;
  do {
    number = crypto.getRandomValues(new Uint32Array(1))[0];
  } while (number >= 4_294_000_000);
  return String(number % 1_000_000).padStart(6, "0");
}
export const codeMessage = (emailHash, challenge, code) =>
  JSON.stringify(["login-code", emailHash, challenge, code]);
export const emailHash = (pepper, email) =>
  hmac(pepper, JSON.stringify(["login-email", email]));
