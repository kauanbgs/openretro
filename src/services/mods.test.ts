import { describe, expect, it } from "vitest";
import catalog from "../db/mods-catalog.json";
import {
  catalogListings,
  installTargets,
  languageLabel,
  normalizeTitle,
  playedSha256,
} from "./mods";
import type { LibraryItem, ModListing } from "../types";

describe("mods catalog", () => {
  it("lists entries by console and title, never by title alone", () => {
    const alttp = catalogListings(
      "The Legend of Zelda: A Link to the Past",
      "snes",
    );
    expect(alttp.map((l) => l.entry.id).sort()).toEqual([
      "shadowone333.alttp-redux.10.2.4",
      "shadowone333.alttp-retranslation-redux.10.2.4",
    ]);
    expect(alttp.every((l) => l.compatibility === null)).toBe(true);
    expect(
      catalogListings("The Legend of Zelda: A Link to the Past", "gba"),
    ).toEqual([]);
    expect(catalogListings("Medabots - Metabee", "gba")).toHaveLength(1);
    expect(catalogListings("Legend of Zelda", "nes")[0].entry.id).toBe(
      "shadowone333.zelda1-redux.3.3.3",
    );
  });
  it("credits authors and pins every direct download", () => {
    for (const entry of catalog.entries) {
      expect(entry.authors.length).toBeGreaterThan(0);
      expect(entry.sourceUrl).toMatch(/^https:\/\//);
      if (entry.distribution === "direct") {
        expect(entry.patch.url).toMatch(/^https:\/\//);
        expect(entry.patch.sha256).toMatch(/^[0-9a-f]{64}$/);
      }
      expect(Object.keys(entry.base).length).toBeGreaterThan(0);
    }
  });
  it("normalizes punctuation and leading articles", () => {
    expect(normalizeTitle("The Legend of Zelda: A Link to the Past")).toBe(
      "legend of zelda a link to the past",
    );
    expect(normalizeTitle("Zelda II - The Adventure of Link")).toBe(
      "zelda ii the adventure of link",
    );
  });
});

describe("versions", () => {
  const item = { sha256: "a".repeat(64) } as LibraryItem;
  it("online play uses the selected version's hash", () => {
    expect(playedSha256(item)).toBe("a".repeat(64));
    expect(
      playedSha256({
        ...item,
        activeVariant: {
          id: "v",
          name: "Tradução",
          path: "x",
          sha256: "b".repeat(64),
          savesShared: false,
        },
      }),
    ).toBe("b".repeat(64));
  });
  it("only offers to combine patches the catalog confirms", () => {
    const listing = {
      compatibility: { status: "incompatible", reason: "", stripHeader: false },
      variantTargets: ["redux"],
    } as unknown as ModListing;
    expect(installTargets(listing)).toEqual(["redux"]);
    expect(
      installTargets({
        ...listing,
        compatibility: { status: "confirmed", reason: "", stripHeader: false },
        variantTargets: [],
      }),
    ).toEqual([null]);
  });
  it("names languages in Portuguese", () => {
    expect(languageLabel("pt-BR").toLowerCase()).toContain("português");
    expect(languageLabel("Portuguese, Spanish")).toBe("Portuguese, Spanish");
    expect(languageLabel(null)).toBe("Idioma não informado");
  });
});
