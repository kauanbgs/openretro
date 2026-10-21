import type { CSSProperties } from "react";
import {
  Bot,
  Cat,
  Crown,
  Flame,
  Gamepad2,
  Ghost,
  Heart,
  Rocket,
  Skull,
  Star,
  Swords,
  Zap,
  type LucideIcon,
} from "lucide-react";
import type { PlayerProfile } from "../types";
import { PLAYER_COLORS } from "../services/playerAppearance";

export { PLAYER_COLORS };

export const PLAYER_AVATARS: Record<
  string,
  { icon: LucideIcon; label: string }
> = {
  gamepad: { icon: Gamepad2, label: "Controle" },
  ghost: { icon: Ghost, label: "Fantasma" },
  rocket: { icon: Rocket, label: "Foguete" },
  cat: { icon: Cat, label: "Gato" },
  swords: { icon: Swords, label: "Espadas" },
  crown: { icon: Crown, label: "Coroa" },
  star: { icon: Star, label: "Estrela" },
  skull: { icon: Skull, label: "Caveira" },
  zap: { icon: Zap, label: "Raio" },
  heart: { icon: Heart, label: "Coração" },
  bot: { icon: Bot, label: "Robô" },
  flame: { icon: Flame, label: "Chama" },
};

export function PlayerAvatar({
  player,
  size = 36,
}: {
  player?: Pick<PlayerProfile, "avatar" | "color"> | null;
  size?: number;
}) {
  const Icon = PLAYER_AVATARS[player?.avatar ?? ""]?.icon ?? Gamepad2;
  return (
    <span
      className="player-avatar"
      aria-hidden="true"
      style={
        {
          "--player-color": player?.color ?? PLAYER_COLORS[0],
          width: size,
          height: size,
        } as CSSProperties
      }
    >
      <Icon size={Math.round(size * 0.55)} />
    </span>
  );
}

/** CSS variables that re-tint the console UI with the active player's color. */
export function playerAccent(player?: PlayerProfile | null): CSSProperties {
  if (!player) return {};
  // The console's gradients run soft → base → hot around the accent.
  return {
    "--fx-a": player.color,
    "--fx-a-soft": `color-mix(in srgb, ${player.color} 60%, #fff)`,
    "--fx-a-hot": `color-mix(in srgb, ${player.color} 75%, #000)`,
    "--tv-accent": player.color,
    "--accent": player.color,
    "--accentText": "#17100a",
    "--glow": `color-mix(in srgb, ${player.color} 55%, transparent)`,
  } as CSSProperties;
}
