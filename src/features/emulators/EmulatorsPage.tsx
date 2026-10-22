import { PageHeader } from "../../components/PageHeader";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Cpu,
  Plus,
  Search,
  FolderOpen,
  Check,
  Trash2,
  Settings2,
  Download,
  ExternalLink,
  Wrench,
  KeyRound,
  Star,
} from "lucide-react";
import { Modal } from "../../components/Modal";
import { platforms } from "../../db/platforms";
import { bridge, isDesktop } from "../../services/bridge";
import { MANAGED_RUNTIME_ID } from "../../services/GameResolver";
import { listen } from "../../services/transport";
import type { Emulator, EmulatorInstall } from "../../types";

/** Windows extended-length paths are an implementation detail; hide the prefix. */
export function displayPath(path: string) {
  return path.replace(/^\\\\\?\\(UNC\\)?/, (_, unc) => (unc ? "\\\\" : ""));
}
/** The managed runtime installs as openretro-<id>; other installs keep their name. */
export function isInstalled(installer: EmulatorInstall, emulators: Emulator[]) {
  return emulators.some(
    (e) =>
      e.id === `openretro-${installer.id}` ||
      e.name.trim().toLowerCase() === installer.name.toLowerCase(),
  );
}
const shortName = (id: string) =>
  platforms.find((x) => x.id === id)?.shortName ?? id.toUpperCase();
export function EmulatorsPage({
  emulators,
  refresh,
  notify,
}: {
  emulators: Emulator[];
  refresh: () => Promise<void>;
  notify: (message: string) => void;
}) {
  const [editing, setEditing] = useState<Emulator>();
  const [detected, setDetected] = useState<Emulator[]>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [installing, setInstalling] = useState<{
    id: string;
    name: string;
    progress: number;
    stage: string;
  } | null>(null);
  const installers = useQuery({
    queryKey: ["emulator-installers"],
    queryFn: bridge.emulatorInstallOptions,
  });
  const runtimeInstalled = emulators.some((e) => e.id === MANAGED_RUNTIME_ID);
  const ps2Bios = useQuery({
    queryKey: ["runtime-bios", "ps2"],
    queryFn: () => bridge.runtimeBiosStatus("ps2"),
    enabled: isDesktop && runtimeInstalled,
  });
  useEffect(() => {
    if (!isDesktop) return;
    const unlisten = listen<{
      id: string;
      name: string;
      progress: number;
      stage: string;
    }>("emulator-install-progress", ({ payload }) => setInstalling(payload));
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, []);
  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await fn();
      await refresh();
    } catch (e) {
      setError(String(e));
      notify(String(e));
    } finally {
      setBusy(false);
    }
  }
  const blank = (): Emulator => ({
    id: crypto.randomUUID(),
    name: "",
    executablePath: "",
    supportedPlatforms: [],
    defaultPlatforms: [],
  });
  return (
    <div className="page-content">
      <PageHeader
        title="Emuladores"
        description="Instale, configure e escolha o emulador de cada console."
        actions={
          <>
            <button
              disabled={busy}
              className="button secondary"
              onClick={() =>
                void run(async () =>
                  setDetected(await bridge.detectEmulators()),
                )
              }
            >
              <Search size={17} /> Detectar instalados
            </button>
            <button
              className="button primary"
              onClick={() => setEditing(blank())}
            >
              <Plus size={18} /> Adicionar emulador
            </button>
          </>
        }
      />
      {emulators.length ? (
        <section className="emu-section" aria-labelledby="emu-installed">
          <header className="emu-section-heading">
            <h2 id="emu-installed">Seus emuladores</h2>
            <p>
              <Star size={12} fill="currentColor" /> marca o emulador padrão de
              cada console.
            </p>
          </header>
          <div className="emu-list">
            {emulators.map((e) => (
              <article className="emu-row" key={e.id}>
                <div className="emu-icon">
                  <Cpu size={24} />
                </div>
                <div className="emu-identity">
                  <h3>{e.name}</h3>
                  <p className="emu-path" title={displayPath(e.executablePath)}>
                    {displayPath(e.executablePath)}
                  </p>
                </div>
                <div className="emu-platforms">
                  {e.supportedPlatforms.map((p) => (
                    <span
                      key={p}
                      className={
                        e.defaultPlatforms.includes(p) ? "default" : ""
                      }
                      title={
                        e.defaultPlatforms.includes(p)
                          ? `Padrão para ${shortName(p)}`
                          : undefined
                      }
                    >
                      {e.defaultPlatforms.includes(p) && (
                        <Star size={10} fill="currentColor" />
                      )}
                      {shortName(p)}
                    </span>
                  ))}
                </div>
                <div className="emu-actions">
                  <button
                    disabled={busy}
                    className="button secondary"
                    onClick={() =>
                      void run(async () =>
                        notify(await bridge.testEmulator(e.id)),
                      )
                    }
                  >
                    <Check size={15} /> Testar
                  </button>
                  <button
                    className="icon-button"
                    aria-label={`Configurar ${e.name}`}
                    title="Configurar"
                    onClick={() => setEditing(e)}
                  >
                    <Settings2 size={17} />
                  </button>
                  <button
                    disabled={busy}
                    className="icon-button"
                    aria-label={`Remover ${e.name}`}
                    title="Remover"
                    onClick={() => void run(() => bridge.removeEmulator(e.id))}
                  >
                    <Trash2 size={17} />
                  </button>
                </div>
              </article>
            ))}
          </div>
          {runtimeInstalled && isDesktop && (
            <div className="emu-bios">
              <div className="emu-icon">
                <KeyRound size={20} />
              </div>
              <div>
                <h3>BIOS do PlayStation 2</h3>
                <p>
                  {ps2Bios.data
                    ? "Instalada. Os jogos de PS2 rodam no OpenRetro Runtime."
                    : "Necessária para jogos de PS2. Use o .bin do seu console ou um .zip com ele."}
                </p>
              </div>
              {ps2Bios.data && (
                <span className="emu-bios-ok">
                  <Check size={14} /> Pronta
                </span>
              )}
              <button
                className={`button ${ps2Bios.data ? "secondary" : "primary"}`}
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const images = await bridge.installRuntimeBios("ps2");
                    if (images === null) return;
                    await ps2Bios.refetch();
                    notify(
                      images === 1
                        ? "BIOS do PS2 adicionada."
                        : `${images} BIOS do PS2 disponíveis.`,
                    );
                  })
                }
              >
                {ps2Bios.data ? "Adicionar outra" : "Selecionar BIOS"}
              </button>
            </div>
          )}
        </section>
      ) : (
        <div className="empty-state">
          <div className="large-icon">
            <Cpu size={32} />
          </div>
          <h2>Adicione um emulador para jogar</h2>
          <p>
            Instale um emulador abaixo ou selecione um que já está no seu
            computador.
            <br />O OpenRetro usa ele ao abrir um jogo compatível.
          </p>
          <button
            className="button primary"
            onClick={() => setEditing(blank())}
          >
            <Plus size={17} /> Adicionar emulador
          </button>
        </div>
      )}
      {installers.data?.length ? (
        <section className="emu-section" aria-labelledby="emu-catalog">
          <header className="emu-section-heading">
            <h2 id="emu-catalog">Instalar emuladores</h2>
            <p>
              Usa o pacote oficial para Windows e configura tudo
              automaticamente.
            </p>
          </header>
          <div className="emu-catalog">
            {installers.data.map((installer) => {
              const installed = isInstalled(installer, emulators);
              const active = installing?.id === installer.id;
              return (
                <article
                  className={`emu-offer ${installer.isBase ? "base" : ""}`}
                  key={installer.id}
                >
                  <div className="emu-offer-top">
                    <div className="emu-icon">
                      <Cpu size={22} />
                    </div>
                    <div>
                      <h3>{installer.name}</h3>
                      <div className="emu-offer-badges">
                        {installer.isBase && (
                          <span className="recommended">Recomendado</span>
                        )}
                        {installed && (
                          <span className="installed">
                            <Check size={11} /> Instalado
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <p className="emu-offer-description">
                    {installer.description}
                  </p>
                  <div className="emu-offer-consoles">
                    {installer.supportedPlatforms.map((p) => (
                      <span key={p}>{shortName(p)}</span>
                    ))}
                  </div>
                  {active ? (
                    <div className="emu-offer-progress" role="status">
                      <div>
                        <span>{installing.stage}</span>
                        <strong>{installing.progress}%</strong>
                      </div>
                      <progress value={installing.progress} max={100} />
                    </div>
                  ) : (
                    <div className="emu-offer-footer">
                      <a
                        href={installer.sourceUrl}
                        target="_blank"
                        rel="noreferrer"
                        title={installer.sourceName}
                      >
                        Site oficial <ExternalLink size={11} />
                      </a>
                      <button
                        className={`button ${installed ? "secondary" : "primary"}`}
                        disabled={busy}
                        onClick={() =>
                          void run(async () => {
                            setInstalling({
                              id: installer.id,
                              name: installer.name,
                              progress: 4,
                              stage: "Iniciando instalação",
                            });
                            try {
                              notify(
                                await bridge.installEmulator(installer.id),
                              );
                            } finally {
                              setInstalling(null);
                            }
                          })
                        }
                      >
                        {installed ? (
                          <>
                            <Wrench size={15} /> Reparar
                          </>
                        ) : (
                          <>
                            <Download size={15} /> Instalar
                          </>
                        )}
                      </button>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        </section>
      ) : null}
      {detected && (
        <div className="detected-panel">
          <h3>Encontrados no seu computador</h3>
          {detected.length ? (
            detected.map((e) => (
              <div className="detected-item" key={e.id}>
                <span>
                  {e.name}
                  <small>{e.executablePath}</small>
                </span>
                <button
                  className="button secondary"
                  onClick={() => {
                    setEditing(e);
                    setDetected(undefined);
                  }}
                >
                  Revisar e adicionar
                </button>
              </div>
            ))
          ) : (
            <p className="muted">
              Nenhum emulador compatível foi encontrado. Você pode adicionar um
              executável manualmente.
            </p>
          )}
        </div>
      )}
      {editing && (
        <Modal
          title={
            emulators.some((e) => e.id === editing.id)
              ? "Configurar emulador"
              : "Adicionar emulador"
          }
          onClose={() => setEditing(undefined)}
        >
          <div className="form-stack">
            <label>
              Nome
              <input
                value={editing.name}
                onChange={(e) =>
                  setEditing({ ...editing, name: e.target.value })
                }
                placeholder="ex.: mGBA"
              />
            </label>
            <label>
              Executável
              <div className="input-action">
                <input
                  value={editing.executablePath}
                  placeholder="Selecione um emulador instalado"
                  onChange={(e) =>
                    setEditing({ ...editing, executablePath: e.target.value })
                  }
                />
                <button
                  className="icon-button"
                  aria-label="Procurar executável"
                  onClick={() =>
                    void run(async () => {
                      const p = await bridge.pickExecutable();
                      if (p) setEditing({ ...editing, executablePath: p });
                    })
                  }
                >
                  <FolderOpen size={18} />
                </button>
              </div>
            </label>
            <fieldset>
              <legend>Consoles compatíveis</legend>
              <div className="platform-checkboxes">
                {platforms
                  .filter((p) => !p.catalogOnly)
                  .map((p) => (
                    <label key={p.id}>
                      <input
                        type="checkbox"
                        checked={editing.supportedPlatforms.includes(p.id)}
                        onChange={(e) =>
                          setEditing({
                            ...editing,
                            supportedPlatforms: e.target.checked
                              ? [...editing.supportedPlatforms, p.id]
                              : editing.supportedPlatforms.filter(
                                  (id) => id !== p.id,
                                ),
                            defaultPlatforms: editing.defaultPlatforms.filter(
                              (id) => id !== p.id,
                            ),
                          })
                        }
                      />
                      {p.shortName}
                    </label>
                  ))}
              </div>
            </fieldset>
            <label className="checkbox-line">
              <input
                type="checkbox"
                checked={
                  editing.supportedPlatforms.length > 0 &&
                  editing.supportedPlatforms.every((p) =>
                    editing.defaultPlatforms.includes(p),
                  )
                }
                onChange={(e) =>
                  setEditing({
                    ...editing,
                    defaultPlatforms: e.target.checked
                      ? [...editing.supportedPlatforms]
                      : [],
                  })
                }
              />{" "}
              Padrão para estes consoles
            </label>
            <p className="hint">
              Adicionar um executável não o executa. O teste confere se o
              arquivo existe e pode ser executado.
            </p>
            {error && (
              <p className="error-message" role="alert">
                {error}
              </p>
            )}
            <button
              disabled={
                busy ||
                !editing.name.trim() ||
                !editing.executablePath ||
                !editing.supportedPlatforms.length
              }
              className="button primary full"
              onClick={() =>
                void run(async () => {
                  await bridge.saveEmulator(editing);
                  setEditing(undefined);
                  notify("Emulador salvo. Pronto para o próximo jogo.");
                })
              }
            >
              Salvar emulador
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
