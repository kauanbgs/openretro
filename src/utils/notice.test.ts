import { describe, expect, it } from "vitest";
import { failed, readNotice } from "./notice";

describe("notices", () => {
  it("marks thrown errors and plain rejections the same way", () => {
    expect(failed(new Error("sem conexão"))).toBe("Error: sem conexão");
    expect(failed("sem conexão")).toBe("Error: sem conexão");
    expect(failed("TypeError: Error: sem conexão")).toBe("Error: sem conexão");
  });

  it("reads a failure back without the prefix", () => {
    expect(readNotice(failed("sem conexão"))).toEqual({
      text: "sem conexão",
      failed: true,
    });
  });

  it("leaves confirmations alone", () => {
    expect(readNotice("Jogo adicionado.")).toEqual({
      text: "Jogo adicionado.",
      failed: false,
    });
  });
});
