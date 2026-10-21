export type Direction = "up" | "down" | "left" | "right";
export interface FocusRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Prefer controls sharing a row/column, then the nearest forward candidate. */
export function nextControl(
  rects: FocusRect[],
  current: number,
  direction: Direction,
): number {
  const origin = rects[current];
  if (!origin) return rects.length ? 0 : -1;
  const horizontal = direction === "left" || direction === "right";
  const sign = direction === "left" || direction === "up" ? -1 : 1;
  const x = origin.left + origin.width / 2,
    y = origin.top + origin.height / 2;
  let best = current,
    score = Infinity;
  rects.forEach((rect, index) => {
    if (index === current) return;
    const dx = rect.left + rect.width / 2 - x,
      dy = rect.top + rect.height / 2 - y;
    const forward = (horizontal ? dx : dy) * sign;
    if (forward < 2) return;
    const cross = Math.abs(horizontal ? dy : dx);
    const overlap = horizontal
      ? Math.min(origin.top + origin.height, rect.top + rect.height) -
        Math.max(origin.top, rect.top)
      : Math.min(origin.left + origin.width, rect.left + rect.width) -
        Math.max(origin.left, rect.left);
    const candidate = forward + cross * 3 + (overlap <= 0 ? 10000 : 0);
    if (candidate < score) {
      best = index;
      score = candidate;
    }
  });
  return best;
}

export function changeField(
  field: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
  value: string,
) {
  const prototype =
    field instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : field instanceof HTMLSelectElement
        ? HTMLSelectElement.prototype
        : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(field, value);
  field.dispatchEvent(
    new Event(field instanceof HTMLSelectElement ? "change" : "input", {
      bubbles: true,
    }),
  );
}
