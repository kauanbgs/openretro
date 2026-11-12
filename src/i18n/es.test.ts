import { describe, expect, it } from "vitest";
import { en } from "./en";
import { pt } from "./pt";
import { es } from "./es";

describe("Spanish translations", () => {
  it("covers both existing source dictionaries and preserves placeholders", () => {
    for (const source of new Set([...Object.keys(en), ...Object.keys(pt)])) {
      expect(es[source], source).toBeTruthy();
      expect(es[source].match(/\{\w+\}/g)?.sort() ?? [], source).toEqual(
        source.match(/\{\w+\}/g)?.sort() ?? [],
      );
    }
  });
});
