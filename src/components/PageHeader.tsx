import type { ReactNode } from "react";
/** The page title lives in the app header; this row holds the page's own
 * description and actions. */
export function PageHeader({
  description,
  actions,
}: {
  title?: string;
  description?: string;
  actions?: ReactNode;
}) {
  if (!description && !actions) return null;
  return (
    <header className="page-heading">
      {description && <p>{description}</p>}
      {actions && <div className="page-heading-actions">{actions}</div>}
    </header>
  );
}
