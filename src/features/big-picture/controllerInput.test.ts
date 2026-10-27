import { describe, expect, it } from "vitest";
import { ControllerInput, type ControllerSnapshot } from "./controllerInput";

function pad(pressed: number[] = [], raw = false): ControllerSnapshot {
  return {
    id: raw ? "054c Wireless Controller" : "Xbox Controller",
    mapping: raw ? "" : "standard",
    buttons: Array.from({ length: 17 }, (_, index) => ({
      pressed: pressed.includes(index),
      touched: false,
      value: pressed.includes(index) ? 1 : 0,
    })),
    axes: raw ? [0, 0, 0, 0, 0, 0, 0, 0, 0, 3.28] : [0, 0, 0, 0],
  };
}
describe("console controller across page and dialog transitions", () => {
  it("does not repeat confirmation when opening a dialog; accepts navigation and a new confirmation", () => {
    const input = new ControllerInput();
    expect(input.sample(pad([0]), 0)).toEqual(["a"]);
    // The UI changes from grid to dialog while the same button is held.
    expect(input.sample(pad([0]), 33)).toEqual([]);
    expect(input.sample(pad(), 66)).toEqual([]);
    expect(input.sample(pad([13]), 99)).toEqual(["down"]);
    expect(input.sample(pad(), 132)).toEqual([]);
    expect(input.sample(pad([0]), 165)).toEqual(["a"]);
    expect(input.sample(pad([1]), 198)).toEqual(["b"]);
  });
  it("reports Options and the PS / Xbox button for the control center", () => {
    const input = new ControllerInput();
    expect(input.sample(pad([9]), 0)).toEqual(["menu"]);
    expect(input.sample(pad(), 33)).toEqual([]);
    expect(input.sample(pad([16]), 66)).toEqual(["home"]);
  });
  it("repeats only directions and clears disconnected devices", () => {
    const input = new ControllerInput();
    expect(input.sample(pad([15]), 0)).toEqual(["right"]);
    expect(input.sample(pad([15]), 100)).toEqual([]);
    expect(input.sample(pad([15]), 400)).toEqual(["right"]);
    expect(input.sample(null, 410)).toEqual([]);
    expect(input.sample(pad([15]), 450)).toEqual(["right"]);
  });
  it("supports unmapped DualShock Cross/Circle and does not mistake PS for D-pad up", () => {
    const input = new ControllerInput();
    expect(input.sample(pad([1], true), 0)).toEqual(["a"]);
    expect(input.sample(pad([2], true), 33)).toEqual(["b"]);
    expect(input.sample(pad([12], true), 66)).toEqual([]);
    const diagonal = pad([], true);
    (diagonal.axes as number[])[9] = 1;
    expect(input.sample(diagonal, 99)).toEqual(["left", "up"]);
  });
});
