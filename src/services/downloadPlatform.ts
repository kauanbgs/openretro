import type { SourceMatch } from "../types";

/**
 * Consoles a release names in its title or links, such as "PS3-Redump" in an
 * archive.org path. Sources search by title only, and the same game usually
 * exists on several consoles.
 */
const consoles: [string, RegExp][] = [
  ["ps2", /\b(ps2|playstation 2)\b/],
  ["ps3", /\b(ps3|playstation 3)\b/],
  ["ps4", /\b(ps4|playstation 4)\b/],
  ["ps5", /\b(ps5|playstation 5)\b/],
  ["vita", /\b(ps ?vita|psv)\b/],
  ["psp", /\b(psp|playstation portable)\b/],
  [
    "psx",
    /\b(psx|ps1|playstation 1|playstation(?! ?(2|3|4|5|portable|vita)\b))\b/,
  ],
  ["wiiu", /\bwii ?u\b/],
  ["wii", /\bwii\b(?! ?u\b)/],
  ["gamecube", /\b(gamecube|ngc|gcn)\b/],
  ["xbox360", /\b(xbox ?360|x360)\b/],
  ["xboxone", /\bxbox (one|series)\b/],
  ["xbox", /\bxbox\b(?! ?(360|one|series)\b)/],
  ["switch", /\b(nintendo switch|nsw)\b/],
  ["n64", /\b(n64|nintendo 64)\b/],
  ["nds", /\b(nds|nintendo ds)\b/],
  ["gba", /\b(gba|game ?boy advance)\b/],
  ["gbc", /\b(gbc|game ?boy colou?r)\b/],
  ["gb", /\bgame ?boy\b(?! ?(advance|colou?r)\b)/],
  ["snes", /\b(snes|super nintendo|super famicom)\b/],
  ["nes", /\b(nes|famicom)\b/],
  ["genesis", /\b(genesis|mega ?drive)\b/],
  ["sms", /\bmaster system\b/],
  ["gg", /\bgame ?gear\b/],
  ["dos", /\bms-?dos\b/],
];

function text(match: Pick<SourceMatch, "title" | "uris">) {
  const links = match.uris.map((uri) => {
    try {
      return decodeURIComponent(uri);
    } catch {
      return uri;
    }
  });
  return [match.title, ...links].join(" ").toLowerCase().replace(/[_+]/g, " ");
}

export function namedConsoles(
  match: Pick<SourceMatch, "title" | "uris">,
): string[] {
  const haystack = text(match);
  return consoles
    .filter(([, pattern]) => pattern.test(haystack))
    .map(([id]) => id);
}

/**
 * Drops releases that name only other consoles and lists the ones confirmed
 * for this console first; releases that name no console stay, after those.
 * Consoles in the game's own title, as in "Sonic Genesis", say nothing.
 */
export function releasesFor(
  matches: SourceMatch[],
  game: { title: string; platformId: string },
) {
  const platformId = game.platformId;
  const inTitle = namedConsoles({ title: game.title, uris: [] });
  const ranked = matches.flatMap((match) => {
    const named = namedConsoles(match).filter((id) => !inTitle.includes(id));
    if (named.length && !named.includes(platformId)) return [];
    return [{ match, confirmed: named.length > 0 }];
  });
  return [
    ...ranked.filter((r) => r.confirmed),
    ...ranked.filter((r) => !r.confirmed),
  ].map(({ match, confirmed }) => ({ ...match, confirmed }));
}

export type PlatformRelease = ReturnType<typeof releasesFor>[number];
