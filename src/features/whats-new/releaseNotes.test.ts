import { describe, expect, it } from "vitest";
import { releaseNoteFor } from "./releaseNotes";

describe("releaseNoteFor", () => {
  it("keeps the 1.0 news through every 1.x release until 2.0", () => {
    for (const version of ["1.0.0", "1.0.1", "1.2.0", "1.10.3"])
      expect(releaseNoteFor(version)?.version).toBe("1.0.0");
    expect(releaseNoteFor("2.0.0")).toBeNull();
    expect(releaseNoteFor("0.9.7")).toBeNull();
  });
});
