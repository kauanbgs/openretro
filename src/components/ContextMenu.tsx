import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

export interface ContextMenuItem {
  label: string;
  icon?: ReactNode;
  danger?: boolean;
  onSelect: () => void;
}

/** A small menu at the pointer; any click elsewhere, Escape or scrolling closes it. */
export function ContextMenu({
  x,
  y,
  items,
  onClose,
}: {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: x, top: y });
  // Keep the whole menu on screen near the window's right and bottom edges.
  useLayoutEffect(() => {
    const menu = ref.current?.getBoundingClientRect();
    if (!menu) return;
    setPosition({
      left: Math.max(8, Math.min(x, window.innerWidth - menu.width - 8)),
      top: Math.max(8, Math.min(y, window.innerHeight - menu.height - 8)),
    });
    ref.current?.querySelector("button")?.focus();
  }, [x, y]);
  useEffect(() => {
    const close = (event: Event) => {
      if (!ref.current?.contains(event.target as Node)) onClose();
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("pointerdown", close, true);
    window.addEventListener("scroll", onClose, true);
    window.addEventListener("resize", onClose);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("pointerdown", close, true);
      window.removeEventListener("scroll", onClose, true);
      window.removeEventListener("resize", onClose);
      window.removeEventListener("keydown", key);
    };
  }, [onClose]);
  return (
    <div className="context-menu" role="menu" ref={ref} style={position}>
      {items.map((item) => (
        <button
          key={item.label}
          role="menuitem"
          className={item.danger ? "danger" : undefined}
          onClick={() => {
            onClose();
            item.onSelect();
          }}
        >
          {item.icon}
          {item.label}
        </button>
      ))}
    </div>
  );
}
