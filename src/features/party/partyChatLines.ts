/** A line of the Party's temporary chat. The room relays it and keeps nothing. */
export interface PartyChatLine {
  id: string;
  /** "host", a guest's id, or "" for a note from the room itself. */
  from: string;
  name: string;
  player: number;
  text: string;
  at: number;
}
export const PARTY_CHAT_MAX = 200;
const KEEP = 50;

export function parsePartyChat(m: unknown): PartyChatLine | null {
  if (!m || typeof m !== "object") return null;
  const line = m as Record<string, unknown>;
  if (
    line.type !== "chat" ||
    typeof line.id !== "string" ||
    line.id.length > 64 ||
    typeof line.from !== "string" ||
    line.from.length > 64 ||
    typeof line.name !== "string" ||
    line.name.length > 64 ||
    ![1, 2, 3, 4].includes(line.player as number) ||
    typeof line.text !== "string" ||
    !line.text ||
    [...line.text].length > PARTY_CHAT_MAX ||
    !Number.isSafeInteger(line.at)
  )
    return null;
  return {
    id: line.id,
    from: line.from,
    name: line.name,
    player: line.player as number,
    text: line.text,
    // When it arrived here: lines fade by this clock, not the server's.
    at: Date.now(),
  };
}
/** A note shown only here, such as the room refusing a message. */
export const chatNote = (text: string): PartyChatLine => ({
  id: `note-${Date.now()}-${Math.random()}`,
  from: "",
  name: "",
  player: 1,
  text,
  at: Date.now(),
});
export const addChatLine = (lines: PartyChatLine[], line: PartyChatLine) =>
  [...lines.filter((item) => item.id !== line.id), line].slice(-KEEP);
/** What is sent to the room, or null when there is nothing to send. */
export function chatMessage(value: string) {
  const text = value.replace(/\s+/g, " ").trim();
  return text
    ? { type: "chat", text: [...text].slice(0, PARTY_CHAT_MAX).join("") }
    : null;
}
