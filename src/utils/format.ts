import { locale, t } from "../i18n";
const decimal = new Intl.NumberFormat(locale(), { maximumFractionDigits: 1 });
const integer = new Intl.NumberFormat(locale(), { maximumFractionDigits: 0 });
export function formatBytes(value = 0) {
  const bytes = Number.isFinite(value) ? Math.max(0, value) : 0;
  const index = bytes
    ? Math.min(3, Math.floor(Math.log2(Math.max(1, bytes)) / 10))
    : 0;
  return `${(index ? decimal : integer).format(bytes / 1024 ** index)} ${["B", "KB", "MB", "GB"][index]}`;
}
export function formatRemaining(seconds: number) {
  if (seconds <= 0) return t("Finalizando");
  if (seconds < 60)
    return t("{count} s restantes", { count: Math.ceil(seconds) });
  if (seconds < 3600)
    return t("{count} min restantes", { count: Math.ceil(seconds / 60) });
  const minutes = Math.ceil(seconds / 60);
  return t("{hours} h {minutes} min restantes", {
    hours: Math.floor(minutes / 60),
    minutes: minutes % 60,
  });
}
const relative = new Intl.RelativeTimeFormat(locale(), { numeric: "auto" });
export function formatRelative(date: Date, now = new Date()) {
  const seconds = (date.getTime() - now.getTime()) / 1000;
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ["day", 86400],
    ["hour", 3600],
    ["minute", 60],
  ];
  for (const [unit, size] of units)
    if (Math.abs(seconds) >= size)
      return relative.format(Math.round(seconds / size), unit);
  return t("agora mesmo");
}
/** Time played, short enough for a card: "45min", "3h", "1h 30min". */
export function formatPlaytime(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${Math.max(1, minutes)}min`;
  const hours = `${Math.floor(minutes / 60)}h`;
  return minutes % 60 ? `${hours} ${minutes % 60}min` : hours;
}
