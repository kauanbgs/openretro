import { t } from "../../i18n";

/** Player 1's keys in the OpenRetro Runtime. Ids are RetroArch's
 * input_player1_* suffixes and keys are RetroArch key names. The defaults
 * mirror KEYBOARD_BINDINGS in src-tauri/src/launcher/runtime_menu.rs, which
 * also checks every choice again before a game starts. */
export const KEY_ACTIONS = [
  { id: "up", group: "dpad", label: t("Cima"), key: "up" },
  { id: "down", group: "dpad", label: t("Baixo"), key: "down" },
  { id: "left", group: "dpad", label: t("Esquerda"), key: "left" },
  { id: "right", group: "dpad", label: t("Direita"), key: "right" },
  { id: "a", group: "face", label: "A", key: "x" },
  { id: "b", group: "face", label: "B", key: "z" },
  { id: "x", group: "face", label: "X", key: "s" },
  { id: "y", group: "face", label: "Y", key: "a" },
  { id: "start", group: "face", label: "Start", key: "enter" },
  { id: "select", group: "face", label: "Select", key: "rshift" },
  { id: "l", group: "shoulder", label: "L", key: "q" },
  { id: "r", group: "shoulder", label: "R", key: "w" },
  { id: "l2", group: "shoulder", label: "L2", key: "e" },
  { id: "r2", group: "shoulder", label: "R2", key: "r" },
  { id: "l3", group: "shoulder", label: "L3", key: "c" },
  { id: "r3", group: "shoulder", label: "R3", key: "v" },
  { id: "l_y_minus", group: "left-stick", label: t("Cima"), key: "i" },
  { id: "l_y_plus", group: "left-stick", label: t("Baixo"), key: "k" },
  { id: "l_x_minus", group: "left-stick", label: t("Esquerda"), key: "j" },
  { id: "l_x_plus", group: "left-stick", label: t("Direita"), key: "l" },
  { id: "r_y_minus", group: "right-stick", label: t("Cima"), key: "t" },
  { id: "r_y_plus", group: "right-stick", label: t("Baixo"), key: "g" },
  { id: "r_x_minus", group: "right-stick", label: t("Esquerda"), key: "f" },
  { id: "r_x_plus", group: "right-stick", label: t("Direita"), key: "h" },
] as const;

export type KeyActionId = (typeof KEY_ACTIONS)[number]["id"];
export type KeyGroup = (typeof KEY_ACTIONS)[number]["group"];
/** Only the keys the player changed; everything else keeps its default. */
export type KeyboardBindings = Partial<Record<KeyActionId, string>>;
export type KeyLayout = Record<KeyActionId, string>;

export const KEY_GROUPS: { id: KeyGroup; label: string }[] = [
  { id: "dpad", label: t("Direcional") },
  { id: "face", label: t("Botões") },
  { id: "shoulder", label: t("Gatilhos") },
  { id: "left-stick", label: t("Analógico esquerdo") },
  { id: "right-stick", label: t("Analógico direito") },
];

export const DEFAULT_LAYOUT = Object.fromEntries(
  KEY_ACTIONS.map((action) => [action.id, action.key]),
) as KeyLayout;

/** KeyboardEvent.code (the physical key, whatever the layout prints on it)
 * to RetroArch's name for it. */
const CODES: Record<string, string> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
  Enter: "enter",
  NumpadEnter: "kp_enter",
  Tab: "tab",
  Space: "space",
  Backspace: "backspace",
  Insert: "insert",
  Delete: "del",
  Home: "home",
  End: "end",
  PageUp: "pageup",
  PageDown: "pagedown",
  ShiftLeft: "shift",
  ShiftRight: "rshift",
  ControlLeft: "ctrl",
  ControlRight: "rctrl",
  AltLeft: "alt",
  AltRight: "ralt",
  CapsLock: "capslock",
  Comma: "comma",
  Period: "period",
  Slash: "slash",
  Semicolon: "semicolon",
  Quote: "quote",
  BracketLeft: "leftbracket",
  BracketRight: "rightbracket",
  Backslash: "backslash",
  IntlBackslash: "oem102",
  Minus: "minus",
  Equal: "equals",
  Backquote: "backquote",
  NumpadAdd: "add",
  NumpadSubtract: "subtract",
  NumpadMultiply: "multiply",
  NumpadDivide: "divide",
  NumpadDecimal: "kp_period",
  Escape: "escape",
  ScrollLock: "scroll_lock",
  Pause: "pause",
  PrintScreen: "print_screen",
};

export function keyFromCode(code: string): string | undefined {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3).toLowerCase();
  if (/^Digit\d$/.test(code)) return `num${code.slice(5)}`;
  if (/^Numpad\d$/.test(code)) return `keypad${code.slice(6)}`;
  if (/^F([1-9]|1[0-2])$/.test(code)) return code.toLowerCase();
  return CODES[code];
}

/** Keys the game never gets: OpenRetro's menu and RetroArch's hotkeys that
 * stay on (states, screenshots, volume, mute, fullscreen helpers). */
export function reservedReason(key: string): string | undefined {
  if (key === "f1") return t("F1 abre o menu do OpenRetro durante o jogo.");
  if (/^f\d+$/.test(key))
    return t("As teclas F ficam com os atalhos do jogo, como salvar estado.");
  if (["escape", "scroll_lock", "backquote", "add", "subtract"].includes(key))
    return t("Essa tecla é um atalho do runtime e não pode ir para o jogo.");
  if (["print_screen", "pause"].includes(key))
    return t("O Windows usa essa tecla e o jogo não a recebe.");
  return undefined;
}

/** T and M are the Party chat and microphone while a Party is open. */
export function partyClash(key: string): boolean {
  return key === "t" || key === "m";
}

const KNOWN_KEYS = new Set([
  ...Object.values(CODES),
  ..."abcdefghijklmnopqrstuvwxyz",
  ...Array.from({ length: 10 }, (_, i) => `num${i}`),
  ...Array.from({ length: 10 }, (_, i) => `keypad${i}`),
]);

/** The keys every action ends up with. A saved layout that names unknown or
 * reserved keys, or one key twice, falls back to the defaults, as the
 * runtime does. */
export function resolveLayout(saved?: KeyboardBindings | null): KeyLayout {
  const layout = { ...DEFAULT_LAYOUT };
  for (const action of KEY_ACTIONS) {
    const key = saved?.[action.id];
    if (typeof key !== "string") continue;
    if (!KNOWN_KEYS.has(key) || reservedReason(key))
      return { ...DEFAULT_LAYOUT };
    layout[action.id] = key;
  }
  const keys = Object.values(layout);
  return new Set(keys).size === keys.length ? layout : { ...DEFAULT_LAYOUT };
}

/** Gives `action` the key, swapping with the action that had it, and returns
 * only what now differs from the defaults. */
export function assignKey(
  saved: KeyboardBindings | undefined,
  action: KeyActionId,
  key: string,
): KeyboardBindings {
  const layout = resolveLayout(saved);
  const holder = KEY_ACTIONS.find(
    (other) => other.id !== action && layout[other.id] === key,
  );
  if (holder) layout[holder.id] = layout[action];
  layout[action] = key;
  const changed: KeyboardBindings = {};
  for (const { id } of KEY_ACTIONS)
    if (layout[id] !== DEFAULT_LAYOUT[id]) changed[id] = layout[id];
  return changed;
}

const LABELS: Record<string, string> = {
  up: "↑",
  down: "↓",
  left: "←",
  right: "→",
  enter: "Enter",
  kp_enter: t("Enter numérico"),
  tab: "Tab",
  space: t("Espaço"),
  backspace: "Backspace",
  insert: "Insert",
  del: "Delete",
  home: "Home",
  end: "End",
  pageup: "Page Up",
  pagedown: "Page Down",
  shift: t("Shift esquerdo"),
  rshift: t("Shift direito"),
  ctrl: t("Ctrl esquerdo"),
  rctrl: t("Ctrl direito"),
  alt: "Alt",
  ralt: "Alt Gr",
  capslock: "Caps Lock",
  comma: ",",
  period: ".",
  slash: "/",
  semicolon: ";",
  quote: "'",
  leftbracket: "[",
  rightbracket: "]",
  backslash: "\\",
  oem102: "\\",
  minus: "-",
  equals: "=",
  multiply: t("* numérico"),
  divide: t("/ numérico"),
  kp_period: t(", numérico"),
};

/** How a key is printed on its button. */
export function keyLabel(key: string): string {
  if (LABELS[key]) return LABELS[key];
  if (/^num\d$/.test(key)) return key.slice(3);
  if (/^keypad\d$/.test(key)) return `${t("Num")} ${key.slice(6)}`;
  return key.toUpperCase();
}
