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
