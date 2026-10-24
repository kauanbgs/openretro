import type { CSSProperties } from "react";
import {
  Bot,
  Cat,
  Crown,
  Flame,
  Gamepad2,
  Gem,
  Ghost,
  Heart,
  Joystick,
  Rocket,
  Shield,
  Skull,
  Star,
  Swords,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { t } from "../../i18n";
import "./accountAvatars.css";

// The 15 preset account icons, by the number the server stores (0 to 14).
// Each has its own gradient so friends tell each other apart at a glance.
export const ACCOUNT_AVATARS: {
  icon: LucideIcon;
  label: string;
  from: string;
  to: string;
}[] = [
  { icon: Gamepad2, label: "Controle", from: "#7c5cff", to: "#3d7bff" },
  { icon: Joystick, label: "Joystick", from: "#ff5c8a", to: "#c2338f" },
  { icon: Ghost, label: "Fantasma", from: "#5ee7df", to: "#3a8dde" },
  { icon: Rocket, label: "Foguete", from: "#ff9a3d", to: "#ff4f4f" },
  { icon: Star, label: "Estrela", from: "#ffd84d", to: "#ff9f1c" },
  { icon: Heart, label: "Coração", from: "#ff6b9a", to: "#e0245e" },
  { icon: Crown, label: "Coroa", from: "#f6c453", to: "#b7791f" },
  { icon: Zap, label: "Raio", from: "#b4f04a", to: "#2fb36b" },
  { icon: Flame, label: "Chama", from: "#ff7a3d", to: "#d1311f" },
  { icon: Skull, label: "Caveira", from: "#8d93a5", to: "#3e4352" },
  { icon: Swords, label: "Espadas", from: "#6aa6ff", to: "#4552d6" },
  { icon: Shield, label: "Escudo", from: "#43d19e", to: "#16806a" },
  { icon: Cat, label: "Gato", from: "#ffb36b", to: "#d9744a" },
  { icon: Bot, label: "Robô", from: "#9aa8ff", to: "#5a46c7" },
  { icon: Gem, label: "Diamante", from: "#7df3ff", to: "#a45cff" },
];

export type PresenceStatus = "online" | "idle" | "offline" | "playing";

export function AccountAvatar({
  avatar,
  size = 40,
  status,
}: {
  avatar?: number | null;
  size?: number;
  /** A dot in the corner; none for an account without presence. */
  status?: PresenceStatus;
}) {
  const preset =
    ACCOUNT_AVATARS[
      Number.isInteger(avatar) && avatar! >= 0 && avatar! < 15 ? avatar! : 0
    ];
  const Icon = preset.icon;
  return (
    <span
      className={`account-avatar${status ? " status-" + status : ""}`}
      aria-hidden="true"
      style={
        {
          "--avatar-from": preset.from,
          "--avatar-to": preset.to,
          width: size,
          height: size,
        } as CSSProperties
      }
    >
      <Icon size={Math.round(size * 0.5)} strokeWidth={2.2} />
      {status && <i />}
    </span>
  );
}

/** Five by three preset icons; the chosen one is pressed. */
export function AvatarPicker({
  value,
  onChange,
  disabled,
}: {
  value: number;
  onChange: (avatar: number) => void;
  disabled?: boolean;
}) {
  return (
    <div
      className="avatar-picker"
      role="group"
      aria-label={t("Ícone da conta")}
    >
      {ACCOUNT_AVATARS.map((preset, index) => (
        <button
          key={preset.label}
          type="button"
          aria-label={t(preset.label)}
          aria-pressed={value === index}
          title={t(preset.label)}
          disabled={disabled}
          onClick={() => onChange(index)}
        >
          <AccountAvatar avatar={index} size={44} />
        </button>
      ))}
    </div>
  );
}
