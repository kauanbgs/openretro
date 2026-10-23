import { describe, expect, it, vi } from "vitest";
import { partyVideoCodecs, preferPartyVideoCodec } from "./partyCodecs";
const codec = (mimeType: string, sdpFmtpLine?: string): RTCRtpCodec => ({
  mimeType,
  clockRate: 90000,
  ...(sdpFmtpLine ? { sdpFmtpLine } : {}),
});
const vp8 = codec("video/VP8"),
  vp9 = codec("video/VP9", "profile-id=0"),
  vp9High = codec("video/VP9", "profile-id=2"),
  h264 = codec("video/H264"),
  rtx = codec("video/rtx", "apt=96"),
  red = codec("video/red"),
  fec = codec("video/ulpfec");

describe("Party video compression", () => {
  it("offers VP9 first without dropping fallback codecs or packet recovery", () => {
    const available = [vp8, rtx, h264, vp9High, red, vp9, fec];
    const ordered = partyVideoCodecs(available, available);
    expect(ordered).toEqual([vp9, vp9High, vp8, rtx, h264, red, fec]);
    expect(ordered).toHaveLength(available.length);
    expect(available[0]).toBe(vp8);
    expect(ordered[0]).toBe(vp9);
  });
  it("only prefers profiles the host can actually encode", () => {
    expect(partyVideoCodecs([vp8, vp9], [vp8, vp9High, vp9])).toEqual([
      vp9,
      vp8,
      vp9High,
    ]);
    expect(partyVideoCodecs([vp8], [vp8, vp9])).toEqual([]);
  });
  it("compares MIME types and equivalent fmtp parameter order", () => {
    const sender = codec("video/vp9", "profile-id=0; x-test=1");
    const receiver = codec("video/VP9", "x-test=1;profile-id=0");
    expect(partyVideoCodecs([sender], [vp8, receiver])).toEqual([
      receiver,
      vp8,
    ]);
  });
  it("keeps default negotiation if the API is absent, unsupported or rejected", () => {
    const caps = { codecs: [vp8, vp9] };
    expect(preferPartyVideoCodec({} as RTCRtpTransceiver, caps, caps)).toBe(
      false,
    );
    const setCodecPreferences = vi.fn(() => {
      throw new DOMException("Unsupported");
    });
    const transceiver = { setCodecPreferences } as unknown as RTCRtpTransceiver;
    expect(preferPartyVideoCodec(transceiver, null, caps)).toBe(false);
    expect(preferPartyVideoCodec(transceiver, caps, caps)).toBe(false);
    expect(setCodecPreferences).toHaveBeenCalledWith([vp9, vp8]);
  });
  it("applies preferences before the offer when supported", () => {
    const setCodecPreferences = vi.fn();
    expect(
      preferPartyVideoCodec(
        { setCodecPreferences } as unknown as RTCRtpTransceiver,
        { codecs: [vp8, vp9] },
        { codecs: [vp8, vp9, rtx] },
      ),
    ).toBe(true);
    expect(setCodecPreferences).toHaveBeenCalledWith([vp9, vp8, rtx]);
  });
});
