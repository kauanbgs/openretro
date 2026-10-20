import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Check, ExternalLink, Folder, Info } from "lucide-react";
import { bridge } from "../../services/bridge";
import { defaultSettings, type AppSettings } from "../../types";
export function SettingsPage({
  onEmulators,
  notify,
}: {
  onEmulators: () => void;
  notify: (s: string) => void;
}) {
  const [section, setSection] = useState("General");
  const [saving, setSaving] = useState(false);
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
      <div className="page-title">
        <div>
          <span className="eyebrow">MAKE YOURSELF AT HOME</span>
          <h1>
            Settings<span className="accent">.</span>
          </h1>
          <p>Your collection, your way.</p>
        </div>
        <span className="saved-status">
          <Check size={15} />
          {saving ? "Saving…" : "Changes saved automatically"}
        </span>
      </div>
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
                  <strong>Application language</strong>
                  <p>The MVP interface is available in English.</p>
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
                <div className="brand-icon small">
                  o<span />
                </div>
                <div>
                  <strong>OpenRetro</strong>
                  <p>Version 0.1.0 · An open home for your classic games.</p>
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
                    Folder watching is planned. Import files using Add Game.
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
              <p className="notice">
                <Info size={17} /> No network transport is enabled in this
                milestone. Download preferences are reserved for future
                authorized sources.
              </p>
              <label>
                Download directory
                <input
                  disabled
                  value={settings.downloadDirectory}
                  placeholder="Not configured"
                  readOnly
                />
              </label>
              <div className="setting-row">
                <div>
                  <strong>Concurrent downloads</strong>
                  <p>Reserved setting · transport not yet implemented.</p>
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
                  <option value="dark">Midnight</option>
                  <option value="light">Daylight</option>
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
                  <p>A little movement between adventures.</p>
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
