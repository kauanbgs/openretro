export function PageLoading({
  label = "Carregando…",
  embedded = false,
}: {
  label?: string;
  embedded?: boolean;
}) {
  return (
    <div
      className={`page-content page-loading ${embedded ? "embedded" : ""}`}
      role="status"
      aria-label={label}
    >
      <p>{label}</p>
      <div aria-hidden="true" className="loading-heading" />
      <div className="loading-grid" aria-hidden="true">
        {Array.from({ length: 6 }, (_, index) => (
          <div key={index}>
            <i />
            <span />
            <small />
          </div>
        ))}
      </div>
    </div>
  );
}
