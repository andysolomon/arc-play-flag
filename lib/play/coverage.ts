import type { Player, RouteType } from "./types";

/** The coverage family a defensive call reads as. */
export type Coverage = "man" | "zone" | "mixed";

const UNDER: ReadonlySet<RouteType> = new Set(["zoneFlat", "curlFlat", "midRead"]);

/**
 * What a defensive call plays, tagged the way a Madden play card is: MAN when defenders each
 * cover a receiver and nobody sits in an underneath zone (deep help does not change it, so a
 * cover 1 or two-man-under call is man), ZONE when defenders only play zones, and MAN + ZONE
 * when man and underneath zones are mixed. Blitz, spy and custom routes are neutral. Null when
 * no defender covers anyone.
 */
export function coverageOf(players: readonly Player[]): Coverage | null {
  let man = 0, under = 0, deep = 0;
  for (const p of players) {
    const t = p.team === "defense" ? p.route?.type : undefined;
    if (t === "man") man++;
    else if (t === "zoneDeep") deep++;
    else if (t && UNDER.has(t)) under++;
  }
  if (man) return under ? "mixed" : "man";
  return under || deep ? "zone" : null;
}

/** The tag in the corner of the play's picture. */
export const COVERAGE_TAG: Record<Coverage, string> = { man: "MAN", zone: "ZONE", mixed: "MAN + ZONE" };

/** The family in a sentence: "Defense, man and zone coverage." */
export const COVERAGE_WORDS: Record<Coverage, string> = { man: "man", zone: "zone", mixed: "man and zone" };
