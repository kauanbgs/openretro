import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { cloudflareTurn } from "./turn.mjs";

// Operator-only helper: the permanent credential goes straight from the terminal
// to Workers Secrets. It is never written to a project file or command history.
let muted = false;
const output = new Writable({
  write(chunk, encoding, callback) {
    if (!muted) process.stdout.write(chunk, encoding);
    callback();
  },
});
const rl = createInterface({
  input: process.stdin,
  output,
  terminal: Boolean(process.stdin.isTTY),
});
try {
  console.log("OpenRetro Party — configurar Cloudflare TURN");
  console.log(
    "No painel Cloudflare, abra Realtime → TURN e crie uma chave para OpenRetro Party.",
  );
  console.log(
    "Cole os valores abaixo somente neste terminal. Eles não serão salvos no projeto.",
  );
  const id = (await rl.question("TURN Key ID: ")).trim();
  process.stdout.write("Token da chave TURN (oculto): ");
  muted = true;
  const token = (await rl.question("")).trim();
  muted = false;
  process.stdout.write("\n");
  if (!/^[a-f0-9]{32}$/i.test(id) || !/^[A-Za-z0-9_-]{32,256}$/.test(token))
    throw new Error(
      "Formato inválido. Copie o Key ID e o token da chave TURN do painel.",
    );
  console.log("Validando a chave TURN…");
  await cloudflareTurn({ TURN_KEY_ID: id, TURN_API_TOKEN: token });
  const cli = fileURLToPath(
    new URL("../node_modules/wrangler/bin/wrangler.js", import.meta.url),
  );
  const config = fileURLToPath(new URL("./wrangler.jsonc", import.meta.url));
  execFileSync(process.execPath, [cli, "secret", "bulk", "--config", config], {
    input: JSON.stringify({ TURN_KEY_ID: id, TURN_API_TOKEN: token }),
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  });
  console.log(
    "TURN configurado no Worker. Nenhum segredo foi salvo no repositório.",
  );
} catch (error) {
  muted = false;
  console.error(
    error.status
      ? "Não foi possível enviar os segredos. Confira o login da Cloudflare e tente novamente."
      : error.message,
  );
  process.exitCode = 1;
} finally {
  rl.close();
}
