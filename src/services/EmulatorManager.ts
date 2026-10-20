import type { Emulator } from "../types";
import { bridge } from "./bridge";
export interface EmulatorInstaller {
  officialUrl: string;
  install(): Promise<void>;
}
export class EmulatorManager {
  constructor(private emulators: Emulator[]) {}
  resolve(
    platformId: string,
    preferredId: string | null,
  ): Emulator | undefined {
    const compatible = this.emulators.filter((e) =>
      e.supportedPlatforms.includes(platformId),
    );
    return preferredId
      ? compatible.find((e) => e.id === preferredId)
      : (compatible.find((e) => e.defaultPlatforms.includes(platformId)) ??
          compatible[0]);
  }
  detect = () => bridge.detectEmulators();
  test = (id: string) => bridge.testEmulator(id);
}
