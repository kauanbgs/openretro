import { partyOwnsInput } from "../party/partyInput";
export type ControllerSnapshot = Pick<
  Gamepad,
  "id" | "mapping" | "buttons" | "axes"
>;
/** State belongs to the input device, not to the currently mounted page/dialog. */
export class ControllerInput {
  private held = new Set<string>();
  private repeatAt = new Map<string, number>();

  sample(pad: ControllerSnapshot | null | undefined, now: number): string[] {
    if (!pad) {
      this.held.clear();
      this.repeatAt.clear();
      return [];
    }
    // Chromium normally exposes the standard layout. Some DS4 drivers expose
    // the original DirectInput layout instead: Cross=1, Circle=2, PS=12.
    const rawSony =
      pad.mapping !== "standard" &&
      /054c|dualshock|wireless controller|ps4/i.test(pad.id);
    const button = (index: number) => Boolean(pad.buttons[index]?.pressed);
    const pov = pad.axes[9];
    const hat =
      rawSony && pov >= -1 && pov <= 1 ? Math.round((pov + 1) * 3.5) : -1;
    const active: Record<string, boolean> = {
      left:
        (!rawSony && button(14)) ||
        pad.axes[0] < -0.65 ||
        [5, 6, 7].includes(hat),
      right:
        (!rawSony && button(15)) ||
        pad.axes[0] > 0.65 ||
        [1, 2, 3].includes(hat),
      up:
        (!rawSony && button(12)) ||
        pad.axes[1] < -0.65 ||
        [7, 0, 1].includes(hat),
      down:
        (!rawSony && button(13)) ||
        pad.axes[1] > 0.65 ||
        [3, 4, 5].includes(hat),
      a: button(rawSony ? 1 : 0),
      b: button(rawSony ? 2 : 1),
      x: button(rawSony ? 0 : 2),
      y: button(rawSony ? 3 : 3),
      search: button(8),
      menu: button(9),
      lb: button(4),
      rb: button(5),
    };
    const result: string[] = [];
    for (const [key, pressed] of Object.entries(active)) {
      if (!pressed) {
        this.repeatAt.delete(key);
        continue;
      }
      if (!this.held.has(key)) {
        result.push(key);
        this.repeatAt.set(key, now + 380);
      } else if (
        ["left", "right", "up", "down"].includes(key) &&
        now >= (this.repeatAt.get(key) ?? Infinity)
      ) {
        result.push(key);
        this.repeatAt.set(key, now + 125);
      }
    }
    this.held = new Set(Object.keys(active).filter((key) => active[key]));
    return partyOwnsInput() ? [] : result;
  }
}
