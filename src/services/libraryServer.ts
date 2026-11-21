import { t } from "../i18n";

/**
 * The source address for another PC's library, from the pairing link its
 * settings show, and whether that address is on the local network. Accepted
 * are Tailscale addresses (100.64.0.0/10, encrypted by Tailscale) and the
 * private ranges of a home network, which the other PC's owner switched on.
 */
export function sourceUrlFromPairing(link: string): {
  url: string;
  lan: boolean;
} {
  let url: URL;
  try {
    url = new URL(link.trim());
  } catch {
    throw new Error(t("Link inválido. Cole o link de pareamento do outro PC."));
  }
  const token = url.searchParams.get("t") ?? "";
  if (url.protocol !== "http:" || !/^[0-9a-f]{32}$/i.test(token))
    throw new Error(t("Link inválido. Cole o link de pareamento do outro PC."));
  const ipv4 = /^\d+\.\d+\.\d+\.\d+$/.test(url.hostname);
  const [a, b] = url.hostname.split(".").map(Number);
  const tailscale = ipv4 && a === 100 && b >= 64 && b <= 127;
  const lan =
    ipv4 &&
    (a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168));
  if (!tailscale && !lan)
    throw new Error(
      t(
        "Use o endereço do outro PC: o do acesso remoto, que começa com 100., ou o da rede local, como 192.168.",
      ),
    );
  return { url: `http://${url.host}/api/source?t=${token}`, lan };
}
