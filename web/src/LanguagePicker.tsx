import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Globe } from "lucide-react";
import { languages, preference, setLanguage, t } from "./i18n";
import "./languagePicker.css";

export function LanguagePicker() {
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const options = [
    {
      id: "system" as const,
      name: t("Automatic (system language)"),
      flag: null,
    },
    ...languages,
  ];
  const current = options.find((option) => option.id === preference)!;
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  return (
    <div className="site-language" ref={root}>
      <button
        ref={trigger}
        type="button"
        role="combobox"
        aria-label={t("Language")}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls="site-language-menu"
        aria-activedescendant={open ? `site-language-${highlight}` : undefined}
        onBlur={(event) => {
          if (!root.current?.contains(event.relatedTarget as Node))
            setOpen(false);
        }}
        onClick={() => {
          setHighlight(options.findIndex((option) => option.id === preference));
          setOpen(!open);
        }}
        onKeyDown={(event) => {
          if (event.key === "Tab") {
            setOpen(false);
            return;
          }
          if (event.key === "Escape") {
            event.stopPropagation();
            setOpen(false);
            return;
          }
          if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
            event.preventDefault();
            setOpen(true);
            setHighlight(
              event.key === "Home"
                ? 0
                : event.key === "End"
                  ? options.length - 1
                  : Math.max(
                      0,
                      Math.min(
                        options.length - 1,
                        highlight + (event.key === "ArrowDown" ? 1 : -1),
                      ),
                    ),
            );
          }
          if (open && ["Enter", " "].includes(event.key)) {
            event.preventDefault();
            setLanguage(options[highlight].id);
          }
        }}
      >
        {current.flag ? (
          <img src={current.flag} alt="" width="24" height="16" />
        ) : (
          <Globe size={20} aria-hidden="true" />
        )}
        <span className="site-language-name">{current.name}</span>
        <ChevronDown size={15} aria-hidden="true" />
      </button>
      {open && (
        <div id="site-language-menu" role="listbox" aria-label={t("Language")}>
          {options.map((option, index) => (
            <div
              key={option.id}
              id={`site-language-${index}`}
              role="option"
              aria-selected={option.id === preference}
              className={highlight === index ? "highlighted" : undefined}
              onPointerDown={(event) => event.preventDefault()}
              onMouseEnter={() => setHighlight(index)}
              onClick={() => setLanguage(option.id)}
            >
              {option.flag ? (
                <img src={option.flag} alt="" width="24" height="16" />
              ) : (
                <Globe size={20} aria-hidden="true" />
              )}
              <span>{option.name}</span>
              {option.id === preference && (
                <Check size={16} aria-hidden="true" />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
