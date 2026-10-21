const decimal = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });
const integer = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });
export function formatBytes(value = 0) {
  const bytes = Number.isFinite(value) ? Math.max(0, value) : 0;
  const index = bytes
    ? Math.min(3, Math.floor(Math.log2(Math.max(1, bytes)) / 10))
    : 0;
  return `${(index ? decimal : integer).format(bytes / 1024 ** index)} ${["B", "KB", "MB", "GB"][index]}`;
}
export function formatRemaining(seconds: number) {
  if (seconds <= 0) return "Finalizando";
  if (seconds < 60) return `${Math.ceil(seconds)} s restantes`;
  if (seconds < 3600) return `${Math.ceil(seconds / 60)} min restantes`;
  const minutes = Math.ceil(seconds / 60);
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min restantes`;
}
const relative = new Intl.RelativeTimeFormat("pt-BR", { numeric: "auto" });
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
  return "agora mesmo";
}
