import { expect, it } from "vitest";
import { nextControl } from "./workspaceNavigation";

it("keeps navigation on the current row/column instead of jumping to a large neighboring panel", () => {
  const rects = [
    { left: 0, top: 0, width: 100, height: 40 },
    { left: 120, top: 0, width: 100, height: 40 },
    { left: 0, top: 70, width: 100, height: 40 },
    { left: 120, top: 70, width: 100, height: 40 },
  ];
  expect(nextControl(rects, 0, "right")).toBe(1);
  expect(nextControl(rects, 0, "down")).toBe(2);
  expect(nextControl(rects, 3, "up")).toBe(1);
  expect(nextControl(rects, 0, "left")).toBe(0);
  expect(nextControl([], 0, "down")).toBe(-1);
});
