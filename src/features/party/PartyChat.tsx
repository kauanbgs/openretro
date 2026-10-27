import { useEffect, useRef, useState } from "react";
import { PARTY_CHAT_MAX, type PartyChatLine } from "./partyChatLines";
import { t } from "../../i18n";
import "./PartyChat.css";

/** How long a new line stays over the game while the chat is closed. */
export const CHAT_SHOWN_MS = 10000;

/**
 * The Party's chat over a game: recent lines fade on their own, and the
 * box opens to type. Enter sends, Esc closes. `inline` is the Party
 * window's version: always open, every line, and it stays after sending.
 */
export function PartyChat({
  lines,
  open,
  onSend,
  onClose,
  inline = false,
}: {
  lines: PartyChatLine[];
  open: boolean;
  onSend: (text: string) => void;
  onClose: () => void;
  inline?: boolean;
}) {
  const [draft, setDraft] = useState("");
  const [now, setNow] = useState(Date.now());
  const list = useRef<HTMLOListElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const newest = lines.at(-1)?.at ?? 0;
  // Re-render when the newest line should fade out.
  useEffect(() => {
    setNow(Date.now());
    if (open) return;
    const wait = newest + CHAT_SHOWN_MS - Date.now();
    if (wait <= 0) return;
    const timer = setTimeout(() => setNow(Date.now()), wait + 50);
    return () => clearTimeout(timer);
  }, [newest, open]);
  useEffect(() => {
    if (open && !inline) input.current?.focus();
  }, [open, inline]);
  useEffect(() => {
    if (list.current) list.current.scrollTop = list.current.scrollHeight;
  }, [lines.length, open]);
  const shown = open
    ? lines.slice(-30)
    : lines.filter((line) => now - line.at < CHAT_SHOWN_MS).slice(-6);
  return (
    <div
      className={`party-chat ${open ? "open" : ""} ${inline ? "inline" : ""}`}
    >
      <ol ref={list} aria-label={t("Chat da Party")} aria-live="polite">
        {shown.map((line) => (
          <li key={line.id} className={line.from ? "" : "note"}>
            {line.from && (
              <strong>
                {line.name} (J{line.player}){" "}
              </strong>
            )}
            {line.text}
          </li>
        ))}
      </ol>
      {open && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (draft.trim()) onSend(draft);
            setDraft("");
            if (!inline) onClose();
          }}
        >
          <input
            ref={input}
            value={draft}
            maxLength={PARTY_CHAT_MAX}
            autoComplete="off"
            enterKeyHint="send"
            aria-label={t("Mensagem para a Party")}
            placeholder={
              inline
                ? t("Mensagem para a Party")
                : t("Mensagem para a Party · Enter envia, Esc fecha")
            }
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape" && !inline) {
                event.preventDefault();
                event.stopPropagation();
                setDraft("");
                onClose();
              }
            }}
          />
        </form>
      )}
    </div>
  );
}
