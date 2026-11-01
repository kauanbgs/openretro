// Local SVG flags also work on Windows, where flag emoji may render as letters.
const svg = (body: string) =>
  `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 30 20">${body}</svg>`)}`;

export const languages = [
  {
    id: "pt-BR",
    name: "Português (Brasil)",
    flag: svg('<path fill="#229e45" d="M0 0h30v20H0z"/><path fill="#f8db38" d="m15 2 12 8-12 8L3 10z"/><circle cx="15" cy="10" r="5" fill="#23428b"/><path d="M10.3 8.5q5-1 9.4 3" fill="none" stroke="white" stroke-width="1"/>'),
  },
  {
    id: "en",
    name: "English",
    flag: svg('<path fill="#fff" d="M0 0h30v20H0z"/><path stroke="#bc243c" stroke-width="2" d="M0 1h30M0 5h30M0 9h30M0 13h30M0 17h30M0 20h30"/><path fill="#304879" d="M0 0h13v11H0z"/><path fill="white" d="M2 2h1v1H2zm4 0h1v1H6zm4 0h1v1h-1zM4 5h1v1H4zm4 0h1v1H8zM2 8h1v1H2zm4 0h1v1H6zm4 0h1v1h-1z"/>'),
  },
  {
    id: "es",
    name: "Español",
    flag: svg('<path fill="#c52c36" d="M0 0h30v20H0z"/><path fill="#f6c944" d="M0 5h30v10H0z"/><path fill="#c52c36" d="M7 8h4v4a2 2 0 0 1-4 0z"/><path fill="#f6c944" d="M8 9h2v3H8z"/>'),
  },
] as const;

export type Language = (typeof languages)[number]["id"];
export function isLanguage(value: unknown): value is Language {
  return languages.some((option) => option.id === value);
}
export function detectLanguage(preferred: string): Language {
  if (/^pt(?:-|$)/i.test(preferred)) return "pt-BR";
  return /^es(?:-|$)/i.test(preferred) ? "es" : "en";
}
