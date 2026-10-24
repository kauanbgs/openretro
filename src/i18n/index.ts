import { en } from "./en";
import { pt } from "./pt";

/** The interface languages. Source text is mostly Portuguese; `en` translates
 * it to English and `pt` translates the few English source strings back. */
export type Language = "pt-BR" | "en";
export const languages: { id: Language; name: string }[] = [
  { id: "pt-BR", name: "Português (Brasil)" },
  { id: "en", name: "English" },
];

const STORAGE_KEY = "openretro-language";

function isLanguage(value: unknown): value is Language {
  return value === "pt-BR" || value === "en";
}

/** Windows (or the phone) in Portuguese gets Portuguese; anything else English.
 * Outside a browser (tests) the source language stays. */
export function systemLanguage(): Language {
  if (typeof document === "undefined") return "pt-BR";
  const preferred = navigator.languages?.[0] || navigator.language || "en";
  return /^pt(?:-|$)/i.test(preferred) ? "pt-BR" : "en";
}

function cached(): Language | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return isLanguage(value) ? value : null;
  } catch {
    return null;
  }
}

/** Decided before any screen renders, so module-level labels translate too. */
export let language: Language =
  typeof document === "undefined" ? "pt-BR" : (cached() ?? systemLanguage());
if (typeof document !== "undefined") document.documentElement.lang = language;

/** BCP 47 tag for dates and numbers. */
export function locale(): string {
  return language === "en" ? "en-US" : "pt-BR";
}

type Patterns = { regex: RegExp; names: string[]; target: string }[];
const patterns = new Map<Record<string, string>, Patterns>();

/** Entries with {placeholders} also translate messages built elsewhere, such
 * as errors from the desktop side that carry a path or a reason. */
function patternsOf(table: Record<string, string>): Patterns {
  let list = patterns.get(table);
  if (!list) {
    list = Object.entries(table)
      .filter(([source]) => /\{\w+\}/.test(source))
      .map(([source, target]) => {
        const names: string[] = [];
        const body = source
          .split(/(\{\w+\})/)
          .map((part) => {
            const name = /^\{(\w+)\}$/.exec(part)?.[1];
            if (!name) return part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            names.push(name);
            return "([\\s\\S]*?)";
          })
          .join("");
        return { regex: new RegExp(`^${body}$`), names, target };
      });
    patterns.set(table, list);
  }
  return list;
}

function fill(text: string, values: Record<string, string | number>) {
  return text.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in values ? String(values[name]) : match,
  );
}

/** Translates `text` into the interface language. `{name}` placeholders are
 * filled from `values`. */
export function t(
  text: string,
  values?: Record<string, string | number>,
): string {
  const table = language === "en" ? en : pt;
  const found = table[text];
  if (found !== undefined) return values ? fill(found, values) : found;
  if (values) return fill(text, values);
  for (const { regex, names, target } of patternsOf(table)) {
    const match = regex.exec(text);
    // Captured parts can be phrases of their own, like "o emulador" in
    // "Preparando o PS3: baixando {label} ({percent}%)".
    if (match)
      return fill(
        target,
        Object.fromEntries(names.map((name, i) => [name, t(match[i + 1])])),
      );
  }
  return text;
}

/** Adopts the language saved in the settings. Returns true when the window
 * reloads to show it, so the caller should not render. */
export function adoptLanguage(saved: unknown): boolean {
  const next = isLanguage(saved) ? saved : systemLanguage();
  try {
    // Cache only explicit choices. Automatic mode must detect the user's
    // current language again on the next launch.
    if (isLanguage(saved)) localStorage.setItem(STORAGE_KEY, saved);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    return false;
  }
  if (next === language) return false;
  location.reload();
  return true;
}
