/** A host's link that opens one seat to a browser guest without an account. */
export interface PartyGuestLink {
  url: string;
  player: number;
  expires: number;
}

/** Reads the room's `guest-link` message; `null` means the link was closed.
 * The link must point at the room's own server, or the host would hand out
 * an address the server never chose. */
export function parsePartyGuestLink(
  message: unknown,
  roomUrl: string,
): PartyGuestLink | null {
  if (!message || typeof message !== "object")
    throw new Error("Invalid guest link");
  const { url, player, expires } = message as Record<string, unknown>;
  if (url === null) return null;
  const room = new URL(roomUrl);
  if (typeof url !== "string" || url.length > 512)
    throw new Error("Invalid guest link");
  const link = new URL(url);
  // The link is one short code right on the room server's own address.
  if (
    link.origin !== room.origin ||
    !/^\/[A-HJ-NP-Z2-9]{6}$/.test(link.pathname) ||
    link.search ||
    link.hash ||
    typeof player !== "number" ||
    ![2, 3, 4].includes(player) ||
    typeof expires !== "number" ||
    !Number.isSafeInteger(expires)
  )
    throw new Error("Invalid guest link");
  return { url: link.href, player, expires };
}
