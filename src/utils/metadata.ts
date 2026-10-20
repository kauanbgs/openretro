import type { GameMetadata } from "../types";

// Remote IDs identify catalog entries; local IDs identify a specific library record.
export function enrichGameMetadata(
  local: GameMetadata,
  remote?: GameMetadata,
): GameMetadata {
  return remote
    ? { ...remote, id: local.id, platformId: local.platformId }
    : local;
}
