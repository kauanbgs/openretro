import { useEffect, useRef } from "react";

/** Observe within the console scroller, or the document in desktop mode. */
export function useCatalogPagination(
  enabled: boolean,
  loadMore: () => Promise<unknown>,
) {
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = sentinel.current;
    if (!enabled || !element) return;
    let requested = false;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !requested) {
          requested = true;
          observer.disconnect();
          void loadMore().catch(() => undefined);
        }
      },
      { root: element.closest(".tv-content"), rootMargin: "500px 0px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [enabled, loadMore]);
  return sentinel;
}
