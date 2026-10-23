import { NETPLAY_PLATFORMS } from "../types";

const PREFIX = "OPENRETRO1.";
const MAX_LENGTH = 4096;
export interface NetplayInvite {
  address: string;
  port: number;
  platformId: string;
  sha256: string;
  title: string;
}

/** A single host, without a port, URL, path or command-line arguments. */
export function validNetplayHost(address: string): boolean {
  if (!address || address.length > 253) return false;
  if (address.includes(":")) {
    try {
      return new URL(`http://[${address}]/`).hostname.startsWith("[");
    } catch {
      return false;
    }
  }
  return address
    .split(".")
    .every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label));
}

function validate(value: unknown): NetplayInvite {
  if (!value || typeof value !== "object") throw new Error("Convite inválido.");
  const invite = value as NetplayInvite;
  if (
    typeof invite.address !== "string" ||
    !validNetplayHost(invite.address) ||
    !Number.isInteger(invite.port) ||
    invite.port < 1024 ||
    invite.port > 65535 ||
    !NETPLAY_PLATFORMS.includes(invite.platformId) ||
    typeof invite.sha256 !== "string" ||
    !/^[a-f0-9]{64}$/i.test(invite.sha256) ||
    typeof invite.title !== "string" ||
    !invite.title.trim() ||
    invite.title.length > 256
  )
    throw new Error("Convite inválido. Peça um novo código ao anfitrião.");
  return {
    address: invite.address,
    port: invite.port,
    platformId: invite.platformId,
    sha256: invite.sha256.toLowerCase(),
    title: invite.title,
  };
}

/** Portable connection details; no password or local file paths are included. */
export function createNetplayInvite(value: NetplayInvite): string {
  const bytes = new TextEncoder().encode(JSON.stringify(validate(value)));
  const payload = btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return PREFIX + payload;
}

export function parseNetplayInvite(code: string): NetplayInvite {
  const text = code.trim();
  if (text.length > MAX_LENGTH || !text.startsWith(PREFIX))
    throw new Error("Cole um código de convite do OpenRetro válido.");
  try {
    const payload = text.slice(PREFIX.length);
    if (!/^[A-Za-z0-9_-]+$/.test(payload)) throw new Error();
    const binary = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    return validate(
      JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(
          Uint8Array.from(binary, (char) => char.charCodeAt(0)),
        ),
      ),
    );
  } catch {
    throw new Error("Convite inválido. Peça um novo código ao anfitrião.");
  }
}

export function checkInviteGame(
  invite: NetplayInvite,
  platformId: string,
  sha256: string,
): void {
  if (
    invite.platformId !== platformId ||
    invite.sha256 !== sha256.toLowerCase()
  )
    throw new Error(
      `Este convite é para ${invite.title}. Abra a mesma versão e o mesmo arquivo do jogo para entrar.`,
    );
}
