import { AccountError } from "./http.mjs";

/** Friend codes read as the player's name, like "kauaplaza#ab12": the name
 * without accents, spaces or symbols, up to 16 characters. A name with no
 * letters or digits, or no name yet, keeps "jogador". The app's
 * `friendPrefix` (src/services/account.ts) must stay identical. */
export function friendPrefix(name) {
  const slug = String(name ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 16);
  return slug || "jogador";
}
export const FRIEND_CODE = /^[a-z0-9]{1,16}#[a-z0-9]{4}$/;

export function chosenTag(value) {
  if (typeof value !== "string" || !/^[a-z0-9]{4}$/i.test(value.trim()))
    throw new AccountError(
      400,
      "Escolha exatamente 4 letras ou números para depois do #.",
    );
  return value.trim().toLowerCase();
}
/** The code for this name and tag; the tag is the part after the #. */
export const friendCodeFor = (name, tag) => `${friendPrefix(name)}#${tag}`;
export async function availableFriendCode(db) {
  const alphabet = "0123456789abcdefghijklmnopqrstuvwxyz";
  for (let attempt = 0; attempt < 32; attempt++) {
    // Rejection sampling gives each letter/digit the same chance.
    let tag = "";
    while (tag.length < 4)
      for (const byte of crypto.getRandomValues(new Uint8Array(8))) {
        if (byte < 252 && tag.length < 4) tag += alphabet[byte % 36];
      }
    const code = `jogador#${tag}`;
    if (
      !(await db
        .prepare("SELECT 1 FROM users WHERE friend_code=?")
        .bind(code)
        .first())
    )
      return code;
  }
  throw new AccountError(
    503,
    "Não foi possível reservar seu código de amigo. Tente novamente.",
  );
}
