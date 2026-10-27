import { emit, listen } from "@tauri-apps/api/event";
import { invoke, isTauri } from "../../services/transport";
import { partyStore, sendPartyChat } from "./partySession";

/**
 * Carries the host's Party chat between the main window, which holds the
 * room, and the window that shows it over a running game.
 */
export function startPartyChatRelay() {
  if (!isTauri) return () => {};
  let open = false;
  let last = "";
  const share = () => void emit("party-chat-lines", partyStore.snapshot().chat);
  const stop = partyStore.subscribe(() => {
    const { phase, chat } = partyStore.snapshot();
    if ((phase === "open") !== open) {
      open = phase === "open";
      void invoke("party_chat_state", { active: open }).catch(() => {});
    }
    const newest = chat.at(-1)?.id ?? "";
    if (newest !== last) {
      last = newest;
      share();
      if (newest) void invoke("party_chat_show").catch(() => {});
    }
  });
  const sending = listen<string>("party-chat-send", (event) => {
    if (typeof event.payload === "string") sendPartyChat(event.payload);
  });
  // The overlay asks for the lines when it starts.
  const syncing = listen("party-chat-sync", share);
  return () => {
    stop();
    void sending.then((unlisten) => unlisten());
    void syncing.then((unlisten) => unlisten());
  };
}
