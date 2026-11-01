import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { t } from "../i18n";
import "./Shelf.css";

/**
 * A horizontal row of cards that pages with arrows instead of asking the
 * player to drag a scrollbar. The arrows only show while there is more to see
 * in that direction.
 */
export function Shelf({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  const track = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ start: true, end: true });
  const measure = useCallback(() => {
    const el = track.current;
    if (!el) return;
    setEdges({
      start: el.scrollLeft < 4,
      end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 4,
    });
  }, []);
  useEffect(() => {
    const el = track.current;
    if (!el) return;
    measure();
    const observer =
      typeof ResizeObserver === "undefined"
        ? undefined
        : new ResizeObserver(measure);
    observer?.observe(el);
    return () => observer?.disconnect();
  }, [measure, children]);
  const page = (direction: -1 | 1) => {
    const el = track.current;
    if (!el) return;
    el.scrollBy({
      left: direction * Math.max(240, el.clientWidth * 0.85),
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth",
    });
  };
  return (
    <div
      className={`shelf ${className}`}
      data-start={edges.start}
      data-end={edges.end}
    >
      <button
        type="button"
        className="shelf-arrow shelf-arrow-prev"
        aria-label={t("Anterior")}
        tabIndex={edges.start ? -1 : 0}
        onClick={() => page(-1)}
      >
        <ChevronLeft size={22} />
      </button>
      <div className="shelf-scroller" ref={track} onScroll={measure}>
        {children}
      </div>
      <button
        type="button"
        className="shelf-arrow shelf-arrow-next"
        aria-label={t("Próximo")}
        tabIndex={edges.end ? -1 : 0}
        onClick={() => page(1)}
      >
        <ChevronRight size={22} />
      </button>
    </div>
  );
}
