import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ImagePlus, Trash2 } from "lucide-react";
import { bridge, isDesktop, isRemote } from "../../services/bridge";
import { defaultSettings, type AppSettings } from "../../types";
import { t } from "../../i18n";
import {
  consoleThemes,
  DEFAULT_CONSOLE_THEME,
  isConsoleTheme,
  ThemePreview,
  type ConsoleTheme,
} from "./ParallaxBackdrop";

/** The theme Big Picture shows, falling back to the default scene. */
export function useConsoleTheme() {
  const { data: settings } = useQuery({
    queryKey: ["settings"],
    queryFn: bridge.settings,
  });
  const backgrounds = useConsoleBackgrounds();
  const chosen = settings?.consoleTheme;
  const picture = backgrounds.data?.find(
    (item) => item.path === settings?.consoleBackground,
  )?.url;
  // A removed picture leaves the default scene rather than an empty one.
  const theme: ConsoleTheme =
    isConsoleTheme(chosen) && (chosen !== "custom" || picture)
      ? chosen
      : DEFAULT_CONSOLE_THEME;
  return { theme, picture };
}

function useConsoleBackgrounds() {
  return useQuery({
    queryKey: ["console-backgrounds"],
    queryFn: bridge.consoleBackgrounds,
    staleTime: Infinity,
  });
}

const groups = [
  {
    id: "scene",
    title: t("Cenas"),
    description: t(
      "O fundo do modo console se move com o controle e o mouse. Escolha uma cena, uma foto ou use suas imagens.",
    ),
  },
  {
    id: "photo",
    title: t("Fotos reais"),
    description: t(
      "Fotografias em domínio público da NASA e dos parques nacionais dos Estados Unidos.",
    ),
  },
  {
    id: "game",
    title: t("Arte de jogos"),
    description: t(
      "Cenários em pixel art de jogos independentes, liberados em domínio público (CC0).",
    ),
  },
] as const;

/** Built-in scenes, real photos, game art and the player's own pictures. */
export function ConsoleThemes({ notify }: { notify: (text: string) => void }) {
  const client = useQueryClient();
  const { theme, picture } = useConsoleTheme();
  const backgrounds = useConsoleBackgrounds();
  const [adding, setAdding] = useState(false);
  const save = async (patch: Partial<AppSettings>) => {
    const next = {
      ...defaultSettings,
      ...client.getQueryData<AppSettings>(["settings"]),
      ...patch,
    };
    client.setQueryData(["settings"], next);
    try {
      await bridge.saveSettings(next);
    } catch (error) {
      notify(String(error));
      await client.invalidateQueries({ queryKey: ["settings"] });
    }
  };
  const add = async () => {
    setAdding(true);
    try {
      const added = await bridge.addConsoleBackground();
      if (!added) return;
      await client.invalidateQueries({ queryKey: ["console-backgrounds"] });
      await save({ consoleTheme: "custom", consoleBackground: added.path });
      notify(t("Imagem adicionada como fundo."));
    } catch (error) {
      notify(String(error));
    } finally {
      setAdding(false);
    }
  };
  const remove = async (path: string) => {
    try {
      await bridge.removeConsoleBackground(path);
      await client.invalidateQueries({ queryKey: ["console-backgrounds"] });
      notify(t("Imagem removida."));
    } catch (error) {
      notify(String(error));
    }
  };
  const canAdd = isDesktop && !isRemote;
  return (
    <div className="console-themes">
      {groups.map((group) => (
        <section key={group.id}>
          <h3>{group.title}</h3>
          <p>{group.description}</p>
          <div className="console-theme-grid">
            {consoleThemes
              .filter((item) => item.group === group.id)
              .map((item) => (
                <button
                  key={item.id}
                  className="console-theme-card"
                  aria-pressed={theme === item.id}
                  onClick={() => void save({ consoleTheme: item.id })}
                >
                  <ThemePreview theme={item.id} />
                  <strong>
                    {item.name}
                    {theme === item.id && <Check size={16} />}
                  </strong>
                  <small>{item.description}</small>
                  {item.credit && (
                    <small className="console-theme-credit">
                      {item.credit}
                    </small>
                  )}
                </button>
              ))}
          </div>
        </section>
      ))}
      <section>
        <h3>{t("Minhas imagens")}</h3>
        <p>
          {t(
            "Fotos e artes suas viram fundo com o mesmo movimento. O OpenRetro guarda uma cópia de cada uma.",
          )}
        </p>
        <div className="console-theme-grid">
          {backgrounds.data?.map((item) => {
            const active = theme === "custom" && picture === item.url;
            return (
              <div key={item.path} className="console-theme-picture">
                <button
                  className="console-theme-card"
                  aria-pressed={active}
                  aria-label={t("Usar esta imagem como fundo")}
                  onClick={() =>
                    void save({
                      consoleTheme: "custom",
                      consoleBackground: item.path,
                    })
                  }
                >
                  <ThemePreview theme="custom" picture={item.url} />
                  <strong>
                    {active ? t("Em uso") : t("Usar como fundo")}
                    {active && <Check size={16} />}
                  </strong>
                </button>
                <button
                  className="console-theme-remove"
                  aria-label={t("Remover imagem")}
                  onClick={() => void remove(item.path)}
                >
                  <Trash2 size={16} /> {t("Remover")}
                </button>
              </div>
            );
          })}
          {canAdd && (
            <button
              className="console-theme-card console-theme-add"
              disabled={adding}
              onClick={() => void add()}
            >
              <ImagePlus size={30} />
              <strong>
                {adding ? t("Adicionando…") : t("Adicionar imagem")}
              </strong>
              <small>{t("PNG, JPG, WEBP ou GIF até 40 MB")}</small>
            </button>
          )}
        </div>
        {!canAdd && (
          <p>{t("Abra o aplicativo desktop para usar suas imagens.")}</p>
        )}
      </section>
    </div>
  );
}
