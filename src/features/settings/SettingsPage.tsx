import { BrandMark } from "../../components/Brand";
import { PageHeader } from "../../components/PageHeader";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState, type ReactNode } from "react";
import {
  Check,
  AlertCircle,
  Folder,
  Settings,
  Gamepad2,
  Download,
  Palette,
  Wrench,
  Trophy,
  type LucideIcon,
} from "lucide-react";
import { bridge } from "../../services/bridge";
import { defaultSettings, type AppSettings } from "../../types";
import { version as appVersion } from "../../../package.json";
import { adoptLanguage, languages, t } from "../../i18n";
import { AchievementsAccount } from "../achievements/AchievementsAccount";
type Section =
  | "General"
  | "Games"
  | "Achievements"
  | "Downloads"
  | "Appearance"
  | "Advanced";
const sections: {
  id: Section;
  label: string;
  icon: LucideIcon;
  description: string;
}[] = [
  {
    id: "General",
    label: t("Geral"),
    icon: Settings,
    description: t("Como o OpenRetro abre, joga e se atualiza."),
  },
  {
    id: "Games",
    label: t("Jogos"),
    icon: Gamepad2,
    description: t("Como a imagem dos jogos aparece e as atualizações do PS3."),
  },
  {
    id: "Achievements",
    label: t("Conquistas"),
    icon: Trophy,
    description: t("Sua conta do RetroAchievements e o modo hardcore."),
  },
  {
    id: "Downloads",
    label: "Downloads",
    icon: Download,
    description: t("Fontes de jogos, pasta de destino e o que fazer depois."),
  },
  {
    id: "Appearance",
    label: t("Aparência"),
    icon: Palette,
    description: t("Tema, tamanho dos jogos, animações e sons."),
  },
  {
    id: "Advanced",
    label: t("Avançado"),
    icon: Wrench,
    description: t("Pastas internas do aplicativo e ferramentas técnicas."),
  },
];
const pathLabels: Record<string, string> = {
  database: t("Banco de dados"),
  cache: "Cache",
  logs: t("Registros"),
};
function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="settings-group">
      <h3>{title}</h3>
      <div className="settings-group-body">{children}</div>
    </section>
  );
}
function Switch({
  label,
  on,
  disabled,
  onToggle,
}: {
  label: string;
  on: boolean;
  disabled?: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      role="switch"
      aria-label={label}
      aria-checked={on}
      disabled={disabled}
      className={`switch ${on ? "on" : ""}`}
      onClick={onToggle}
    >
      <span />
    </button>
  );
}
export function SettingsPage({ notify }: { notify: (s: string) => void }) {
  const [section, setSection] = useState<Section>("General");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const writes = useRef(Promise.resolve());
  const version = useRef(0);
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
  const current = sections.find((s) => s.id === section)!;
  return (
    <div className="page-content">
      <PageHeader
        title={t("Configurações")}
        description={t("Personalize como você organiza e joga.")}
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
                ? t("Alteração não salva")
                : t("Salvamento automático")}
          </span>
        }
      />
      {saveError && (
        <p className="error-message" role="alert">
          {t("Não foi possível salvar. As preferências foram recarregadas.")}{" "}
          {saveError}
        </p>
      )}
      <div className="settings-layout">
        <nav
          className="settings-nav"
          aria-label={t("Seções das configurações")}
        >
          {sections.map((s) => (
            <button
              className={s.id === section ? "selected" : ""}
              aria-current={s.id === section ? "page" : undefined}
              key={s.id}
              onClick={() => setSection(s.id)}
            >
              <s.icon size={17} aria-hidden="true" />
              {s.label}
            </button>
          ))}
          <div className="settings-nav-about">
            <BrandMark />
            <div>
              <strong>{t("OpenRetro")}</strong>
              <span>
                {t("Versão")} {appVersion}
              </span>
            </div>
          </div>
        </nav>
        <div className="settings-panel" key={section}>
          <header className="settings-panel-head">
            <span className="settings-panel-icon" aria-hidden="true">
              <current.icon size={22} />
            </span>
            <div>
              <h2>{current.label}</h2>
              <p>{current.description}</p>
            </div>
          </header>
          {section === "General" ? (
            <>
              <Group title={t("Jogando")}>
                <div className="setting-row">
                  <div>
                    <strong>{t("Continuar de onde parou")}</strong>
                    <p>
                      {t(
                        "No runtime integrado, salva ao encerrar normalmente e retoma ao jogar novamente. Depende do suporte a estados do core.",
                      )}
                    </p>
                  </div>
                  <Switch
                    label={t("Continuar de onde parou")}
                    on={settings.autoResume !== false}
                    disabled={saving}
                    onToggle={() =>
                      void save({ autoResume: settings.autoResume === false })
                    }
                  />
                </div>
                <div className="setting-row">
                  <div>
                    <strong>{t("Coop de sofá")}</strong>
                    <p>
                      {t(
                        "O runtime integrado configura até 4 controles na ordem detectada. Conecte-os antes de jogar. A quantidade de jogadores depende do jogo; multitap não é ativado automaticamente.",
                      )}
                    </p>
                  </div>
                </div>
                <div className="setting-row">
                  <div>
                    <strong>{t("Fluidez no celular")}</strong>
                    <p>
                      {t(
                        "Quadros por segundo do vídeo enviado ao celular. 60 deixa o movimento mais suave, mas pesa mais no PC e no Wi-Fi.",
                      )}
                    </p>
                  </div>
                  <select
                    aria-label={t("Fluidez no celular")}
                    value={String(settings.phoneFrameRate ?? 30)}
                    onChange={(e) =>
                      void save({
                        phoneFrameRate: Number(
                          e.target.value,
                        ) as AppSettings["phoneFrameRate"],
                      })
                    }
                  >
                    <option value="30">
                      {t("30 quadros/s · recomendado")}
                    </option>
                    <option value="60">{t("60 quadros/s · mais suave")}</option>
                  </select>
                </div>
                <div className="setting-row">
                  <div>
                    <strong>{t("Mostrar o jogo no Discord")}</strong>
                    <p>
                      {t(
                        "Seus amigos no Discord veem o jogo, o console e a capa enquanto você joga. Precisa do Discord aberto neste computador.",
                      )}
                    </p>
                  </div>
                  <Switch
                    label={t("Mostrar o jogo no Discord")}
                    on={settings.discordPresence === true}
                    disabled={saving}
                    onToggle={() =>
                      void save({
                        discordPresence: settings.discordPresence !== true,
                      }).then(() => bridge.discordPresenceSync())
                    }
                  />
                </div>
              </Group>
              <Group title={t("Sistema")}>
                <div className="setting-row">
                  <div>
                    <strong>{t("Idioma da interface")}</strong>
                    <p>
                      {t(
                        "Muda os textos do OpenRetro. O aplicativo reabre a tela ao trocar. Menus dos emuladores externos seguem o idioma deles.",
                      )}
                    </p>
                  </div>
                  <select
                    aria-label={t("Idioma da interface")}
                    value={settings.interfaceLanguage ?? "system"}
                    disabled={saving}
                    onChange={(e) => {
                      const next = e.target
                        .value as AppSettings["interfaceLanguage"];
                      // The window reloads in the new language once saved.
                      void save({ interfaceLanguage: next }).then(() =>
                        adoptLanguage(next),
                      );
                    }}
                  >
                    <option value="system">
                      {t("Automático (idioma do sistema)")}
                    </option>
                    {languages.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="setting-row">
                  <div>
                    <strong>{t("Atualizar automaticamente")}</strong>
                    <p>
                      {t(
                        "Baixa novas versões em segundo plano e instala ao abrir o OpenRetro.",
                      )}
                    </p>
                  </div>
                  <Switch
                    label={t("Atualizar automaticamente")}
                    on={settings.autoUpdate !== false}
                    onToggle={() =>
                      void save({ autoUpdate: settings.autoUpdate === false })
                    }
                  />
                </div>
                <div className="setting-row">
                  <div>
                    <strong>{t("Iniciar com o sistema")}</strong>
                    <p>
                      {t(
                        "A inicialização junto com o sistema ainda não está disponível.",
                      )}
                    </p>
                  </div>
                  <span className="badge">{t("Em breve")}</span>
                </div>
              </Group>
            </>
          ) : section === "Games" ? (
            <>
              <Group title={t("Imagem")}>
                <div className="setting-row">
                  <div>
                    <strong>{t("Formato da tela dos jogos")}</strong>
                    <p>
                      {t(
                        "Mantenha a proporção original ou estique a imagem para preencher toda a tela, mesmo que ela fique mais larga. Vale para PS2 e jogos retrô no runtime integrado, a partir do próximo jogo aberto.",
                      )}
                    </p>
                  </div>
                  <select
                    aria-label={t("Formato da tela dos jogos")}
                    value={settings.gameScreenMode ?? "stretch"}
                    onChange={(e) =>
                      void save({
                        gameScreenMode: e.target
                          .value as AppSettings["gameScreenMode"],
                      })
                    }
                  >
                    <option value="original">{t("Proporção original")}</option>
                    <option value="stretch">
                      {t("Esticar para preencher")}
                    </option>
                  </select>
                </div>
                <div className="setting-row">
                  <div>
                    <strong>{t("Resolução do PlayStation 2")}</strong>
                    <p>
                      {t(
                        "Desenha os jogos de PS2 em uma resolução maior que a do console, deixando a imagem mais nítida. Valores altos exigem mais da placa de vídeo. Vale a partir do próximo jogo aberto.",
                      )}
                    </p>
                  </div>
                  <select
                    aria-label={t("Resolução do PlayStation 2")}
                    value={settings.ps2Resolution ?? "2x"}
                    onChange={(e) =>
                      void save({
                        ps2Resolution: e.target
                          .value as AppSettings["ps2Resolution"],
                      })
                    }
                  >
                    <option value="1x">{t("Nativa (640×448)")}</option>
                    <option value="2x">
                      {t("2x · recomendado (~1280×896)")}
                    </option>
                    <option value="4x">
                      {t("4x · mais nítido (~2560×1792)")}
                    </option>
                    <option value="8x">{t("8x · muito pesado")}</option>
                  </select>
                </div>
              </Group>
              <Group title={t("Atualizações")}>
                <div className="setting-row">
                  <div>
                    <strong>{t("Atualizar jogos de PlayStation 3")}</strong>
                    <p>
                      {t(
                        "Antes de abrir um jogo de PS3, baixa e instala a última atualização oficial dele. Muitos jogos rodam melhor atualizados.",
                      )}
                    </p>
                  </div>
                  <Switch
                    label={t("Atualizar jogos de PlayStation 3")}
                    on={settings.ps3Updates !== false}
                    onToggle={() =>
                      void save({ ps3Updates: settings.ps3Updates === false })
                    }
                  />
                </div>
              </Group>
            </>
          ) : section === "Achievements" ? (
            <>
              <Group title={t("RetroAchievements")}>
                <AchievementsAccount notify={notify} />
              </Group>
              <Group title={t("Como jogar")}>
                <div className="setting-row">
                  <div>
                    <strong>{t("Modo hardcore")}</strong>
                    <p>
                      {t(
                        "Conquistas contam no ranking principal do RetroAchievements, mas não dá para carregar estados salvos nem continuar de onde parou. Salvar estados continua funcionando. Partidas online jogam sempre em softcore.",
                      )}
                    </p>
                  </div>
                  <Switch
                    label={t("Modo hardcore")}
                    on={settings.achievementsHardcore === true}
                    disabled={saving}
                    onToggle={() =>
                      void save({
                        achievementsHardcore:
                          settings.achievementsHardcore !== true,
                      })
                    }
                  />
                </div>
                <div className="setting-row">
                  <div>
                    <strong>{t("Onde aparecem")}</strong>
                    <p>
                      {t(
                        "Durante o jogo, cada conquista aparece num aviso na tela. Depois, a página do jogo mostra todas, com o seu progresso. Jogos de PS3 não têm conquistas.",
                      )}
                    </p>
                  </div>
                </div>
              </Group>
            </>
          ) : section === "Downloads" ? (
            <>
              <Group title={t("Destino")}>
                <div className="setting-row setting-row-stack">
                  <div>
                    <strong>{t("Pasta de downloads")}</strong>
                    <p>{t("Os jogos baixados são salvos e extraídos aqui.")}</p>
                  </div>
                  <div className="settings-path-field">
                    <input
                      aria-label={t("Pasta de downloads")}
                      value={settings.downloadDirectory}
                      placeholder={t("Pasta de dados do OpenRetro")}
                      readOnly
                    />
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
                      <Folder size={16} /> {t("Escolher pasta")}
                    </button>
                  </div>
                </div>
              </Group>
              <Group title={t("Depois do download")}>
                <div className="setting-row">
                  <div>
                    <strong>
                      {t("Apagar o arquivo compactado após instalar")}
                    </strong>
                    <p>
                      {t(
                        "Depois de extrair o jogo, remove o .zip baixado e libera o espaço que ele ocupa.",
                      )}
                    </p>
                  </div>
                  <Switch
                    label={t("Apagar o arquivo compactado após instalar")}
                    on={settings.deleteArchives !== false}
                    onToggle={() =>
                      void save({
                        deleteArchives: settings.deleteArchives === false,
                      })
                    }
                  />
                </div>
                <div className="setting-row">
                  <div>
                    <strong>{t("Downloads simultâneos")}</strong>
                    <p>
                      {t(
                        "Os downloads são independentes. O limite da fila ainda não está disponível.",
                      )}
                    </p>
                  </div>
                  <input
                    disabled
                    type="number"
                    aria-label={t("Downloads simultâneos")}
                    value={settings.concurrentDownloads}
                    readOnly
                  />
                </div>
                <div className="setting-row">
                  <div>
                    <strong>{t("Limite de velocidade")}</strong>
                    <p>
                      {t("O controle de velocidade ainda não está disponível.")}
                    </p>
                  </div>
                  <input
                    disabled
                    type="number"
                    aria-label={t("Limite de velocidade")}
                    value={settings.bandwidthLimit}
                    readOnly
                  />
                </div>
              </Group>
            </>
          ) : section === "Appearance" ? (
            <>
              <Group title={t("Visual")}>
                <div className="setting-row">
                  <div>
                    <strong>{t("Tema")}</strong>
                    <p>{t("Escolha a aparência da interface.")}</p>
                  </div>
                  <select
                    aria-label={t("Tema")}
                    value={settings.theme}
                    onChange={(e) =>
                      void save({
                        theme: e.target.value as AppSettings["theme"],
                      })
                    }
                  >
                    <option value="dark">{t("Escuro")}</option>
                    <option value="light">{t("Claro")}</option>
                  </select>
                </div>
                <div className="setting-row">
                  <div>
                    <strong>{t("Densidade da biblioteca")}</strong>
                    <p>
                      {t("Ajuste o tamanho dos jogos exibidos na biblioteca.")}
                    </p>
                  </div>
                  <select
                    aria-label={t("Densidade da biblioteca")}
                    value={settings.density}
                    onChange={(e) =>
                      void save({
                        density: e.target.value as AppSettings["density"],
                      })
                    }
                  >
                    <option value="comfortable">{t("Confortável")}</option>
                    <option value="compact">{t("Compacta")}</option>
                  </select>
                </div>
              </Group>
              <Group title={t("Movimento e som")}>
                <div className="setting-row">
                  <div>
                    <strong>{t("Animações da interface")}</strong>
                    <p>{t("Transições curtas ao navegar e abrir menus.")}</p>
                  </div>
                  <Switch
                    label={t("Animações da interface")}
                    on={settings.animations}
                    onToggle={() =>
                      void save({ animations: !settings.animations })
                    }
                  />
                </div>
                <div className="setting-row">
                  <div>
                    <strong>{t("Sons de navegação")}</strong>
                    <p>
                      {t("Sons curtos ao mover e escolher no modo console.")}
                    </p>
                  </div>
                  <Switch
                    label={t("Sons de navegação")}
                    on={settings.navigationSounds !== false}
                    onToggle={() =>
                      void save({
                        navigationSounds: settings.navigationSounds === false,
                      })
                    }
                  />
                </div>
              </Group>
            </>
          ) : (
            <>
              <Group title={t("Pastas do aplicativo")}>
                <p className="settings-group-note">
                  {t(
                    "Seus dados ficam no seu computador. Os arquivos de jogos importados nunca são copiados nem alterados.",
                  )}
                </p>
                {Object.entries(paths ?? {}).map(([key, value]) => (
                  <div className="setting-row" key={key}>
                    <div>
                      <strong>{pathLabels[key] ?? key}</strong>
                      <code className="path-text">{value}</code>
                    </div>
                  </div>
                ))}
              </Group>
              <Group title={t("Desenvolvimento")}>
                <div className="setting-row">
                  <div>
                    <strong>{t("Modo de desenvolvedor")}</strong>
                    <p>{t("Mostre informações técnicas na barra lateral.")}</p>
                  </div>
                  <Switch
                    label={t("Modo de desenvolvedor")}
                    on={settings.developerMode}
                    onToggle={() =>
                      void save({ developerMode: !settings.developerMode })
                    }
                  />
                </div>
              </Group>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
