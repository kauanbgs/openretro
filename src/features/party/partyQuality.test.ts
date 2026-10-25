import { describe, expect, it, vi } from "vitest";
import { configurePartyVideo, tunePartyReceiver } from "./partyQuality";

describe("Party video quality", () => {
  it("keeps the negotiated encoding and lets congestion control balance clarity and motion", async () => {
    const parameters = {
      transactionId: "negotiated",
      encodings: [{ rid: "game", active: true }],
    };
    const sender = {
      getParameters: () => parameters,
      setParameters: vi.fn().mockResolvedValue(undefined),
    };
    await configurePartyVideo(sender as unknown as RTCRtpSender);
    expect(sender.setParameters).toHaveBeenCalledWith({
      transactionId: "negotiated",
      encodings: [
        { rid: "game", active: true, maxBitrate: 8_000_000, maxFramerate: 60 },
      ],
      degradationPreference: "balanced",
    });
  });

  it("retries with a fresh transaction when a WebView rejects the preference", async () => {
    const sender = {
      getParameters: vi
        .fn()
        .mockReturnValueOnce({ transactionId: "first", encodings: [{}] })
        .mockReturnValueOnce({ transactionId: "retry", encodings: [{}] }),
      setParameters: vi
        .fn()
        .mockRejectedValueOnce(new Error("unsupported preference"))
        .mockResolvedValueOnce(undefined),
    };
    await configurePartyVideo(sender as unknown as RTCRtpSender);
    expect(sender.setParameters).toHaveBeenLastCalledWith({
      transactionId: "retry",
      encodings: [{ maxBitrate: 8_000_000, maxFramerate: 60 }],
    });
  });

  it("does not abort admission when tuning is unsupported or no encoding exists", async () => {
    const sender = {
      getParameters: () => ({ encodings: [{}] }),
      setParameters: vi.fn().mockRejectedValue(new Error("unsupported")),
    };
    await expect(
      configurePartyVideo(sender as unknown as RTCRtpSender),
    ).resolves.toBeUndefined();
    sender.getParameters = () => ({ encodings: [] });
    sender.setParameters.mockClear();
    await configurePartyVideo(sender as unknown as RTCRtpSender);
    expect(sender.setParameters).not.toHaveBeenCalled();
  });

  it.each(["audio", "video"])(
    "uses seconds for legacy %s delay hints",
    (kind) => {
      const receiver = { track: { kind }, playoutDelayHint: 0 };
      tunePartyReceiver(receiver as unknown as RTCRtpReceiver);
      expect(receiver.playoutDelayHint).toBe(kind === "video" ? 0.02 : 0.04);
    },
  );

  it("tolerates read-only receiver hints", () => {
    const receiver = Object.freeze({
      track: { kind: "video" },
      jitterBufferTarget: 100,
    });
    expect(() =>
      tunePartyReceiver(receiver as unknown as RTCRtpReceiver),
    ).not.toThrow();
  });
});
