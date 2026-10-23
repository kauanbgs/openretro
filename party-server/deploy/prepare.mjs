import { randomBytes } from "node:crypto";
import { isIP } from "node:net";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

function domain(value) {
  if (
    typeof value !== "string" ||
    value.length > 253 ||
    !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(value)
  )
    throw new Error("Use um domínio válido, sem https://, caminho ou porta.");
  return value;
}

export async function prepareDeployment({
  webDomain,
  turnDomain,
  publicIp,
  directory = new URL("./generated/", import.meta.url),
}) {
  domain(webDomain);
  domain(turnDomain);
  if (webDomain === turnDomain)
    throw new Error("Use dois nomes DNS: um para Party e outro para TURN.");
  if (isIP(publicIp) !== 4) throw new Error("Informe o IPv4 público do VPS.");
  const secret = randomBytes(48).toString("hex");
  const tls =
    "tls {\n        ca https://acme-v02.api.letsencrypt.org/directory\n    }";
  const certificate = `/data/caddy/certificates/acme-v02.api.letsencrypt.org-directory/${turnDomain}/${turnDomain}`;
  let turn = await readFile(
    new URL("./turnserver.conf.example", import.meta.url),
    "utf8",
  );
  turn = turn
    .replaceAll("turn.example.com", turnDomain)
    .replace("REPLACE_WITH_THE_SAME_RANDOM_SECRET_AS_TURN_SECRET", secret)
    .replace(
      `cert=/etc/letsencrypt/live/${turnDomain}/fullchain.pem`,
      `cert=${certificate}.crt`,
    )
    .replace(
      `pkey=/etc/letsencrypt/live/${turnDomain}/privkey.pem`,
      `pkey=${certificate}.key`,
    );
  turn += `\nexternal-ip=${publicIp}\nlog-file=stdout\nsimple-log\n`;
  const compose = `# Linux VPS only. All services are on this server; only Caddy and TURN are public.
services:
  party:
    build:
      context: ../..
    network_mode: host
    env_file: party.env
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://127.0.0.1:8787/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
      interval: 15s
      timeout: 5s
      retries: 5
  web:
    image: caddy:2-alpine
    network_mode: host
    restart: unless-stopped
    depends_on:
      party:
        condition: service_healthy
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy_data:/data
      - caddy_config:/config
    healthcheck:
      test: ["CMD-SHELL", "test -s ${certificate}.crt && test -s ${certificate}.key"]
      interval: 10s
      timeout: 5s
      retries: 30
      start_period: 30s
  turn:
    image: coturn/coturn:4.18.0-r0
    user: "0:0"
    network_mode: host
    restart: unless-stopped
    depends_on:
      web:
        condition: service_healthy
    command: ["-c", "/etc/coturn/turnserver.conf"]
    volumes:
      - ./turnserver.conf:/etc/coturn/turnserver.conf:ro
      - caddy_data:/data:ro
volumes:
  caddy_data:
  caddy_config:
`;
  const files = {
    "compose.yaml": compose,
    Caddyfile: `${webDomain} {\n    ${tls}\n    reverse_proxy 127.0.0.1:8787 {\n        header_up X-Party-Client-IP {remote_host}\n    }\n}\n${turnDomain} {\n    ${tls}\n    respond "OpenRetro TURN"\n}\n`,
    "turnserver.conf": turn,
    "party.env": `HOST=127.0.0.1\nPORT=8787\nPUBLIC_URL=https://${webDomain}\nTURN_SECRET=${secret}\nTURN_URLS=turn:${turnDomain}:3478?transport=udp,turn:${turnDomain}:3478?transport=tcp,turns:${turnDomain}:5349?transport=tcp\nTRUST_PROXY=true\nMAX_ROOMS=32\nMAX_ROOMS_PER_IP=2\nMAX_CREATES_PER_10_MIN=12\nALLOW_STUN_ONLY=false\n`,
    "LEIA-ME.txt": `OpenRetro Party\n\n1. Aponte os registros DNS A de ${webDomain} e ${turnDomain} para ${publicIp}. Nao use proxy HTTP no registro TURN.\n2. No VPS Linux com Docker Compose, permita TCP 80/443/3478/5349 e UDP 3478/49160-49260. Mantenha 8787 privado.\n3. Neste diretorio, execute: docker compose up -d --build\n4. Aguarde os certificados HTTPS e confira: docker compose ps\n5. Compile o desktop com OPENRETRO_PARTY_URL=https://${webDomain}\n6. Valide uma partida entre duas redes antes de distribuir.\n\nO segredo foi gerado automaticamente e esta somente nos arquivos party.env e turnserver.conf. Preserve estes arquivos e os volumes de certificados.\nApos renovacao do certificado TURN, reinicie o servico turn para recarrega-lo.\nEste pacote foi gerado localmente. Nao contrata VPS, nao registra dominio e nao publica nada sozinho.\n`,
  };
  await mkdir(directory, { mode: 0o700 }); // Never overwrite an existing deployment or rotate its secret silently.
  const folder =
    directory instanceof URL ? fileURLToPath(directory) : directory;
  for (const [name, content] of Object.entries(files))
    await writeFile(join(folder, name), content, { mode: 0o600, flag: "wx" });
  return { url: `https://${webDomain}`, files: Object.keys(files) };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const [webDomain, turnDomain, publicIp] = process.argv.slice(2);
    if (!publicIp)
      throw new Error(
        "Uso: node party-server/deploy/prepare.mjs DOMINIO_PARTY DOMINIO_TURN IPV4_DO_VPS",
      );
    const result = await prepareDeployment({ webDomain, turnDomain, publicIp });
    console.log(
      `Pacote criado em party-server/deploy/generated. Endereço: ${result.url}. Leia LEIA-ME.txt. Nenhum serviço foi publicado.`,
    );
  } catch (error) {
    console.error(
      error.code === "EEXIST"
        ? "O pacote já existe. Preserve a configuração atual; nenhum segredo foi substituído."
        : error.message,
    );
    process.exitCode = 1;
  }
}
