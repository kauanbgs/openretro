import { describe, expect, it } from "vitest";
import { buildIgdbQuery, sanitizeIgdbReply } from "../server/igdb";
describe("IGDB backend query boundary", () => {
  const base = { kind: "games", ids: [19], page: 1 };
  it("escapes search text as a string literal", () => {
    const query = 'Mario "; where id > 0;';
    expect(buildIgdbQuery({ ...base, query }).body).toContain(
      `search ${JSON.stringify(query)};`,
    );
  });
  it("performs genres and sort remotely, with stable pagination", () => {
    const result = buildIgdbQuery({
      ...base,
      genreId: 12,
      sort: "rating",
      page: 2,
    });
    expect(result.endpoint).toBe("games");
    expect(result.body).toContain("genres = (12)");
    expect(result.body).toContain("total_rating_count >= 5");
    expect(result.body).toContain("offset 24;");
  });
  it("rejects arbitrary endpoints, interpolated identifiers and out-of-bounds pages", () => {
    for (const input of [
      { ...base, kind: "../oauth" },
      { ...base, ids: ["18); where id>0"] },
      { ...base, page: 0 },
      { ...base, page: 1001 },
      { ...base, genreId: -1 },
      { ...base, sort: "toString" },
    ])
      expect(() => buildIgdbQuery(input)).toThrow();
  });
  it("does not let a search trigger an incompatible sort clause", () =>
    expect(
      buildIgdbQuery({ ...base, query: "Mario", sort: "rating" }).body,
    ).not.toContain("sort "));
  it("uses the lookahead item without duplicating it in the current page", () => {
    const result = sanitizeIgdbReply(
      Array.from({ length: 25 }, (_, id) => ({ id })),
      base,
    );
    expect(result.data.games).toHaveLength(24);
    expect(result.hasNext).toBe(true);
    expect(result.page).toBe(1);
  });
  it("does not pass through unexpected upstream metadata", () =>
    expect(() => sanitizeIgdbReply({ error: "untrusted" }, base)).toThrow());
});
