export function BrandMark({ className = "" }: { className?: string }) {
  return (
    <svg
      className={`brand-mark ${className}`}
      viewBox="0 0 40 40"
      fill="none"
      aria-hidden="true"
    >
      <rect x="2" y="2" width="36" height="36" rx="11" fill="currentColor" />
      <circle
        cx="20"
        cy="20"
        r="10"
        stroke="var(--brand-cutout)"
        strokeWidth="3"
      />
      <circle cx="20" cy="20" r="2.7" fill="var(--brand-cutout)" />
      <path d="M28 12L34 6" stroke="var(--brand-cutout)" strokeWidth="3" />
    </svg>
  );
}
