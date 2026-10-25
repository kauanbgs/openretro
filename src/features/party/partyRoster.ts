export interface PartyMember {
  id: string;
  name: string;
  player: number | null;
  avatar?: number;
  /** Came in through the host's guest link, without an account. */
  anonymous?: boolean;
}
export function parsePartyRoster(value: unknown): PartyMember[] {
  if (!Array.isArray(value) || value.length > 3)
    throw new Error("Invalid Party roster");
  const ids = new Set<string>(),
    seats = new Set<number>();
  return value.map((row) => {
    if (
      !row ||
      typeof row !== "object" ||
      typeof row.id !== "string" ||
      !/^[a-zA-Z0-9_-]{1,64}$/.test(row.id) ||
      ids.has(row.id) ||
      typeof row.name !== "string" ||
      !row.name.length ||
      row.name.length > 80 ||
      /[\x00-\x1f\x7f]/.test(row.name) ||
      (row.player !== null && ![2, 3, 4].includes(row.player)) ||
      (row.player !== null && seats.has(row.player)) ||
      (row.avatar !== undefined &&
        (!Number.isInteger(row.avatar) || row.avatar < 0 || row.avatar >= 15))
    )
      throw new Error("Invalid Party roster");
    ids.add(row.id);
    if (row.player !== null) seats.add(row.player);
    return {
      id: row.id,
      name: row.name,
      player: row.player,
      avatar: row.avatar ?? 0,
      ...(row.anonymous === true ? { anonymous: true } : {}),
    };
  });
}
