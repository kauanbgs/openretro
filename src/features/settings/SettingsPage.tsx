import { BrandMark } from "../../components/Brand";
import { PageHeader } from "../../components/PageHeader";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Check, ExternalLink, Folder } from "lucide-react";
import { bridge } from "../../services/bridge";
import { defaultSettings, type AppSettings } from "../../types";
import { SourceManager } from "../downloads/SourceManager";
import { PlayerPicker } from "../../components/PlayerPicker";
export function SettingsPage({
  onEmulators,
  notify,
}: {
  onEmulators: () => void;
  notify: (s: string) => void;
}) {
  const [section, setSection] = useState("General");
  const [saving, setSaving] = useState(false);
  const [playersOpen, setPlayersOpen] = useState(false);
  const { data: players } = useQuery({
    queryKey: ["players"],
    queryFn: bridge.profiles,
  });
  const client = useQueryClient();
  const { data: settings = defaultSettings } = useQuery({
    queryKey: ["settings"],
    queryFn: bridge.settings,
  });
  const { data: paths } = useQuery({
    queryKey: ["paths"],
    queryFn: bridge.appPaths,
  });
  async function save(patch: Partial<AppSettings>) {
    setSaving(true);
    try {
      await bridge.saveSettings({ ...settings, ...patch });
      await client.invalidateQueries({ queryKey: ["settings"] });
    } catch (e) {
      notify(String(e));
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className="page-content">
      {playersOpen && <PlayerPicker onClose={() => setPlayersOpen(false)} />}
      <PageHeader
        title="Settings"
        description="Manage your library and application preferences."
        actions={
          <span className="saved-status">
            <Check size={15} />
            {saving ? "Saving…" : "All changes saved"}
          </span>
        }
      />
      <div className="settings-layout">
        <nav className="settings-nav">
          {[
            "General",
            "Library",
            "Emulators",
            "Downloads",
            "Appearance",
            "Advanced",
          ].map((s) => (
            <button
              className={s === section ? "selected" : ""}
              key={s}
              onClick={() => setSection(s)}
            >
              {s}
            </button>
          ))}
        </nav>
        <div className="settings-panel">
          <h2>{section}</h2>
          {section === "General" ? (
            <>
              <div className="setting-row">
                <div>
                  <strong>Jogador</strong>
                  <p>
                    {players?.players.find((p) => p.id === players.activeId)
                      ?.name ?? "Jogador 1"}{" "}
                    · saves e favoritos individuais
                  </p>
                </div>
                <button
                  className="button secondary"
                  onClick={() => setPlayersOpen(true)}
                >
                  Trocar jogador
                </button>
              </div>
              <div className="setting-row">
                <div>
                  <strong>Continuar de onde parou</strong>
                  <p>
                    No runtime integrado, salva ao encerrar normalmente e retoma
                    ao jogar novamente. Depende do suporte a estados do core.
                  </p>
                </div>
                <button
                  className={`switch ${settings.autoResume !== false ? "on" : ""}`}
                  role="switch"
                  aria-label="Continuar de onde parou"
                  aria-checked={settings.autoResume !== false}
                  disabled={saving}
                  onClick={() =>
                    void save({ autoResume: settings.autoResume === false })
                  }
                >
                  <span />
                </button>
              </div>
              <div className="setting-row">
                <div>
                  <strong>Coop de sofá</strong>
                  <p>
                    O runtime integrado configura até 4 controles na ordem
                    detectada. Conecte-os antes de jogar. A quantidade de
                    jogadores depende do jogo; multitap não é ativado
                    automaticamente.
                  </p>
                </div>
              </div>
              <div className="setting-row">
                <div>
                  <strong>Application language</strong>
                  <p>The interface is currently available in English.</p>
                </div>
                <select disabled aria-label="Application language">
                  <option>English</option>
                </select>
              </div>
              <div className="setting-row">
                <div>
                  <strong>Start with system / Start minimized</strong>
                  <p>
                    System startup integration is planned for a future release.
                  </p>
                </div>
                <span className="badge">Planned</span>
              </div>
              <div className="about-box">
                <BrandMark />
                <div>
                  <strong>OpenRetro</strong>
                  <p>Version 0.1.0</p>
                </div>
              </div>
            </>
          ) : section === "Library" ? (
            <>
              <div className="setting-row">
                <div>
                  <strong>Library folders</strong>
                  <p>
                    Imported files remain in their original locations.
                    <br />
                    Manage each path from the game’s Details tab.
                  </p>
                </div>
                <Folder size={21} />
              </div>
              <div className="setting-row">
                <div>
                  <strong>Scan automatically</strong>
                  <p>
                    Automatic scans are not available yet. Use Add game to
                    import a file.
                  </p>
                </div>
                <span className="badge">Planned</span>
              </div>
            </>
          ) : section === "Emulators" ? (
            <div className="setting-row">
              <div>
                <strong>Installed emulators & platform defaults</strong>
                <p>Add executables, test their paths, and choose defaults.</p>
              </div>
              <button className="button secondary" onClick={onEmulators}>
                Manage <ExternalLink size={15} />
              </button>
            </div>
          ) : section === "Downloads" ? (
            <>
              <SourceManager />
              <label>
                Download directory
                <input
                  disabled
                  value={settings.downloadDirectory}
                  placeholder="OpenRetro application data / downloads"
                  readOnly
                />
              </label>
              <button
                className="button secondary"
                onClick={() =>
                  void bridge
                    .pickDownloadDirectory()
                    .then((path) => {
                      if (path) return save({ downloadDirectory: path });
                    })
                    .catch((e) => notify(String(e)))
                }
              >
                <Folder size={16} /> Choose download directory
              </button>
              <div className="setting-row">
                <div>
                  <strong>Concurrent downloads</strong>
                  <p>
                    Torrents run independently. Queue limits are not available
                    yet.
                  </p>
                </div>
                <input
                  disabled
                  type="number"
                  value={settings.concurrentDownloads}
                  readOnly
                />
              </div>
              <div className="setting-row">
                <div>
                  <strong>Bandwidth limit</strong>
                  <p>0 = unlimited · reserved setting.</p>
                </div>
                <input
                  disabled
                  type="number"
                  value={settings.bandwidthLimit}
                  readOnly
                />
              </div>
            </>
          ) : section === "Appearance" ? (
            <>
              <div className="setting-row">
                <div>
                  <strong>Theme</strong>
                  <p>A quiet backdrop for your collection.</p>
                </div>
                <select
                  aria-label="Theme"
                  value={settings.theme}
                  onChange={(e) =>
                    void save({ theme: e.target.value as AppSettings["theme"] })
                  }
                >
                  <option value="dark">Dark</option>
                  <option value="light">Light</option>
                </select>
              </div>
              <div className="setting-row">
                <div>
                  <strong>Library density</strong>
                  <p>Choose how much of your collection you see.</p>
                </div>
                <select
                  aria-label="Library density"
                  value={settings.density}
                  onChange={(e) =>
                    void save({
                      density: e.target.value as AppSettings["density"],
                    })
                  }
                >
                  <option value="comfortable">Comfortable</option>
                  <option value="compact">Compact</option>
                </select>
              </div>
              <div className="setting-row">
                <div>
                  <strong>Subtle animations</strong>
                  <p>Animate loading indicators and control transitions.</p>
                </div>
                <button
                  role="switch"
                  aria-checked={settings.animations}
                  aria-label="Subtle animations"
                  className={`switch ${settings.animations ? "on" : ""}`}
                  onClick={() =>
                    void save({ animations: !settings.animations })
                  }
                >
                  <span />
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="hint">
                Local data belongs to you. Imported game files are never copied
                or modified.
              </p>
              {Object.entries(paths ?? {}).map(([key, value]) => (
                <div className="setting-row" key={key}>
                  <div>
                    <strong>
                      {key[0].toUpperCase() + key.slice(1)} location
                    </strong>
                    <code className="path-text">{value}</code>
                  </div>
                </div>
              ))}
              <div className="setting-row">
                <div>
                  <strong>Developer mode</strong>
                  <p>Show runtime and storage details in the sidebar.</p>
                </div>
                <button
                  role="switch"
                  aria-checked={settings.developerMode}
                  aria-label="Developer mode"
                  className={`switch ${settings.developerMode ? "on" : ""}`}
                  onClick={() =>
                    void save({ developerMode: !settings.developerMode })
                  }
                >
                  <span />
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
