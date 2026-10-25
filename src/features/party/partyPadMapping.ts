// Controllers the browser reports without the "standard" layout (a PS3
// controller on some drivers, generic USB pads) are mapped once by the player,
// pressing each button in turn, and then read as standard pads everywhere.

/** One control on the raw pad: a button, or an axis reaching a value. */
export type PadSource = { button: number } | { axis: number; value: number };

export interface PadMapping {
  /** Indexed like the standard layout's buttons; null when skipped. */
  buttons: (PadSource | null)[];
  /** Left X, left Y, right X, right Y: the raw axis and whether it is flipped. */
  sticks: ({ axis: number; invert: boolean } | null)[];
}

type RawPad = Pick<Gamepad, "id" | "buttons" | "axes" | "mapping">;
export type StandardPad = Pick<Gamepad, "buttons" | "axes" | "mapping">;

/** What the player presses, in the standard layout's button order. */
export const BUTTON_STEPS: { index: number; label: string }[] = [
  { index: 0, label: "Botão de baixo (✕ / A)" },
  { index: 1, label: "Botão da direita (○ / B)" },
  { index: 2, label: "Botão da esquerda (□ / X)" },
  { index: 3, label: "Botão de cima (△ / Y)" },
  { index: 4, label: "L1 / LB" },
  { index: 5, label: "R1 / RB" },
  { index: 6, label: "L2 / LT" },
  { index: 7, label: "R2 / RT" },
  { index: 8, label: "Select / Back" },
  { index: 9, label: "Start" },
  { index: 10, label: "L3 (aperte o analógico esquerdo)" },
  { index: 11, label: "R3 (aperte o analógico direito)" },
  { index: 12, label: "Direcional para cima" },
  { index: 13, label: "Direcional para baixo" },
  { index: 14, label: "Direcional para a esquerda" },
  { index: 15, label: "Direcional para a direita" },
];
/** Each stick is learned by pushing it right (X) and down (Y). */
export const STICK_STEPS: { index: number; label: string }[] = [
  { index: 0, label: "Analógico esquerdo para a direita" },
  { index: 1, label: "Analógico esquerdo para baixo" },
  { index: 2, label: "Analógico direito para a direita" },
  { index: 3, label: "Analógico direito para baixo" },
];

export interface PadSnapshot {
  buttons: boolean[];
  axes: number[];
}
export const snapshot = (pad: RawPad): PadSnapshot => ({
  buttons: pad.buttons.map((b) => b.pressed),
  axes: [...pad.axes],
});

/**
 * The control the player just used, compared with the pad at rest: a newly
 * pressed button first, otherwise an axis that moved well away from rest.
 * D-pads reported as one "hat" axis give a distinct value per direction.
 */
export function detectSource(rest: PadSnapshot, pad: RawPad): PadSource | null {
  const button = pad.buttons.findIndex((b, i) => b.pressed && !rest.buttons[i]);
  if (button >= 0) return { button };
  let best: { axis: number; value: number } | null = null;
  let largest = 0.5;
  for (let axis = 0; axis < pad.axes.length; axis++) {
    const value = pad.axes[axis];
    const delta = Math.abs(value - (rest.axes[axis] ?? 0));
    if (Number.isFinite(value) && delta > largest) {
      best = { axis, value };
      largest = delta;
    }
  }
  return best;
}

/** Whether a mapped control is held. Stick-like ends count past halfway;
 * hat positions must match their recorded value. */
export function isPressed(pad: RawPad, source: PadSource | null): boolean {
  if (!source) return false;
  if ("button" in source) return !!pad.buttons[source.button]?.pressed;
  const value = pad.axes[source.axis];
  if (!Number.isFinite(value)) return false;
  return Math.abs(source.value) > 0.95
    ? value * Math.sign(source.value) > 0.5
    : Math.abs(value - source.value) < 0.15;
}

/** A mapped pad presented as a standard one, so every reader works unchanged. */
export function toStandard(pad: RawPad, mapping: PadMapping): StandardPad {
  const buttons = Array.from({ length: 17 }, (_, i) => {
    const pressed = isPressed(pad, mapping.buttons[i] ?? null);
    return { pressed, touched: pressed, value: pressed ? 1 : 0 };
  });
  const axes = [0, 1, 2, 3].map((i) => {
    const stick = mapping.sticks[i];
    const value = stick ? pad.axes[stick.axis] : 0;
    return Number.isFinite(value) ? (stick?.invert ? -value : value) : 0;
  });
  return { buttons, axes, mapping: "standard" };
}

const storageKey = (id: string) => `openretro-pad-mapping:${id}`;

export function loadMapping(id: string): PadMapping | null {
  try {
    const raw = localStorage.getItem(storageKey(id));
    return raw ? (JSON.parse(raw) as PadMapping) : null;
  } catch {
    return null;
  }
}

export function saveMapping(id: string, mapping: PadMapping) {
  try {
    localStorage.setItem(storageKey(id), JSON.stringify(mapping));
  } catch {
    // Storage can be unavailable; the mapping still works for this session.
  }
}

/**
 * The pad to play with: a standard one if connected, else a mapped one.
 * `unmapped` names a connected pad that still needs setting up, if any.
 */
export function pickPad(
  pads: readonly (RawPad | null)[],
  mappings: (id: string) => PadMapping | null = loadMapping,
): { pad: StandardPad | null; unmapped: RawPad | null } {
  const connected = pads.filter((p): p is RawPad => !!p);
  const standard = connected.find((p) => p.mapping === "standard");
  if (standard) return { pad: standard, unmapped: null };
  for (const pad of connected) {
    const mapping = mappings(pad.id);
    if (mapping) return { pad: toStandard(pad, mapping), unmapped: null };
  }
  return { pad: null, unmapped: connected[0] ?? null };
}
