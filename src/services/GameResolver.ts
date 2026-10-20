import { platformById } from "../db/platforms";
import type {
  Emulator,
  GameMetadata,
  GameResolution,
  LibraryItem,
} from "../types";
import { LocalFileProvider } from "../providers/sources";
import { EmulatorManager } from "./EmulatorManager";
export class GameResolver {
  constructor(private exists: (path: string) => Promise<boolean>) {}
  async resolve(
    game: GameMetadata,
    item: LibraryItem | undefined,
    emulators: Emulator[],
  ): Promise<GameResolution> {
    const platform = platformById(game.platformId);
    if (!platform)
      return {
        state: "UNSUPPORTED",
        message: "This platform is not supported yet.",
      };
    const source = await new LocalFileProvider(item, this.exists).resolve();
    if (!source.available)
      return { state: "MISSING_GAME", message: source.reason! };
    const emulator = new EmulatorManager(emulators).resolve(
      platform.id,
      item?.emulatorId ?? null,
    );
    if (!emulator || !(await this.exists(emulator.executablePath)))
      return {
        state: "MISSING_EMULATOR",
        message: `An emulator is required to play this game. Configure a compatible emulator for ${platform.name}.`,
      };
    if (
      platform.biosRequired &&
      (!item?.biosPath || !(await this.exists(item.biosPath)))
    )
      return {
        state: "MISSING_BIOS",
        message:
          "This platform needs a legally obtained BIOS. Configure its path and the arguments required by your emulator.",
        emulator,
      };
    if (
      platform.biosRequired &&
      !item?.runtimeArgs.some((arg) => arg.includes("{bios}"))
    )
      return {
        state: "CONFIGURATION_REQUIRED",
        message:
          "Add the BIOS argument expected by your emulator using the {bios} placeholder.",
        emulator,
      };
    const args = (item?.runtimeArgs ?? []).map((arg) =>
      arg
        .replaceAll("{bios}", item?.biosPath ?? "")
        .replaceAll("{game}", source.localPath!),
    );
    if (!item?.runtimeArgs.some((arg) => arg.includes("{game}")))
      args.push(source.localPath!);
    return {
      state: "READY",
      message: "Everything is ready. Let’s play.",
      emulator,
      file: source.localPath,
      args,
    };
  }
}
