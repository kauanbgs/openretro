import { describe, expect, it } from "vitest";
import { releaseHistory, releaseNoteFor } from "./releaseNotes";

describe("releaseNoteFor", () => {
  it("keeps the newest 1.x news through every 1.x release until 2.0", () => {
    for (const version of ["1.0.0", "1.0.1"])
      expect(releaseNoteFor(version)?.version).toBe("1.0.0");
    for (const version of ["1.1.0", "1.1.2"])
      expect(releaseNoteFor(version)?.version).toBe("1.1.0");
    for (const version of ["1.2.0", "1.2.9"])
      expect(releaseNoteFor(version)?.version).toBe("1.2.0");
    for (const version of ["1.3.0", "1.3.1", "1.10.3"])
      expect(releaseNoteFor(version)?.version).toBe("1.3.0");
    expect(releaseNoteFor("2.0.0")).toBeNull();
    expect(releaseNoteFor("0.9.7")).toBeNull();
  });
});

describe("releaseHistory", () => {
  it("lists every version up to the installed one, newest first", () => {
    expect(releaseHistory("1.3.0").map((x) => x.version)).toEqual([
      "1.3.0",
      "1.2.0",
      "1.1.0",
      "1.0.0",
    ]);
    expect(releaseHistory("1.1.4").map((x) => x.version)).toEqual([
      "1.1.0",
      "1.0.0",
    ]);
  });
});
