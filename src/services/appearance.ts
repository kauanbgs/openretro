// How the player has dressed the interface: colors, corners, type, a picture or
// video behind everything, and optional CSS of their own. It lives on this
// device (localStorage) and is applied before the first paint so the stock
// look never flashes. Dark or light stays a setting; this layers on top of it.
import { t } from "../i18n";
import glassCss from "../themes/glass.css?raw";

const KEY = "openretro-appearance-v1";
const THEMES_KEY = "openretro-appearance-themes-v1";
const CSS_ID = "openretro-custom-css";
const MAX_CSS = 20000;

export const colorKeys = ["bg", "panel", "text", "accent"] as const;
export type ColorKey = (typeof colorKeys)[number];

export type FontChoice = "default" | "system" | "serif" | "mono";
export type BackgroundKind = "none" | "gradient" | "media";

export interface Appearance {
  /** Only the colors the player changed; the rest follow dark or light. */
  colors: Partial<Record<ColorKey, string>>;
  /** Corner scale: 0 is square, 1 is stock, 2 is very round. */
  radius: number;
  font: FontChoice;
  background: {
    kind: BackgroundKind;
    gradient: { from: string; to: string; angle: number };
    /** A file from the appearance folder, shown as picture or video. */
    media: string | null;
    /** How much the picture is darkened, 0 to 0.9. */
    dim: number;
    /** Blur in pixels. */
    blur: number;
    /** How see-through the panels are over the background, 0 to 0.9. */
    glass: number;
  };
  css: string;
  cssEnabled: boolean;
}

export const defaultAppearance: Appearance = {
  colors: {},
  radius: 1,
  font: "default",
  background: {
    kind: "none",
    gradient: { from: "#1b2433", to: "#2d1b33", angle: 135 },
    media: null,
    dim: 0.45,
    blur: 0,
    glass: 0.35,
  },
  css: "",
  cssEnabled: false,
};

export interface SavedTheme {
  name: string;
  appearance: Appearance;
}

/** Looks that ship with the app. None of them carries a background file. */
export const presetThemes: SavedTheme[] = [
  { name: t("Padrão"), appearance: defaultAppearance },
  {
    name: t("Carvão"),
    appearance: {
      ...defaultAppearance,
      colors: { bg: "#000000", panel: "#0a0a0a", text: "#ededed", accent: "#ededed" },
      radius: 0.5,
    },
  },
  {
    name: t("Cartucho"),
    appearance: {
      ...defaultAppearance,
      colors: { bg: "#17140f", panel: "#201c15", text: "#efe6d2", accent: "#e0a43a" },
      radius: 0.75,
    },
  },
  {
    name: t("Tijolão"),
    appearance: {
      ...defaultAppearance,
      colors: { bg: "#0f380f", panel: "#306230", text: "#cadc9f", accent: "#9bbc0f" },
      radius: 0,
      font: "mono",
    },
  },
  {
    name: t("Cinza clássico"),
    appearance: {
      ...defaultAppearance,
      colors: { bg: "#d6d3cc", panel: "#c4c0b8", text: "#26252d", accent: "#5b4b8a" },
      radius: 1.25,
    },
  },
  {
    name: t("Vidro"),
    appearance: {
      ...defaultAppearance,
      colors: { bg: "#0c1020", panel: "#1a2038", text: "#f4f6ff", accent: "#9fc3ff" },
      radius: 1,
      background: {
        ...defaultAppearance.background,
        kind: "gradient",
        gradient: { from: "#3a1c71", to: "#0f6a8c", angle: 140 },
        dim: 0.2,
        glass: 0.55,
      },
      css: glassCss,
      cssEnabled: true,
    },
  },
  {
    name: t("Meia-noite"),
    appearance: {
      ...defaultAppearance,
      colors: { bg: "#0c1020", panel: "#141a30", text: "#e4e8f7", accent: "#7aa2ff" },
      radius: 1.5,
      background: {
        ...defaultAppearance.background,
        kind: "gradient",
        gradient: { from: "#0c1020", to: "#241338", angle: 160 },
        glass: 0.3,
      },
    },
  },
];

export const fonts: Record<FontChoice, { label: string; stack: string }> = {
  default: { label: t("Padrão do OpenRetro"), stack: "" },
  system: {
    label: t("Fonte do sistema"),
    stack: 'system-ui, "Segoe UI", sans-serif',
  },
  serif: {
    label: t("Com serifa"),
    stack: 'Georgia, "Times New Roman", serif',
  },
  mono: {
    label: t("Monoespaçada"),
    stack: 'ui-monospace, "Cascadia Mono", Consolas, monospace',
  },
};

const hex = /^#[0-9a-f]{6}$/i;
const clamp = (value: unknown, min: number, max: number, fallback: number) =>
  typeof value === "number" && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : fallback;

/** Anything stored or imported is checked here; unknown parts fall back. */
export function sanitizeAppearance(input: unknown): Appearance {
  const source = (input && typeof input === "object" ? input : {}) as Record<
    string,
    any
  >;
  const base = defaultAppearance;
  const colors: Appearance["colors"] = {};
  for (const key of colorKeys) {
    const value = source.colors?.[key];
    if (typeof value === "string" && hex.test(value)) colors[key] = value;
  }
  const bg = source.background ?? {};
  const gradient = bg.gradient ?? {};
  const color = (value: unknown, fallback: string) =>
    typeof value === "string" && hex.test(value) ? value : fallback;
  return {
    colors,
    radius: clamp(source.radius, 0, 2, base.radius),
    font: source.font in fonts ? source.font : base.font,
    background: {
      kind: ["none", "gradient", "media"].includes(bg.kind) ? bg.kind : "none",
      gradient: {
        from: color(gradient.from, base.background.gradient.from),
        to: color(gradient.to, base.background.gradient.to),
        angle: clamp(gradient.angle, 0, 360, base.background.gradient.angle),
      },
      media: typeof bg.media === "string" ? bg.media : null,
      dim: clamp(bg.dim, 0, 0.9, base.background.dim),
      blur: clamp(bg.blur, 0, 40, base.background.blur),
      glass: clamp(bg.glass, 0, 0.9, base.background.glass),
    },
    css: typeof source.css === "string" ? source.css.slice(0, MAX_CSS) : "",
    cssEnabled: source.cssEnabled === true,
  };
}

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private mode or a full quota: the look still applies for this session.
  }
}

type Listener = () => void;
let state = sanitizeAppearance(read(KEY, null));
let themes: SavedTheme[] = (() => {
  const saved = read<unknown>(THEMES_KEY, []);
  return Array.isArray(saved)
    ? saved
        .filter((x) => x && typeof x.name === "string")
        .map((x) => ({
          name: String(x.name).slice(0, 40),
          appearance: sanitizeAppearance(x.appearance),
        }))
    : [];
})();
const listeners = new Set<Listener>();
const emit = () => listeners.forEach((listener) => listener());

/** `color-mix` against the player's own colors keeps every shade in step. */
function mix(a: string, share: number, b: string) {
  return `color-mix(in srgb, ${a} ${Math.round(share * 100)}%, ${b})`;
}

/** The CSS variables a look sets on the root; empty values are removed. */
export function appearanceVariables(a: Appearance): Record<string, string> {
  const vars: Record<string, string> = {};
  const { bg, panel, text, accent } = a.colors;
  const media = a.background.kind !== "none";
  const glass = media ? 1 - a.background.glass : 1;
  const surface = (value: string) =>
    glass < 1 ? mix(value, glass, "transparent") : value;
  if (bg) {
    vars["--bg"] = surface(bg);
    vars["--brand-cutout"] = panel ?? bg;
  }
  if (panel) {
    vars["--panel"] = surface(panel);
    vars["--sidebar"] = surface(panel);
    vars["--panel2"] = mix(panel, 0.88, text ?? "var(--text)");
  }
  if (text) {
    const ground = bg ?? "var(--bg)";
    vars["--text"] = text;
    vars["--muted"] = mix(text, 0.82, ground);
    vars["--body"] = mix(text, 0.62, ground);
    vars["--quiet"] = mix(text, 0.45, ground);
    vars["--border"] = mix(text, 0.14, "transparent");
    vars["--border-strong"] = mix(text, 0.26, "transparent");
  }
  if (accent) {
    vars["--accent"] = accent;
    vars["--accentText"] = bg ?? "var(--bg)";
  }
  if (glass < 1 && !bg) vars["--bg"] = "transparent";
  vars["--rs"] = String(a.radius);
  const stack = fonts[a.font].stack;
  if (stack) vars["--font"] = stack;
  return vars;
}

const managed = new Set<string>();
function apply() {
  const root = document.documentElement;
  const vars = appearanceVariables(state);
  for (const name of managed) if (!(name in vars)) root.style.removeProperty(name);
  managed.clear();
  for (const [name, value] of Object.entries(vars)) {
    root.style.setProperty(name, value);
    managed.add(name);
  }
  const stack = vars["--font"];
  root.style.fontFamily = stack ?? "";
  root.dataset.backdrop = state.background.kind === "none" ? "off" : "on";
  let style = document.getElementById(CSS_ID) as HTMLStyleElement | null;
  const css = state.cssEnabled ? state.css.trim() : "";
  if (css) {
    if (!style) {
      style = document.createElement("style");
      style.id = CSS_ID;
      document.head.append(style);
    }
    style.textContent = css;
  } else style?.remove();
}

export const appearanceStore = {
  subscribe(listener: Listener) {
    listeners.add(listener);
    return () => void listeners.delete(listener);
  },
  snapshot: () => state,
  themes: () => themes,
  set(next: Appearance) {
    state = sanitizeAppearance(next);
    write(KEY, state);
    apply();
    emit();
  },
  update(patch: Partial<Appearance>) {
    appearanceStore.set({ ...state, ...patch });
  },
  reset() {
    appearanceStore.set(defaultAppearance);
  },
  saveTheme(name: string) {
    const clean = name.trim().slice(0, 40);
    if (!clean) return;
    themes = [
      ...themes.filter((x) => x.name !== clean),
      { name: clean, appearance: state },
    ];
    write(THEMES_KEY, themes);
    emit();
  },
  deleteTheme(name: string) {
    themes = themes.filter((x) => x.name !== name);
    write(THEMES_KEY, themes);
    emit();
  },
  /** The look as a file the player can keep or share. */
  exportText(): string {
    return JSON.stringify({ openretroTheme: 1, ...state }, null, 2);
  },
  /**
   * Reads a shared look. The media file and the custom CSS never come along
   * switched on: a file from someone else must not restyle the app unseen.
   */
  importText(text: string): boolean {
    try {
      const parsed = JSON.parse(text);
      if (!parsed || parsed.openretroTheme !== 1) return false;
      const next = sanitizeAppearance(parsed);
      next.cssEnabled = false;
      if (next.background.kind === "media") {
        next.background.kind = "none";
      }
      next.background.media = null;
      appearanceStore.set(next);
      return true;
    } catch {
      return false;
    }
  },
};

/** Call once before the first render. */
export function startAppearance() {
  apply();
}
