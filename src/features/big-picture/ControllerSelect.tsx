import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";

type Input = ((key: string) => boolean) | null;
export interface SelectOption {
  value: string;
  label: string;
}

/** Focus navigates between controls; only confirm opens/commits a selection. */
export function ControllerSelect({
  input,
  label,
  value,
  options,
  onChange,
  disabled = false,
}: {
  input: RefObject<Input>;
  label: string;
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const id = useId();
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [position, setPosition] = useState({
    left: 0,
    top: 0,
    width: 240,
    height: 280,
  });
  const current = options.find((option) => option.value === value);
  function close() {
    setOpen(false);
    trigger.current?.focus({ preventScroll: true });
  }
  function commit(index: number) {
    const option = options[index];
    if (option) onChange(option.value);
    close();
  }
  function show() {
    if (disabled || !options.length) return;
    setHighlight(
      Math.max(
        0,
        options.findIndex((option) => option.value === value),
      ),
    );
    const rect = trigger.current!.getBoundingClientRect();
    const height = Math.min(
      280,
      options.length * 42 + 14,
      window.innerHeight - 154,
    );
    const width = Math.min(Math.max(rect.width, 240), window.innerWidth - 32);
    const below = window.innerHeight - 60 - rect.bottom;
    setPosition({
      left: Math.max(16, Math.min(rect.left, window.innerWidth - width - 16)),
      top:
        below >= height ? rect.bottom + 6 : Math.max(80, rect.top - height - 6),
      width,
      height,
    });
    setOpen(true);
  }
  const handle = (key: string) => {
    if (!open) return false;
    if (key === "b") close();
    else if (key === "a") commit(highlight);
    else if (key === "up" || key === "down")
      setHighlight((index) =>
        Math.max(
          0,
          Math.min(options.length - 1, index + (key === "up" ? -1 : 1)),
        ),
      );
    return true;
  };
  useLayoutEffect(() => {
    if (!open || !input) return;
    input.current = handle;
    return () => {
      if (input.current === handle) input.current = null;
    };
  });
  useLayoutEffect(() => {
    menu.current
      ?.querySelectorAll<HTMLElement>("[role=option]")
      [highlight]?.scrollIntoView({ block: "nearest" });
  }, [open, highlight]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (
        !menu.current?.contains(event.target as Node) &&
        !trigger.current?.contains(event.target as Node)
      )
        setOpen(false);
    };
    const resize = () => setOpen(false);
    const scroll = () => setOpen(false);
    const scroller = trigger.current?.closest(".tv-content");
    window.addEventListener("pointerdown", outside);
    window.addEventListener("resize", resize);
    scroller?.addEventListener("scroll", scroll);
    return () => {
      window.removeEventListener("pointerdown", outside);
      window.removeEventListener("resize", resize);
      scroller?.removeEventListener("scroll", scroll);
    };
  }, [open]);
  return (
    <>
      <button
        ref={trigger}
        className="tv-select-trigger"
        role="combobox"
        aria-label={label}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={id}
        aria-activedescendant={open ? `${id}-${highlight}` : undefined}
        disabled={disabled}
        onClick={() => (open ? close() : show())}
        onBlur={(event) => {
          if (!menu.current?.contains(event.relatedTarget as Node))
            setOpen(false);
        }}
        onKeyDown={(event) => {
          if (event.key === "Tab") {
            setOpen(false);
            return;
          }
          const keys: Record<string, string> = {
            ArrowUp: "up",
            ArrowDown: "down",
            ArrowLeft: "left",
            ArrowRight: "right",
            Enter: "a",
            " ": "a",
            Escape: "b",
          };
          if (open && keys[event.key]) {
            event.preventDefault();
            event.stopPropagation();
            handle(keys[event.key]);
          }
        }}
      >
        <span>{current?.label ?? label}</span>
        <ChevronDown size={17} />
      </button>
      {open &&
        createPortal(
          <div
            ref={menu}
            id={id}
            role="listbox"
            aria-label={label}
            className="tv-select-menu"
            style={{
              left: position.left,
              top: position.top,
              width: position.width,
              maxHeight: position.height,
            }}
          >
            {options.map((option, index) => (
              <div
                key={option.value}
                id={`${id}-${index}`}
                role="option"
                aria-selected={option.value === value}
                className={highlight === index ? "highlighted" : ""}
                onPointerDown={(event) => event.preventDefault()}
                onMouseEnter={() => setHighlight(index)}
                onClick={() => commit(index)}
              >
                <span>{option.label}</span>
                {option.value === value && <Check size={17} />}
              </div>
            ))}
          </div>,
          document.querySelector(".console-mode") ?? document.body,
        )}
    </>
  );
}
