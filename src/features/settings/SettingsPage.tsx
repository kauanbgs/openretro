import { BrandMark } from "../../components/Brand";
import { PageHeader } from "../../components/PageHeader";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { Check, AlertCircle, ExternalLink, Folder } from "lucide-react";
import { bridge } from "../../services/bridge";
import { defaultSettings, type AppSettings } from "../../types";
import { SourceManager } from "../downloads/SourceManager";
import { PlayerPicker } from "../../components/PlayerPicker";
import { PlayerAvatar } from "../../components/PlayerAvatar";
const sectionLabels: Record<string, string> = {
  General: "Geral",
  Library: "Biblioteca",
  Emulators: "Emuladores",
  Downloads: "Downloads",
  Appearance: "Aparência",
  Advanced: "Avançado",
};
export function SettingsPage({
  onEmulators,
  notify,
}: {
  onEmulators: () => void;
  notify: (s: string) => void;
}) {
  const [section, setSection] = useState("General");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const writes = useRef(Promise.resolve());
  const version = useRef(0);
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
    const revision = ++version.current;
    setSaving(true);
    setSaveError("");
    await client.cancelQueries({ queryKey: ["settings"] });
    const next = {
      ...defaultSettings,
      ...client.getQueryData<AppSettings>(["settings"]),
      ...patch,
    };
    client.setQueryData(["settings"], next);
    // Preserve consecutive edits and serialize native writes instead of racing snapshots.
    writes.current = writes.current
      .catch(() => undefined)
      .then(async () => {
        await bridge.saveSettings(next);
      });
    try {
      await writes.current;
      if (revision === version.current) client.setQueryData(["settings"], next);
    } catch (e) {
      if (revision === version.current) {
        setSaveError(String(e));
        notify(String(e));
        await client.invalidateQueries({ queryKey: ["settings"] });
      }
    } finally {
      if (revision === version.current) setSaving(false);
    }
  }
  return (
    <div className="page-content">
      {playersOpen && <PlayerPicker onClose={() => setPlayersOpen(false)} />}
      <PageHeader
        title="Configurações"
        description="Personalize como você organiza e joga."
        actions={
          <span
            className="saved-status"
            data-error={Boolean(saveError)}
            role="status"
          >
            {saveError ? <AlertCircle size={15} /> : <Check size={15} />}
            {saving
              ? "Salvando…"
              : saveError
                ? "Alteração não salva"
                : "Salvamento automático"}
          </span>
        }
      />
      {saveError && (
        <p className="error-message" role="alert">
          Não foi possível salvar. As preferências foram recarregadas.{" "}
          {saveError}
        </p>
      )}
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
              {sectionLabels[s]}
            </button>
          ))}
        </nav>
        <div className="settings-panel">
          <h2>{sectionLabels[section]}</h2>
          {section === "General" ? (
            <>
              <div className="setting-row">
                <div className="player-chip">
                  <PlayerAvatar
                    player={players?.players.find(
                      (p) => p.id === players.activeId,
                    )}
                    size={40}
                  />
                  <div>
                    <strong>Jogador</strong>
                    <p>
                      {players?.players.find((p) => p.id === players.activeId)
                        ?.name ?? "Jogador 1"}{" "}
                      · saves e favoritos individuais
                    </p>
                  </div>
                </div>
                <button
                  className="button secondary"
                  onClick={() => setPlayersOpen(true)}
                >
                  Trocar ou personalizar
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
                  <strong>Idioma da interface</strong>
                  <p>
                    Algumas telas e mensagens dos emuladores aparecem em inglês.
                  </p>
                </div>
                <select disabled aria-label="Idioma da interface">
                  <option>Português / English</option>
                </select>
              </div>
              <div className="setting-row">
                <div>
                  <strong>Iniciar com o sistema</strong>
                  <p>
                    A inicialização junto com o sistema ainda não está
                    disponível.
                  </p>
                </div>
                <span className="badge">Em breve</span>
              </div>
              <div className="about-box">
                <BrandMark />
                <div>
                  <strong>OpenRetro</strong>
                  <p>Versão 0.3.8</p>
                </div>
              </div>
            </>
          ) : section === "Library" ? (
            <>
              <div className="setting-row">
                <div>
                  <strong>Pastas da biblioteca</strong>
                  <p>
                    Seus arquivos permanecem nas pastas em que foram importados.
                    <br />
                    Altere o caminho na aba de detalhes do jogo.
                  </p>
                </div>
                <Folder size={21} />
              </div>
              <div className="setting-row">
                <div>
                  <strong>Buscar novos jogos automaticamente</strong>
                  <p>
                    Use Adicionar jogo para importar um arquivo ou uma pasta.
                  </p>
                </div>
                <span className="badge">Em breve</span>
              </div>
            </>
          ) : section === "Emulators" ? (
            <>
              <div className="setting-row">
                <div>
                  <strong>Emuladores e consoles</strong>
                  <p>
                    Instale, teste e escolha o emulador padrão para cada
                    console.
                  </p>
                </div>
                <button className="button secondary" onClick={onEmulators}>
                  Gerenciar <ExternalLink size={15} />
                </button>
              </div>
              <div className="setting-row">
                <div>
                  <strong>Resolução do PlayStation 2</strong>
                  <p>
                    Desenha os jogos de PS2 em uma resolução maior que a do
                    console, deixando a imagem mais nítida. Valores altos exigem
                    mais da placa de vídeo. Vale a partir do próximo jogo
                    aberto.
                  </p>
                </div>
                <select
                  aria-label="Resolução do PlayStation 2"
                  value={settings.ps2Resolution ?? "2x"}
                  onChange={(e) =>
                    void save({
                      ps2Resolution: e.target
                        .value as AppSettings["ps2Resolution"],
                    })
                  }
                >
                  <option value="1x">Nativa (640×448)</option>
                  <option value="2x">2x · recomendado (~1280×896)</option>
                  <option value="4x">4x · mais nítido (~2560×1792)</option>
                  <option value="8x">8x · muito pesado</option>
                </select>
              </div>
            </>
          ) : section === "Downloads" ? (
            <>
              <SourceManager />
              <label>
                Pasta de downloads
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
                <Folder size={16} /> Escolher pasta de downloads
              </button>
              <div className="setting-row">
                <div>
                  <strong>Downloads simultâneos</strong>
                  <p>
                    Os downloads são independentes. O limite da fila ainda não
                    está disponível.
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
                  <strong>Limite de velocidade</strong>
                  <p>O controle de velocidade ainda não está disponível.</p>
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
                  <strong>Tema</strong>
                  <p>Escolha a aparência da interface.</p>
                </div>
                <select
                  aria-label="Theme"
                  value={settings.theme}
                  onChange={(e) =>
                    void save({ theme: e.target.value as AppSettings["theme"] })
                  }
                >
                  <option value="dark">Escuro</option>
                  <option value="light">Claro</option>
                </select>
              </div>
              <div className="setting-row">
                <div>
                  <strong>Densidade da biblioteca</strong>
                  <p>Ajuste o tamanho dos jogos exibidos na biblioteca.</p>
                </div>
                <select
                  aria-label="Densidade da biblioteca"
                  value={settings.density}
                  onChange={(e) =>
                    void save({
                      density: e.target.value as AppSettings["density"],
                    })
                  }
                >
                  <option value="comfortable">Confortável</option>
                  <option value="compact">Compacta</option>
                </select>
              </div>
              <div className="setting-row">
                <div>
                  <strong>Animações da interface</strong>
                  <p>Transições curtas ao navegar e abrir menus.</p>
                </div>
                <button
                  role="switch"
                  aria-checked={settings.animations}
                  aria-label="Animações da interface"
                  className={`switch ${settings.animations ? "on" : ""}`}
                  onClick={() =>
                    void save({ animations: !settings.animations })
                  }
                >
                  <span />
                </button>
              </div>
              <div className="setting-row">
                <div>
                  <strong>Sons de navegação</strong>
                  <p>Sons curtos ao mover e escolher no modo console.</p>
                </div>
                <button
                  role="switch"
                  aria-checked={settings.navigationSounds !== false}
                  aria-label="Sons de navegação"
                  className={`switch ${settings.navigationSounds !== false ? "on" : ""}`}
                  onClick={() =>
                    void save({
                      navigationSounds: settings.navigationSounds === false,
                    })
                  }
                >
                  <span />
                </button>
              </div>
              <div className="setting-row">
                <div>
                  <strong>Atualizar automaticamente</strong>
                  <p>
                    Baixa novas versões em segundo plano e instala ao abrir o
                    OpenRetro.
                  </p>
                </div>
                <button
                  role="switch"
                  aria-checked={settings.autoUpdate !== false}
                  aria-label="Atualizar automaticamente"
                  className={`switch ${settings.autoUpdate !== false ? "on" : ""}`}
                  onClick={() =>
                    void save({ autoUpdate: settings.autoUpdate === false })
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
                  <strong>Modo de desenvolvedor</strong>
                  <p>Mostre informações técnicas na barra lateral.</p>
                </div>
                <button
                  role="switch"
                  aria-checked={settings.developerMode}
                  aria-label="Modo de desenvolvedor"
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
