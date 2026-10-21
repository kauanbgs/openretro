import { expect, it } from "vitest";
import { groupByDay, slotLabel } from "./SaveTimeline";

it("groups newest-first states by calendar day", () => {
  const now = new Date(2026, 9, 21, 20, 0);
  const state = (slot: number, date: Date) => ({
    slot,
    modifiedAt: date.toISOString(),
    size: 1,
    thumbnail: null,
  });
  const groups = groupByDay(
    [
      state(-1, new Date(2026, 9, 21, 19, 0)),
      state(2, new Date(2026, 9, 21, 9, 0)),
      state(1, new Date(2026, 9, 20, 23, 0)),
      state(0, new Date(2026, 9, 1, 12, 0)),
    ],
    now,
  );
  expect(groups.map((g) => g.label).slice(0, 2)).toEqual(["Hoje", "Ontem"]);
  expect(groups[0].states.map((s) => s.slot)).toEqual([-1, 2]);
  expect(groups).toHaveLength(3);
  expect(slotLabel(-1)).toBe("Retomada automática");
  expect(slotLabel(3)).toBe("Slot 3");
});
