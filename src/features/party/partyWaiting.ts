import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ACCOUNT_AVATARS } from "../social/accountAvatars";
import { t } from "../../i18n";

// What guests watch while the host has no game open: the host's PC paints
// it and streams it like a game frame, so every guest sees the same room.

export const WAITING_WIDTH = 1280;
export const WAITING_HEIGHT = 720;
/** The waiting screen breathes; a few frames a second are enough for that. */
export const WAITING_INTERVAL_MS = 200;
const TIP_MS = 6000;

export const WAITING_TIPS = [
  "Deixe o controle à mão: ele passa a valer assim que o jogo abrir.",
  "O som do jogo chega junto com a imagem. Com fones, ninguém ouve eco.",
  "Seu lugar é o que mostra o seu nome aqui embaixo.",
  "O J1 é de quem está no PC; os amigos jogam do J2 ao J4.",
];

export interface WaitingSeat {
  player: number;
  name: string;
  status: string;
  avatar: number | null;
  /** Someone is in this seat, connected or still connecting. */
  taken: boolean;
  ready: boolean;
}

export interface WaitingRoom {
  host: { name: string | null; avatar?: number | null };
  guests: {
    id: string;
    name: string;
    player: number | null;
    avatar?: number;
  }[];
  connected: string[];
}

export function waitingTitle(host: string | null) {
  return host
    ? t("{host} está escolhendo um jogo", { host })
    : t("Escolhendo um jogo");
}

export function waitingTip(time: number) {
  return t(WAITING_TIPS[Math.floor(time / TIP_MS) % WAITING_TIPS.length]);
}

export function waitingSeats(room: WaitingRoom): WaitingSeat[] {
  return [1, 2, 3, 4].map((player) => {
    if (player === 1)
      return {
        player,
        name: room.host.name || t("Anfitrião"),
        status: t("Anfitrião · no PC"),
        avatar: room.host.avatar ?? 0,
        taken: true,
        ready: true,
      };
    const guest = room.guests.find((g) => g.player === player);
    if (!guest)
      return {
        player,
        name: t("Lugar livre"),
        status: t("Esperando um amigo"),
        avatar: null,
        taken: false,
        ready: false,
      };
    const ready = room.connected.includes(guest.id);
    return {
      player,
      name: guest.name,
      status: ready ? t("Pronto para jogar") : t("Conectando…"),
      avatar: guest.avatar ?? 0,
      taken: true,
      ready,
    };
  });
}

/** The account icons as images, drawn once they load; initials until then. */
const icons = new Map<number, HTMLImageElement>();
function icon(avatar: number) {
  let image = icons.get(avatar);
  if (!image) {
    const preset = ACCOUNT_AVATARS[avatar] ?? ACCOUNT_AVATARS[0];
    const svg = renderToStaticMarkup(
      createElement(preset.icon, {
        size: 64,
        color: "#ffffff",
        strokeWidth: 2,
      }),
    );
    image = new Image();
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    icons.set(avatar, image);
  }
  return image.complete && image.naturalWidth ? image : null;
}

const FONT = '"Nunito Sans Variable", "Segoe UI", sans-serif';

function fit(paint: CanvasRenderingContext2D, text: string, width: number) {
  if (paint.measureText(text).width <= width) return text;
  let cut = text;
  while (cut.length > 1 && paint.measureText(`${cut}…`).width > width)
    cut = cut.slice(0, -1);
  return `${cut.trimEnd()}…`;
}

function rounded(
  paint: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  paint.beginPath();
  paint.roundRect(x, y, width, height, radius);
}

function alpha(color: string, value: number) {
  const hex = color.replace("#", "");
  if (!/^[0-9a-f]{6}$/i.test(hex)) return `rgba(18, 172, 226, ${value})`;
  const [r, g, b] = [0, 2, 4].map((at) => parseInt(hex.slice(at, at + 2), 16));
  return `rgba(${r}, ${g}, ${b}, ${value})`;
}

function avatarCircle(
  paint: CanvasRenderingContext2D,
  avatar: number,
  name: string,
  x: number,
  y: number,
  radius: number,
) {
  const preset = ACCOUNT_AVATARS[avatar] ?? ACCOUNT_AVATARS[0];
  const gradient = paint.createLinearGradient(
    x - radius,
    y - radius,
    x + radius,
    y + radius,
  );
  gradient.addColorStop(0, preset.from);
  gradient.addColorStop(1, preset.to);
  paint.fillStyle = gradient;
  paint.beginPath();
  paint.arc(x, y, radius, 0, Math.PI * 2);
  paint.fill();
  const image = icon(avatar);
  if (image) {
    const size = radius * 1.05;
    paint.drawImage(image, x - size / 2, y - size / 2, size, size);
  } else {
    paint.fillStyle = "#ffffff";
    paint.font = `800 ${Math.round(radius * 0.9)}px ${FONT}`;
    paint.textBaseline = "middle";
    paint.fillText(name.trim().charAt(0).toUpperCase() || "?", x, y + 1);
    paint.textBaseline = "alphabetic";
  }
}

export function paintWaiting(
  paint: CanvasRenderingContext2D,
  room: WaitingRoom,
  time: number,
) {
  const theme = getComputedStyle(document.documentElement);
  const color = (name: string, fallback: string) =>
    theme.getPropertyValue(name).trim() || fallback;
  const bg = color("--bg", "#080808"),
    text = color("--text", "#f3f3f3"),
    muted = color("--muted", "#a1a1a1"),
    accent = color("--accent", "#12ace2");
  const W = WAITING_WIDTH,
    H = WAITING_HEIGHT;
  // A slow breath, one cycle every three seconds.
  const breath = (Math.sin((time / 3000) * Math.PI * 2) + 1) / 2;

  paint.fillStyle = bg;
  paint.fillRect(0, 0, W, H);
  const glow = paint.createRadialGradient(W / 2, 210, 0, W / 2, 210, 560);
  glow.addColorStop(0, alpha(accent, 0.16 + breath * 0.06));
  glow.addColorStop(1, alpha(accent, 0));
  paint.fillStyle = glow;
  paint.fillRect(0, 0, W, H);

  paint.textAlign = "left";
  paint.fillStyle = accent;
  paint.beginPath();
  paint.arc(56, 52, 6, 0, Math.PI * 2);
  paint.fill();
  paint.fillStyle = muted;
  paint.font = `700 20px ${FONT}`;
  paint.fillText("OpenRetro Party", 72, 59);

  // The host's icon in the middle, with rings that grow and fade.
  const cx = W / 2,
    cy = 190;
  for (const offset of [0, 0.5]) {
    const wave = (((time / 2400 + offset) % 1) + 1) % 1;
    paint.strokeStyle = alpha(accent, 0.45 * (1 - wave));
    paint.lineWidth = 3;
    paint.beginPath();
    paint.arc(cx, cy, 58 + wave * 46, 0, Math.PI * 2);
    paint.stroke();
  }
  const seats = waitingSeats(room);
  avatarCircle(paint, seats[0].avatar ?? 0, seats[0].name, cx, cy, 56);

  paint.textAlign = "center";
  paint.fillStyle = text;
  paint.font = `800 44px ${FONT}`;
  paint.fillText(fit(paint, waitingTitle(room.host.name), W - 160), cx, 316);
  paint.fillStyle = muted;
  paint.font = `500 24px ${FONT}`;
  paint.fillText(
    t("A partida aparece aqui sozinha assim que o jogo abrir."),
    cx,
    358,
  );
  // Three dots that light up in turn.
  const step = Math.floor(time / 400) % 3;
  for (let dot = 0; dot < 3; dot++) {
    paint.fillStyle = dot === step ? accent : alpha(accent, 0.28);
    paint.beginPath();
    paint.arc(cx - 22 + dot * 22, 392, 5, 0, Math.PI * 2);
    paint.fill();
  }

  const card = { width: 250, height: 156, gap: 24 };
  const left = (W - (card.width * 4 + card.gap * 3)) / 2;
  seats.forEach((seat, index) => {
    const x = left + index * (card.width + card.gap),
      y = 440;
    rounded(paint, x, y, card.width, card.height, 18);
    paint.fillStyle = seat.taken
      ? "rgba(255, 255, 255, 0.06)"
      : "rgba(255, 255, 255, 0.02)";
    paint.fill();
    paint.lineWidth = 2;
    paint.setLineDash(seat.taken ? [] : [8, 8]);
    paint.strokeStyle = seat.ready
      ? alpha(accent, 0.55)
      : "rgba(255, 255, 255, 0.14)";
    paint.stroke();
    paint.setLineDash([]);

    paint.textAlign = "left";
    paint.fillStyle = seat.taken ? accent : muted;
    paint.font = `800 18px ${FONT}`;
    paint.fillText(`J${seat.player}`, x + 20, y + 34);
    if (seat.taken) {
      paint.fillStyle = seat.ready ? "#43d19e" : "#f6c453";
      paint.beginPath();
      paint.arc(x + card.width - 26, y + 28, 6, 0, Math.PI * 2);
      paint.fill();
    }

    paint.textAlign = "center";
    const middle = x + card.width / 2;
    if (seat.avatar !== null)
      avatarCircle(paint, seat.avatar, seat.name, middle, y + 62, 26);
    else {
      paint.strokeStyle = "rgba(255, 255, 255, 0.22)";
      paint.setLineDash([5, 6]);
      paint.beginPath();
      paint.arc(middle, y + 62, 26, 0, Math.PI * 2);
      paint.stroke();
      paint.setLineDash([]);
      paint.fillStyle = "rgba(255, 255, 255, 0.35)";
      paint.font = `600 28px ${FONT}`;
      paint.fillText("+", middle, y + 72);
    }
    paint.fillStyle = seat.taken ? text : muted;
    paint.font = `700 21px ${FONT}`;
    paint.fillText(fit(paint, seat.name, card.width - 32), middle, y + 118);
    paint.fillStyle = muted;
    paint.font = `500 16px ${FONT}`;
    paint.fillText(seat.status, middle, y + 142);
  });

  paint.fillStyle = muted;
  paint.font = `500 20px ${FONT}`;
  paint.fillText(
    fit(paint, t("Dica: {tip}", { tip: waitingTip(time) }), W - 160),
    cx,
    664,
  );
}
