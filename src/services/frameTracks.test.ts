import { describe, expect, it } from "vitest";
import { encodedSize, viewBounds } from "./frameTracks";

describe("game frames as video tracks", () => {
  it("crops the same regions as the server's JPEG views", () => {
    // Matches video.rs: odd frames split without losing a row or column.
    expect(viewBounds({ layout: "sideBySide", region: 2 }, 641, 481)).toEqual([
      320, 0, 641, 481,
    ]);
    expect(viewBounds({ layout: "stacked", region: 2 }, 641, 481)).toEqual([
      0, 240, 641, 481,
    ]);
    expect(viewBounds({ layout: "grid", region: 4 }, 641, 481)).toEqual([
      320, 240, 641, 481,
    ]);
    for (const region of [0, 3, 255])
      expect(viewBounds({ layout: "stacked", region }, 640, 480)).toEqual([
        0, 0, 640, 480,
      ]);
    expect(viewBounds({ layout: "full", region: 0 }, 256, 224)).toEqual([
      0, 0, 256, 224,
    ]);
  });

  it("grows small frames by whole pixels to even sizes within 720p", () => {
    expect(encodedSize(256, 224)).toEqual([768, 672]);
    expect(encodedSize(1280, 720)).toEqual([1280, 720]);
    expect(encodedSize(1920, 1080)).toEqual([1920, 1080]);
    // An odd crop that cannot grow loses one column and row instead.
    expect(encodedSize(321, 481)).toEqual([320, 480]);
    expect(encodedSize(161, 120)).toEqual([966, 720]);
    expect(encodedSize(1, 1)).toEqual([720, 720]);
  });
});
