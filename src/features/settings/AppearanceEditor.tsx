import { useState, useSyncExternalStore, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ImagePlus, Trash2 } from "lucide-react";
import { bridge, isDesktop, isRemote } from "../../services/bridge";
import {
  appearanceStore,
  colorKeys,
  fonts,
  presetThemes,
  type Appearance,
  type BackgroundKind,
  type ColorKey,
  type FontChoice,
  type SavedTheme,
} from "../../services/appearance";
import { t } from "../../i18n";
import "./AppearanceEditor.css";

const colorLabels: Record<ColorKey, string> = {
  bg: t("Fundo"),
  panel: t("Painéis"),
  text: t("Texto"),
  accent: t("Destaque"),
};
const isVideo = (path: string) => /\.(mp4|webm)$/i.test(path);

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="settings-group">
      <h3>{title}</h3>
      <div className="settings-group-body">{children}</div>
    </section>
  );
}
function Row({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="setting-row">
      <div>
        <strong>{title}</strong>
        {hint && <p>{hint}</p>}
      </div>
      {children}
    </div>
  );
}
function Slider({
  label,
  value,
  min,
  max,
  step,
  format,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (value: number) => string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="appearance-slider">
      <input
        type="range"
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <output>{format(value)}</output>
    </label>
  );
}

/** The colors a look would show, for a theme's little preview. */
function Swatch({ theme }: { theme: SavedTheme }) {
  const { colors, background, radius } = theme.appearance;
  const bg = colors.bg ?? "#121212";
  return (
    <span
      className="appearance-swatch"
      style={{
        background:
          background.kind === "gradient"
            ? `linear-gradient(${background.gradient.angle}deg, ${background.gradient.from}, ${background.gradient.to})`
            : bg,
        borderRadius: 10 * radius,
      }}
    >
      <i
        style={{
          background: colors.panel ?? "#0c0c0c",
          borderRadius: 4 * radius,
        }}
      />
      <b
        style={{
          background: colors.accent ?? "#c0c1c7",
          borderRadius: 3 * radius,
        }}
      />
    </span>
  );
}

export function AppearanceEditor({ notify }: { notify: (text: string) => void }) {
  const look = useSyncExternalStore(
    appearanceStore.subscribe,
    appearanceStore.snapshot,
  );
  const saved = useSyncExternalStore(
    appearanceStore.subscribe,
    appearanceStore.themes,
  );
  const client = useQueryClient();
  const media = useQuery({
    queryKey: ["appearance-media"],
    queryFn: bridge.appearanceMedia,
    staleTime: Infinity,
  });
  const [name, setName] = useState("");
  const [adding, setAdding] = useState(false);
  const canAdd = isDesktop && !isRemote;
  const set = (patch: Partial<Appearance>) => appearanceStore.update(patch);
  const setBackground = (patch: Partial<Appearance["background"]>) =>
    set({ background: { ...look.background, ...patch } });
  const shown = (key: ColorKey) => {
    if (look.colors[key]) return look.colors[key]!;
    const value = getComputedStyle(document.documentElement)
      .getPropertyValue(key === "panel" ? "--panel" : `--${key}`)
      .trim();
    return /^#[0-9a-f]{6}$/i.test(value) ? value : "#808080";
  };
  const add = async () => {
    setAdding(true);
    try {
      const added = await bridge.addAppearanceMedia();
      if (!added) return;
      await client.invalidateQueries({ queryKey: ["appearance-media"] });
      setBackground({ kind: "media", media: added.path });
    } catch (error) {
      notify(String(error));
    } finally {
      setAdding(false);
    }
  };
  const remove = async (path: string) => {
    try {
      await bridge.removeAppearanceMedia(path);
      await client.invalidateQueries({ queryKey: ["appearance-media"] });
      if (look.background.media === path)
        setBackground({ media: null, kind: "none" });
    } catch (error) {
      notify(String(error));
    }
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(appearanceStore.exportText());
      notify(t("Tema copiado. Cole em um arquivo ou envie a um amigo."));
    } catch {
      notify(t("Não foi possível copiar."));
    }
  };
  const paste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      notify(
        appearanceStore.importText(text)
          ? t("Tema aplicado. Fundos em arquivo e CSS próprio vêm desligados.")
          : t("O texto copiado não é um tema do OpenRetro."),
      );
    } catch {
      notify(t("Não foi possível ler a área de transferência."));
    }
  };
  return (
    <>
      <Group title={t("Temas")}>
        <div className="appearance-themes">
          {presetThemes.map((theme) => (
            <button
              key={theme.name}
              className="appearance-theme"
              onClick={() => appearanceStore.set(theme.appearance)}
            >
              <Swatch theme={theme} />
              <span>{theme.name}</span>
            </button>
          ))}
          {saved.map((theme) => (
            <span className="appearance-theme appearance-theme-saved" key={theme.name}>
              <button onClick={() => appearanceStore.set(theme.appearance)}>
                <Swatch theme={theme} />
                <span>{theme.name}</span>
              </button>
              <button
                className="appearance-theme-delete"
                aria-label={t("Excluir tema {name}", { name: theme.name })}
                onClick={() => appearanceStore.deleteTheme(theme.name)}
              >
                <Trash2 size={13} />
              </button>
            </span>
          ))}
        </div>
        <Row
          title={t("Salvar este visual")}
          hint={t("Guarde as escolhas atuais com um nome para voltar depois.")}
        >
          <form
            className="appearance-inline"
            onSubmit={(e) => {
              e.preventDefault();
              appearanceStore.saveTheme(name);
              setName("");
            }}
          >
            <input
              aria-label={t("Nome do tema")}
              placeholder={t("Nome do tema")}
              maxLength={40}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <button className="button outline" disabled={!name.trim()}>
              {t("Salvar")}
            </button>
          </form>
        </Row>
        <Row
          title={t("Compartilhar")}
          hint={t("Copie seu visual como texto ou cole o de outra pessoa.")}
        >
          <div className="appearance-inline">
            <button className="button outline" onClick={() => void copy()}>
              {t("Copiar tema")}
            </button>
            <button className="button outline" onClick={() => void paste()}>
              {t("Colar tema")}
            </button>
          </div>
        </Row>
      </Group>

      <Group title={t("Cores")}>
        {colorKeys.map((key) => (
          <Row key={key} title={colorLabels[key]}>
            <label className="appearance-color">
              <input
                type="color"
                aria-label={colorLabels[key]}
                value={shown(key)}
                onChange={(e) =>
                  set({ colors: { ...look.colors, [key]: e.target.value } })
                }
              />
              <code>{shown(key)}</code>
            </label>
          </Row>
        ))}
        <Row
          title={t("Voltar às cores do tema")}
          hint={t("O modo escuro ou claro, em Visual, define as cores de partida.")}
        >
          <button
            className="button outline"
            disabled={!Object.keys(look.colors).length}
            onClick={() => set({ colors: {} })}
          >
            {t("Restaurar cores")}
          </button>
        </Row>
      </Group>

      <Group title={t("Formas e texto")}>
        <Row
          title={t("Cantos")}
          hint={t("De totalmente retos a bem arredondados.")}
        >
          <Slider
            label={t("Cantos")}
            value={look.radius}
            min={0}
            max={2}
            step={0.05}
            format={(v) => (v === 0 ? t("Retos") : `${Math.round(v * 100)}%`)}
            onChange={(radius) => set({ radius })}
          />
        </Row>
        <Row title={t("Tipo de letra")}>
          <select
            aria-label={t("Tipo de letra")}
            value={look.font}
            onChange={(e) => set({ font: e.target.value as FontChoice })}
          >
            {(Object.keys(fonts) as FontChoice[]).map((key) => (
              <option key={key} value={key}>
                {fonts[key].label}
              </option>
            ))}
          </select>
        </Row>
      </Group>

      <Group title={t("Plano de fundo")}>
        <Row
          title={t("Tipo de fundo")}
          hint={t("Uma cor, um degradê, uma imagem ou um vídeo atrás de tudo.")}
        >
          <select
            aria-label={t("Tipo de fundo")}
            value={look.background.kind}
            onChange={(e) =>
              setBackground({ kind: e.target.value as BackgroundKind })
            }
          >
            <option value="none">{t("Só a cor")}</option>
            <option value="gradient">{t("Degradê")}</option>
            <option value="media" disabled={!canAdd}>
              {t("Imagem ou vídeo")}
            </option>
          </select>
        </Row>
        {look.background.kind === "gradient" && (
          <>
            <Row title={t("Cores do degradê")}>
              <div className="appearance-inline">
                <input
                  type="color"
                  aria-label={t("Cor inicial")}
                  value={look.background.gradient.from}
                  onChange={(e) =>
                    setBackground({
                      gradient: {
                        ...look.background.gradient,
                        from: e.target.value,
                      },
                    })
                  }
                />
                <input
                  type="color"
                  aria-label={t("Cor final")}
                  value={look.background.gradient.to}
                  onChange={(e) =>
                    setBackground({
                      gradient: {
                        ...look.background.gradient,
                        to: e.target.value,
                      },
                    })
                  }
                />
              </div>
            </Row>
            <Row title={t("Ângulo")}>
              <Slider
                label={t("Ângulo")}
                value={look.background.gradient.angle}
                min={0}
                max={360}
                step={5}
                format={(v) => `${v}°`}
                onChange={(angle) =>
                  setBackground({
                    gradient: { ...look.background.gradient, angle },
                  })
                }
              />
            </Row>
          </>
        )}
        {look.background.kind === "media" && (
          <div className="appearance-media">
            {media.data?.map((item) => (
              <div
                key={item.path}
                className="appearance-media-item"
                data-selected={look.background.media === item.path}
              >
                <button
                  aria-pressed={look.background.media === item.path}
                  aria-label={t("Usar como fundo")}
                  onClick={() => setBackground({ media: item.path })}
                >
                  {isVideo(item.path) ? (
                    <video src={item.url} muted preload="metadata" />
                  ) : (
                    <img src={item.url} alt="" loading="lazy" />
                  )}
                  {isVideo(item.path) && <span>{t("Vídeo")}</span>}
                </button>
                <button
                  className="appearance-media-remove"
                  aria-label={t("Remover arquivo")}
                  onClick={() => void remove(item.path)}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
            <button
              className="appearance-media-add"
              disabled={adding || !canAdd}
              onClick={() => void add()}
            >
              <ImagePlus size={22} />
              <span>{t("Adicionar imagem ou vídeo")}</span>
            </button>
          </div>
        )}
        {look.background.kind !== "none" && (
          <>
            <Row
              title={t("Escurecer")}
              hint={t("Ajuda o texto a continuar legível sobre fundos claros.")}
            >
              <Slider
                label={t("Escurecer")}
                value={look.background.dim}
                min={0}
                max={0.9}
                step={0.05}
                format={(v) => `${Math.round(v * 100)}%`}
                onChange={(dim) => setBackground({ dim })}
              />
            </Row>
            {look.background.kind === "media" && (
              <Row title={t("Desfoque")}>
                <Slider
                  label={t("Desfoque")}
                  value={look.background.blur}
                  min={0}
                  max={40}
                  step={1}
                  format={(v) => `${v} px`}
                  onChange={(blur) => setBackground({ blur })}
                />
              </Row>
            )}
            <Row
              title={t("Transparência dos painéis")}
              hint={t("Quanto do fundo aparece através do menu e dos cartões.")}
            >
              <Slider
                label={t("Transparência dos painéis")}
                value={look.background.glass}
                min={0}
                max={0.9}
                step={0.05}
                format={(v) => `${Math.round(v * 100)}%`}
                onChange={(glass) => setBackground({ glass })}
              />
            </Row>
          </>
        )}
        {look.background.kind === "media" &&
          look.background.media &&
          isVideo(look.background.media) && (
            <p className="settings-group-note">
              {t(
                "O vídeo toca sem som e para sozinho enquanto você joga, com a janela escondida ou se o sistema pedir menos movimento.",
              )}
            </p>
          )}
      </Group>

      <Group title={t("CSS avançado")}>
        <Row
          title={t("Usar meu CSS")}
          hint={t(
            "Para quem quer ir além: suas regras entram depois das do OpenRetro. Variáveis como --bg, --panel, --text e --accent mudam tudo de uma vez.",
          )}
        >
          <label className="appearance-toggle">
            <input
              type="checkbox"
              checked={look.cssEnabled}
              onChange={(e) => set({ cssEnabled: e.target.checked })}
            />
            <span>{look.cssEnabled ? t("Ligado") : t("Desligado")}</span>
          </label>
        </Row>
        <textarea
          className="appearance-css"
          aria-label={t("Seu CSS")}
          spellCheck={false}
          placeholder={":root {\n  --accent: #ff6b81;\n}\n.game-card {\n  border-radius: 0;\n}"}
          value={look.css}
          maxLength={20000}
          onChange={(e) => set({ css: e.target.value })}
        />
      </Group>

      <Group title={t("Recomeçar")}>
        <Row
          title={t("Voltar ao visual padrão")}
          hint={t("Desfaz cores, cantos, fonte, fundo e CSS. Seus temas salvos ficam.")}
        >
          <button className="button outline" onClick={() => appearanceStore.reset()}>
            {t("Restaurar tudo")}
          </button>
        </Row>
      </Group>
    </>
  );
}
