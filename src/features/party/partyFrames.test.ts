import { describe, expect, it } from "vitest";
import { isRawPartyFrame, rawPartyFrame } from "./partyFrames";

function packet(width: number, height: number, pixels = width * height * 4) {
  const data = new ArrayBuffer(9 + pixels);
  const header = new DataView(data);
  header.setUint8(0, 4);
  header.setUint32(1, width, true);
  header.setUint32(5, height, true);
  return data;
}

describe("local Party frames", () => {
  it("reads native dimensions and RGBA pixels without copying or swapping channels", () => {
    const data = packet(2, 1);
    new Uint8Array(data, 9).set([10, 20, 30, 255, 40, 50, 60, 255]);
    const frame = rawPartyFrame(data)!;
    expect([frame.width, frame.height]).toEqual([2, 1]);
    expect([...frame.pixels]).toEqual([10, 20, 30, 255, 40, 50, 60, 255]);
    expect(frame.pixels.buffer).toBe(data);
    expect(frame.format).toBe("RGBX");
  });
  it("keeps a core's own BGRX byte order under tag 5", () => {
    const data = packet(1, 1);
    new Uint8Array(data)[0] = 5;
    expect(rawPartyFrame(data)?.format).toBe("BGRX");
    expect(isRawPartyFrame(5)).toBe(true);
    expect(isRawPartyFrame(3)).toBe(false);
  });
  it("rejects malformed lengths, empty sizes and oversized frames", () => {
    for (const data of [
      new ArrayBuffer(0),
      new ArrayBuffer(8),
      packet(0, 1),
      packet(1280, 720, 4),
      packet(1, 1, 5),
      packet(0xffffffff, 0xffffffff, 0),
    ])
      expect(rawPartyFrame(data)).toBeNull();
    const other = packet(1, 1);
    new Uint8Array(other)[0] = 3;
    expect(rawPartyFrame(other)).toBeNull();
  });
});
