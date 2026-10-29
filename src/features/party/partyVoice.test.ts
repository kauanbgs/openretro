import { afterEach, describe, expect, it, vi } from "vitest";
import {
  chooseDevice,
  chosenDevice,
  microphoneFailure,
  openMicrophone,
  voiceTransceiver,
} from "./partyVoice";

const line = (kind: string) =>
  ({ receiver: { track: { kind } }, sender: { track: null } }) as never;

describe("party voice", () => {
  it("finds the second audio line, after the game's sound", () => {
    const [video, game, voice] = [line("video"), line("audio"), line("audio")];
    expect(
      voiceTransceiver({ getTransceivers: () => [video, game, voice] }),
    ).toBe(voice);
  });
  it("offers no voice when the host has a single audio line", () => {
    const lines = [line("video"), line("audio")];
    expect(voiceTransceiver({ getTransceivers: () => lines })).toBeUndefined();
    expect(voiceTransceiver({} as never)).toBeUndefined();
  });
  it("explains a blocked or missing microphone", () => {
    expect(microphoneFailure(new DOMException("", "NotAllowedError"))).toMatch(
      /bloqueado/,
    );
    expect(microphoneFailure(new DOMException("", "NotFoundError"))).toMatch(
      /Nenhum microfone/,
    );
    expect(microphoneFailure(new Error("x"))).toMatch(/Não foi possível/);
  });
  describe("chosen microphone", () => {
    afterEach(() => vi.unstubAllGlobals());
    const stream = { getAudioTracks: () => ["track"] };
    it("asks for the chosen device, and falls back when it is gone", async () => {
      const store = new Map<string, string>();
      vi.stubGlobal("localStorage", {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => store.set(k, v),
        removeItem: (k: string) => store.delete(k),
      });
      const getUserMedia = vi
        .fn()
        .mockRejectedValueOnce(new DOMException("", "OverconstrainedError"))
        .mockResolvedValue(stream);
      vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });
      chooseDevice("microphone", "headset");
      expect(chosenDevice("microphone")).toBe("headset");
      expect(await openMicrophone()).toBe("track");
      expect(getUserMedia.mock.calls[0][0].audio.deviceId).toEqual({
        exact: "headset",
      });
      expect(getUserMedia.mock.calls[1][0].audio.deviceId).toBeUndefined();
      // The unplugged headset is forgotten.
      expect(chosenDevice("microphone")).toBe("");
    });
    it("does not hide a refused permission behind the fallback", async () => {
      vi.stubGlobal("localStorage", {
        getItem: () => "headset",
        setItem() {},
        removeItem() {},
      });
      const getUserMedia = vi
        .fn()
        .mockRejectedValue(new DOMException("", "NotAllowedError"));
      vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });
      await expect(openMicrophone()).rejects.toThrow();
      expect(getUserMedia).toHaveBeenCalledOnce();
    });
  });
});
