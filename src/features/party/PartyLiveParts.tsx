import { useEffect, useState } from "react";
import { t } from "../../i18n";
import {
  PARTY_REACTIONS,
  type PartyReaction,
  type PartyReactionId,
  type PartySpeaker,
} from "./partyLive";
import "./PartyLiveParts.css";

/** How long a reaction stays over the game. */
export const REACTION_SHOWN_MS = 3200;

/** The six quick reactions, as buttons. The number is the shortcut. */
export function PartyReactionTray({
  onPick,
  shortcuts,
}: {
  onPick: (id: PartyReactionId) => void;
  shortcuts?: boolean;
}) {
  return (
    <div className="party-reactions" role="group" aria-label={t("Reações")}>
      {PARTY_REACTIONS.map((reaction, index) => (
        <button
          key={reaction.id}
          type="button"
          className="party-reaction-button"
          title={
            shortcuts
              ? `${t(reaction.label)} (${index + 1})`
              : t(reaction.label)
          }
          aria-label={t(reaction.label)}
          onClick={() => onPick(reaction.id)}
        >
          {reaction.emoji}
        </button>
      ))}
    </div>
  );
}

/** Reactions drifting up over the picture, each with who sent it. */
export function PartyReactionFloat({ items }: { items: PartyReaction[] }) {
  const [now, setNow] = useState(() => Date.now());
  const newest = items.at(-1)?.id;
  useEffect(() => {
    if (!newest) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 300);
    const stop = setTimeout(
      () => clearInterval(timer),
      REACTION_SHOWN_MS + 400,
    );
    return () => {
      clearInterval(timer);
      clearTimeout(stop);
    };
  }, [newest]);
  const shown = items.filter((item) => now - item.at < REACTION_SHOWN_MS);
  return (
    <div className="party-reaction-float" aria-hidden="true">
      {shown.map((item) => {
        // A steady spot per reaction, so a burst fans out instead of stacking.
        const spot = [...item.id].reduce((sum, c) => sum + c.charCodeAt(0), 0);
        return (
          <span
            key={item.id}
            className="party-reaction-pop"
            style={{ left: `${8 + (spot % 70)}%` }}
          >
            <span className="party-reaction-emoji">{item.emoji}</span>
            <small>{item.name}</small>
          </span>
        );
      })}
    </div>
  );
}

/** Who is talking, as small marks that light up while they speak. */
export function PartySpeakers({ speakers }: { speakers: PartySpeaker[] }) {
  if (!speakers.length) return null;
  return (
    <ul className="party-speakers" aria-label={t("Falando agora")}>
      {speakers.map((speaker) => (
        <li key={speaker.player}>
          <span className="party-speaking-mark">J{speaker.player}</span>
          {speaker.name}
        </li>
      ))}
    </ul>
  );
}
