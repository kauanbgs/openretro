import { describe, expect, it, vi } from "vitest";
import { h264VideoCodecs, preferH264VideoCodec } from "./partyCodecs";
const codec = (mimeType: string, sdpFmtpLine?: string): RTCRtpCodec => ({
  mimeType,
  clockRate: 90000,
  ...(sdpFmtpLine ? { sdpFmtpLine } : {}),
});
const vp8 = codec("video/VP8"),
  vp9 = codec("video/VP9", "profile-id=0"),
  high = codec(
    "video/H264",
    "level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=640c1f",
  ),
  single = codec(
    "video/H264",
    "level-asymmetry-allowed=1;packetization-mode=0;profile-level-id=42e01f",
  ),
  baseline = codec(
    "video/H264",
    "level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e01f",
  ),
  rtx = codec("video/rtx", "apt=96"),
  red = codec("video/red"),
  fec = codec("video/ulpfec");

describe("Party and phone video codecs", () => {
  it("offers baseline H.264 first without dropping fallbacks or packet recovery", () => {
    const available = [vp8, rtx, high, vp9, single, red, baseline, fec];
    const ordered = h264VideoCodecs(available, available);
    expect(ordered).toEqual([baseline, high, single, vp8, rtx, vp9, red, fec]);
    expect(ordered).toHaveLength(available.length);
    expect(available[0]).toBe(vp8);
  });
  it("only prefers profiles the PC can actually encode", () => {
    expect(h264VideoCodecs([vp8, high], [vp8, baseline, high])).toEqual([
      high,
      vp8,
      baseline,
    ]);
    expect(h264VideoCodecs([vp8], [vp8, baseline])).toEqual([]);
  });
  it("compares MIME types and equivalent fmtp parameter order", () => {
    const sender = codec(
      "video/h264",
      "profile-level-id=42e01f; packetization-mode=1",
    );
    const receiver = codec(
      "video/H264",
      "packetization-mode=1;profile-level-id=42e01f",
    );
    expect(h264VideoCodecs([sender], [vp8, receiver])).toEqual([receiver, vp8]);
  });
  it("keeps default negotiation if the API is absent, unsupported or rejected", () => {
    const caps = { codecs: [vp8, baseline] };
    expect(preferH264VideoCodec({} as RTCRtpTransceiver, caps, caps)).toBe(
      false,
    );
    const setCodecPreferences = vi.fn(() => {
      throw new DOMException("Unsupported");
    });
    const transceiver = { setCodecPreferences } as unknown as RTCRtpTransceiver;
    expect(preferH264VideoCodec(transceiver, null, caps)).toBe(false);
    expect(preferH264VideoCodec(transceiver, caps, caps)).toBe(false);
    expect(setCodecPreferences).toHaveBeenCalledWith([baseline, vp8]);
  });
  it("applies preferences before the offer when supported", () => {
    const setCodecPreferences = vi.fn();
    expect(
      preferH264VideoCodec(
        { setCodecPreferences } as unknown as RTCRtpTransceiver,
        { codecs: [vp8, baseline] },
        { codecs: [vp8, baseline, rtx] },
      ),
    ).toBe(true);
    expect(setCodecPreferences).toHaveBeenCalledWith([baseline, vp8, rtx]);
  });
});
