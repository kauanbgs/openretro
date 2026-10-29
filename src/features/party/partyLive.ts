/** What the room shows live, apart from the chat: quick reactions and who is
 * talking. The server relays reactions; the host measures the voices. */

/** The fixed set a reaction can be: the room never relays free text here. */
export const PARTY_REACTIONS = [
  { id: "clap", emoji: "👏", label: "Palmas" },
  { id: "laugh", emoji: "😂", label: "Risada" },
  { id: "fire", emoji: "🔥", label: "Mandou bem" },
  { id: "heart", emoji: "❤️", label: "Amei" },
  { id: "wow", emoji: "😮", label: "Uau" },
  { id: "like", emoji: "👍", label: "Boa" },
] as const;
export type PartyReactionId = (typeof PARTY_REACTIONS)[number]["id"];

export interface PartyReaction {
  id: string;
  emoji: string;
  name: string;
  player: number;
  /** When it arrived here: reactions fade by this clock. */
  at: number;
}
/** Someone talking right now. */
export interface PartySpeaker {
  player: number;
  name: string;
}

export const reactionEmoji = (id: unknown) =>
  PARTY_REACTIONS.find((reaction) => reaction.id === id)?.emoji;

export function reactionMessage(id: PartyReactionId) {
  return { type: "reaction", reaction: id };
}

export function parsePartyReaction(m: unknown): PartyReaction | null {
  if (!m || typeof m !== "object") return null;
  const value = m as Record<string, unknown>;
  const emoji = reactionEmoji(value.reaction);
  if (
    value.type !== "reaction" ||
    !emoji ||
    typeof value.id !== "string" ||
    value.id.length > 64 ||
    typeof value.name !== "string" ||
    value.name.length > 64 ||
    ![1, 2, 3, 4].includes(value.player as number)
  )
    return null;
  return {
    id: value.id,
    emoji,
    name: value.name,
    player: value.player as number,
    at: Date.now(),
  };
}

/** The host tells every guest who is talking, over the game connection. */
export function speakersMessage(speakers: PartySpeaker[]) {
  return JSON.stringify({ type: "voice", speaking: speakers });
}

export function parseSpeakers(raw: unknown): PartySpeaker[] | null {
  if (typeof raw !== "string" || raw.length > 1024) return null;
  try {
    const m = JSON.parse(raw);
    if (
      m?.type !== "voice" ||
      !Array.isArray(m.speaking) ||
      m.speaking.length > 4
    )
      return null;
    const seen = new Set<number>();
    const speakers: PartySpeaker[] = [];
    for (const row of m.speaking) {
      if (
        !row ||
        typeof row.name !== "string" ||
        row.name.length > 80 ||
        ![1, 2, 3, 4].includes(row.player) ||
        seen.has(row.player)
      )
        return null;
      seen.add(row.player);
      speakers.push({ player: row.player, name: row.name });
    }
    return speakers;
  } catch {
    return null;
  }
}

/** Loud enough to count as talking, and kept for a moment so a pause between
 * words does not flicker. */
export const SPEAKING_LEVEL = 0.02;
export const SPEAKING_HOLD_MS = 350;

/** The loudness of a block of samples, from 0 to 1. */
export function loudness(samples: ArrayLike<number>) {
  if (!samples.length) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / samples.length);
}

/**
 * Who is talking at `now`. `last` holds when each voice was last loud
 * enough, and is updated in place.
 */
export function talking(
  levels: Map<string, number>,
  last: Map<string, number>,
  now: number,
) {
  for (const [id, level] of levels)
    if (level >= SPEAKING_LEVEL) last.set(id, now);
  for (const [id, at] of last) {
    if (!levels.has(id) || now - at > SPEAKING_HOLD_MS) last.delete(id);
  }
  return [...last.keys()].sort();
}
