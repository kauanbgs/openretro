import { useEffect, useId, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
const openModals: HTMLElement[] = [];
let previousOverflow = "";
export function Modal({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  }, [onClose]);
  useEffect(() => {
    const prior = document.activeElement as HTMLElement | null;
    const element = ref.current!;
    if (!openModals.length) {
      previousOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
    }
    openModals.push(element);
    ref.current?.focus();
    const handler = (e: KeyboardEvent) => {
      if (openModals[openModals.length - 1] !== element || e.defaultPrevented)
        return;
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        close.current();
      }
      if (e.key === "Tab") {
        const nodes = Array.from(
          element.querySelectorAll<HTMLElement>(
            'button:not(:disabled),input:not(:disabled):not([type="hidden"]),select:not(:disabled),textarea:not(:disabled),a[href],summary,[tabindex="0"]',
          ),
        ).filter(
          (node) =>
            node.getClientRects().length &&
            !node.closest('[hidden], [inert], [aria-hidden="true"]'),
        );
        if (!nodes?.length) return;
        const first = nodes[0],
          last = nodes[nodes.length - 1];
        if (
          e.shiftKey &&
          (document.activeElement === first ||
            !element.contains(document.activeElement) ||
            document.activeElement === ref.current)
        ) {
          e.preventDefault();
          last.focus();
        } else if (
          !e.shiftKey &&
          (document.activeElement === last ||
            !element.contains(document.activeElement))
        ) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", handler);
    return () => {
      document.removeEventListener("keydown", handler);
      const index = openModals.indexOf(element);
      if (index >= 0) openModals.splice(index, 1);
      if (!openModals.length) document.body.style.overflow = previousOverflow;
      const top = openModals[openModals.length - 1];
      if (prior?.isConnected && (!top || top.contains(prior)))
        prior.focus({ preventScroll: true });
    };
  }, []);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        aria-labelledby={titleId}
        className={`modal ${wide ? "modal-wide" : ""}`}
      >
        <header>
          <div>
            <h2 id={titleId}>{title}</h2>
          </div>
          <button
            className="icon-button"
            aria-label="Fechar janela"
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}
