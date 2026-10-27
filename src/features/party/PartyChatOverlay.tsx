import { useEffect, useState } from "react";
import { emit, listen } from "@tauri-apps/api/event";
import { invoke } from "../../services/transport";
import { CHAT_SHOWN_MS, PartyChat } from "./PartyChat";
import type { PartyChatLine } from "./partyChatLines";
import { t } from "../../i18n";
import "../in-game/InGameOverlay.css";

/** The host's Party chat over a running game, in its own transparent window. */
export function PartyChatOverlay() {
  const [lines, setLines] = useState<PartyChatLine[]>([]);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    document.documentElement.classList.add("in-game-overlay");
    const lining = listen<PartyChatLine[]>("party-chat-lines", (event) => {
      if (!Array.isArray(event.payload)) return;
      // Lines fade by when this window got them.
      setLines((previous) => {
        const seen = new Map(previous.map((line) => [line.id, line.at]));
        return event.payload.map((line) => ({
          ...line,
          at: seen.get(line.id) ?? Date.now(),
        }));
      });
    });
    const composing = listen("party-chat-compose", () => setOpen(true));
    void emit("party-chat-sync");
    return () => {
      void lining.then((unlisten) => unlisten());
      void composing.then((unlisten) => unlisten());
    };
  }, []);
  // With nothing left to read, the window gets out of the way.
  const newest = lines.at(-1)?.at ?? 0;
  useEffect(() => {
    if (open) return;
    const timer = setTimeout(
      () => void invoke("party_chat_hide").catch(() => {}),
      Math.max(0, newest + CHAT_SHOWN_MS - Date.now()) + 300,
    );
    return () => clearTimeout(timer);
  }, [newest, open]);
  const close = () => {
    setOpen(false);
    void invoke("party_chat_release").catch(() => {});
  };
  // Clicking back into the game ends typing too.
  useEffect(() => {
    if (!open) return;
    const blur = () => close();
    window.addEventListener("blur", blur);
    return () => window.removeEventListener("blur", blur);
  }, [open]);
  return (
    <main className="party-chat-overlay" aria-label={t("Chat da Party")}>
      <PartyChat
        lines={lines}
        open={open}
        onSend={(text) => void emit("party-chat-send", text)}
        onClose={close}
      />
      {open && (
        <p className="party-chat-overlay-hint">
          {t("Chat da Party · o jogo continua rodando")}
        </p>
      )}
    </main>
  );
}
