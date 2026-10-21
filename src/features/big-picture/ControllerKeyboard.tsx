import { useEffect, useRef, useState, type RefObject } from "react";
import { Delete, Search, X } from "lucide-react";
import { createPortal } from "react-dom";

const letters = "1234567890qwertyuiopasdfghjklçzxcvbnm.,-".split("");
export function ControllerKeyboard({
  value,
  onChange,
  onClose,
  input,
}: {
  value: string;
  onChange: (value: string) => void;
  onClose: () => void;
  input: RefObject<((key: string) => boolean) | null>;
}) {
  const [selected, setSelected] = useState(0);
  const [uppercase, setUppercase] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    field.current?.focus();
    return () => {
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  function activate(index: number) {
    if (index < letters.length)
      onChange(
        (
          value + (uppercase ? letters[index].toUpperCase() : letters[index])
        ).slice(0, 120),
      );
    else if (index === 40) setUppercase((current) => !current);
    else if (index === 41) onChange((value + " ").slice(0, 120));
    else if (index === 42) onChange(value.slice(0, -1));
    else if (index === 43) onChange("");
    else onClose();
  }
  useEffect(() => {
    input.current = (key) => {
      if (key === "b") onClose();
      else if (key === "a") activate(selected);
      else if (key === "x") onChange(value.slice(0, -1));
      else if (key === "y") setUppercase((current) => !current);
      else if (["left", "right", "up", "down"].includes(key)) {
        field.current?.blur();
        const row = selected < 40 ? Math.floor(selected / 10) : 4;
        const col = selected < 40 ? selected % 10 : (selected - 40) * 2;
        if (key === "up" && row > 0) setSelected((row - 1) * 10 + col);
        if (key === "down" && row < 4)
          setSelected(row === 3 ? 40 + Math.floor(col / 2) : selected + 10);
        if (key === "left")
          setSelected(Math.max(row === 4 ? 40 : row * 10, selected - 1));
        if (key === "right")
          setSelected(Math.min(row === 4 ? 44 : row * 10 + 9, selected + 1));
      }
      return true;
    };
    return () => {
      input.current = null;
    };
  });
  return createPortal(
    <div className="tv-dialog-backdrop tv-keyboard-backdrop" onClick={onClose}>
      <section
        className="tv-keyboard"
        role="dialog"
        aria-modal="true"
        aria-label="Buscar com controle"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="tv-keyboard-heading">
          <h2>Pesquisar jogos</h2>
          <button aria-label="Fechar teclado" onClick={onClose}>
            <X size={22} />
          </button>
        </div>
        <label className="tv-search">
          <Search size={19} />
          <input
            ref={field}
            aria-label="Texto da busca"
            value={value}
            maxLength={120}
            placeholder="Digite um nome"
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape" || event.key === "Enter") {
                event.preventDefault();
                onClose();
              }
              if (event.key === "ArrowDown") {
                event.preventDefault();
                field.current?.blur();
              }
            }}
          />
        </label>
        <div className="tv-keyboard-keys">
          {letters.map((letter, index) => (
            <button
              className={selected === index ? "focused" : ""}
              key={letter}
              onMouseEnter={() => setSelected(index)}
              onClick={() => activate(index)}
            >
              {uppercase ? letter.toUpperCase() : letter}
            </button>
          ))}
        </div>
        <div className="tv-keyboard-actions">
          {["Maiúsculas", "Espaço", "Apagar", "Limpar", "Concluir"].map(
            (label, index) => (
              <button
                key={label}
                className={`${selected === 40 + index ? "focused" : ""} ${index === 4 ? "primary" : ""}`}
                onMouseEnter={() => setSelected(40 + index)}
                onClick={() => activate(40 + index)}
              >
                {index === 2 ? <Delete size={20} /> : label}
              </button>
            ),
          )}
        </div>
        <p className="tv-keyboard-help">
          A confirma · B volta · X apaga · Y alterna maiúsculas
        </p>
      </section>
    </div>,
    document.querySelector(".console-mode") ?? document.body,
  );
}
