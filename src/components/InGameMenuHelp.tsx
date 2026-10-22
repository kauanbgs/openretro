import { Camera, Gamepad2 } from "lucide-react";
import type { Emulator, LibraryGame } from "../types";
import { EmulatorManager } from "../services/EmulatorManager";
import { bridge } from "../services/bridge";
import { KeyboardMap } from "./KeyboardMap";

export function hasRuntimeMenu(
  entry: LibraryGame | undefined,
  emulators: Emulator[],
) {
  if (!entry || entry.item.runtimeArgs.length) return false;
  const emulator = new EmulatorManager(emulators).resolve(
    entry.item.platformId,
    entry.item.emulatorId,
  );
  return (
    emulator?.id === "openretro-retroarch" ||
    emulator?.name.toLowerCase() === "retroarch" ||
    emulator?.name.toLowerCase() === "openretro runtime"
  );
}

export function InGameMenuHelp({
  entry,
  emulators,
  notify,
}: {
  entry: LibraryGame;
  emulators: Emulator[];
  notify: (message: string) => void;
}) {
  if (!hasRuntimeMenu(entry, emulators)) return null;
  return (
    <section className="runtime-menu-help" aria-label="Menu durante o jogo">
      <Gamepad2 size={24} />
      <div>
        <h2>Menu durante o jogo</h2>
        <p>
          Aperte <strong>PS</strong> para pausar e abrir o menu do OpenRetro.
          Alternativas: <strong>Share + Options</strong> (Select + Start) ou{" "}
          <strong>F1</strong>.
        </p>
        <p>
          Salve e carregue estados, escolha o slot, tire prints, reinicie ou
          encerre o jogo. Estados dependem do suporte do core.
        </p>
        <details className="keyboard-help">
          <summary>Jogar no teclado</summary>
          <KeyboardMap />
        </details>
      </div>
      <button
        className="button secondary"
        onClick={() =>
          void bridge
            .openGameScreenshots(entry.item.id)
            .catch((error) => notify(String(error)))
        }
      >
        <Camera size={17} /> Minhas capturas
      </button>
    </section>
  );
}
