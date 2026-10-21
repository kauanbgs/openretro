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
} from "lucide-react";
import { Modal } from "../../components/Modal";
import { platforms } from "../../db/platforms";
import { bridge, isDesktop } from "../../services/bridge";
import { listen } from "@tauri-apps/api/event";
import type { Emulator } from "../../types";
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
      {installers.data?.length ? (
        <section
          className="emulator-installs"
          aria-label="Official emulator installers"
        >
          <div className="section-heading">
            <div>
              <h2>Install an emulator</h2>
              <p className="muted">
                Installs use the official Windows package and are configured
                automatically.
              </p>
            </div>
          </div>
          <div className="emulator-install-grid">
            {installers.data.map((installer) => (
              <article
                className={`emulator-install ${installer.isBase ? "emulator-install-base" : ""}`}
                key={installer.id}
              >
                <div className="emulator-icon">
                  <Cpu size={25} />
                </div>
                <div>
                  <h3>{installer.name}</h3>
                  {installer.isBase && (
                    <span className="emulator-base-label">
                      Base recomendada
                    </span>
                  )}
                  <p>{installer.description}</p>
                  <a
                    href={installer.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {installer.sourceName} <ExternalLink size={12} />
                  </a>
                </div>
                <button
                  className="button primary"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      setInstalling({
                        id: installer.id,
                        name: installer.name,
                        progress: 4,
                        stage: "Starting installation",
                      });
                      try {
                        notify(await bridge.installEmulator(installer.id));
                      } finally {
                        setInstalling(null);
                      }
                    })
                  }
                >
                  <Download size={16} />{" "}
                  {installing?.id === installer.id
                    ? "Installing…"
                    : "Install / repair"}
                </button>
                {installing?.id === installer.id && (
                  <div className="emulator-install-progress" role="status">
                    <div>
                      <span>{installing.stage}</span>
                      <strong>{installing.progress}%</strong>
                    </div>
                    <progress value={installing.progress} max={100} />
                  </div>
                )}
              </article>
            ))}
          </div>
        </section>
      ) : null}
      {emulators.length ? (
        <div className="emulator-grid">
          {emulators.map((e) => (
            <article className="emulator-card" key={e.id}>
              <div className="emulator-icon">
                <Cpu size={28} />
              </div>
              <h2>{e.name}</h2>
              <p className="path-text">{e.executablePath}</p>
              <div className="platform-tags">
                {e.supportedPlatforms.map((p) => (
                  <span key={p}>
                    {platforms.find((x) => x.id === p)?.shortName}
                    {e.defaultPlatforms.includes(p) ? " · default" : ""}
                  </span>
                ))}
              </div>
              <div className="emulator-actions">
                <button
                  disabled={busy}
                  className="text-button"
                  onClick={() =>
                    void run(async () =>
                      notify(await bridge.testEmulator(e.id)),
                    )
                  }
                >
                  <Check size={15} /> Test path
                </button>
                <button
                  className="icon-button"
                  aria-label={`Configure ${e.name}`}
                  onClick={() => setEditing(e)}
                >
                  <Settings2 size={17} />
                </button>
                <button
                  disabled={busy}
                  className="icon-button"
                  aria-label={`Remove ${e.name}`}
                  onClick={() => void run(() => bridge.removeEmulator(e.id))}
                >
                  <Trash2 size={17} />
                </button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="empty-state">
          <div className="large-icon">
            <Cpu size={32} />
          </div>
          <h2>Add an emulator to play</h2>
          <p>
            Select an installed emulator and the consoles it supports.
            <br />
            OpenRetro uses it when you launch a compatible game.
          </p>
          <button
            className="button primary"
            onClick={() => setEditing(blank())}
          >
            <Plus size={17} /> Adicionar emulador
          </button>
          <small>Bring your own executable from its official project.</small>
        </div>
      )}
      {detected && (
        <div className="detected-panel">
          <h3>Found on your system PATH</h3>
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
                  Review & add
                </button>
              </div>
            ))
          ) : (
            <p className="muted">
              No supported emulator found on PATH. You can add an installed
              executable manually.
            </p>
          )}
        </div>
      )}
      {editing && (
        <Modal
          title={
            emulators.some((e) => e.id === editing.id)
              ? "Configure emulator"
              : "Add an emulator"
          }
          onClose={() => setEditing(undefined)}
        >
          <div className="form-stack">
            <label>
              Name
              <input
                value={editing.name}
                onChange={(e) =>
                  setEditing({ ...editing, name: e.target.value })
                }
                placeholder="e.g. mGBA"
              />
            </label>
            <label>
              Executable
              <div className="input-action">
                <input
                  value={editing.executablePath}
                  placeholder="Select an installed emulator"
                  onChange={(e) =>
                    setEditing({ ...editing, executablePath: e.target.value })
                  }
                />
                <button
                  className="icon-button"
                  aria-label="Browse executable"
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
              <legend>Supported platforms</legend>
              <div className="platform-checkboxes">
                {platforms.map((p) => (
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
              Default for these platforms
            </label>
            <p className="hint">
              Adding an executable does not run it. The path test checks that
              the file exists and has executable permissions.
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
                  notify("Emulator saved. Ready for your next game.");
                })
              }
            >
              Save emulator
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
