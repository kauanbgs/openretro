import type { GameMetadata, LibraryItem, SourceResolution } from "../../types";
export interface GameSourceProvider {
  id: string;
  name: string;
  canHandle(game: GameMetadata): Promise<boolean>;
  resolve(game: GameMetadata): Promise<SourceResolution>;
}
export class LocalFileProvider implements GameSourceProvider {
  id = "local";
  name = "Your local files";
  constructor(
    private item: LibraryItem | undefined,
    private exists: (path: string) => Promise<boolean>,
  ) {}
  async canHandle(game: GameMetadata) {
    return this.item?.gameId === game.id;
  }
  async resolve(): Promise<SourceResolution> {
    const path = this.item?.sourcePath;
    return path && (await this.exists(path))
      ? { available: true, localPath: path }
      : {
          available: false,
          reason:
            "Locate your game file to continue. Your original file is never modified.",
        };
  }
}
export class MockFreewareProvider implements GameSourceProvider {
  id = "mock-freeware";
  name = "Development fixtures";
  async canHandle() {
    return false;
  }
  async resolve(): Promise<SourceResolution> {
    return {
      available: false,
      reason:
        "This catalog contains fictional metadata only. No downloadable game is provided.",
    };
  }
}
