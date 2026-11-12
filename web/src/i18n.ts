import {
  detectLanguage,
  isLanguage,
  type Language,
} from "../../shared/languages";
import { pt, es } from "./translations";
export { languages } from "../../shared/languages";

const STORAGE_KEY = "openretro-web-language";
function saved(): Language | "system" {
  const query = new URLSearchParams(location.search).get("lang");
  if (isLanguage(query) || query === "system") return query;
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return isLanguage(value) ? value : "system";
  } catch {
    return "system";
  }
}
export const preference = saved();
export const language: Language =
  preference === "system"
    ? detectLanguage(navigator.languages?.[0] || navigator.language || "en")
    : preference;

export function t(text: string, values?: Record<string, string>): string {
  const translated =
    (language === "es"
      ? es[text]
      : language === "pt-BR"
        ? pt[text]
        : undefined) ?? text;
  return values
    ? translated.replace(
        /\{(\w+)\}/g,
        (match, name: string) => values[name] ?? match,
      )
    : translated;
}

export function setLanguage(next: Language | "system") {
  try {
    if (next === "system") localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // Keep the choice in the URL when browser storage is unavailable.
  }
  const url = new URL(location.href);
  url.searchParams.set("lang", next);
  location.assign(url.href);
}

document.documentElement.lang = language;
document.title = t("OpenRetro: free retro game launcher for Windows");
document
  .querySelector('meta[name="description"]')
  ?.setAttribute(
    "content",
    t(
      "OpenRetro is a free, open-source launcher for retro games on Windows. One library from NES to PlayStation 3, emulators set up for you, and online Parties your friends join from the browser.",
    ),
  );
