import type { GameMetadata, ImportCandidate } from "../types";
import { bridge } from "./bridge";
export class LibraryManager {
  async import(game: GameMetadata, candidate: ImportCandidate) {
    if (!candidate.platformIds.includes(game.platformId))
      throw new Error(
        "The selected platform does not support this file extension.",
      );
    await bridge.addGame(game, candidate);
  }
}
