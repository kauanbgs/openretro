import { describe, expect, it } from "vitest";
import { microphoneFailure, voiceTransceiver } from "./partyVoice";

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
});
