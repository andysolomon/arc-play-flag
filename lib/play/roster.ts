/**
 * The roster: who plays each position, with depth (docs/adr/008-roster-depth-chart.md). A position is a
 * tag as it reads on the field, so the same roster serves every play: whoever is tagged X on a play is
 * played by X's starter. Pure; storage reads and writes it in lib/play/storage.ts.
 *
 * Ways it could go wrong, written down before the code:
 *
 * - R1 a tag renamed on a play: the player wears a tag with no slot and reads as unassigned; the old slot
 *   keeps its names for whoever wears that tag next. Nothing is moved or lost.
 * - R2 a blank line on the depth chart: kept as typed while the coach fills it in, so a space typed in a
 *   name is never trimmed away under their fingers; a blank starter reads as unassigned on the field.
 * - R3 a slot with no lines left is dropped from the roster, so an empty depth chart stores nothing.
 * - R4 a name that would not fit under a token is shortened for the field only: the first word, or the
 *   first eleven letters and an ellipsis; the panel keeps the whole name.
 * - R5 two players wearing the same tag on one play share the slot and the starter's name.
 * - R6 a player with no tag has no slot: the panel asks for a tag first.
 * - R7 a name typed two ways ("devon", "Devon ") is one player: names are matched trimmed, without
 *   regard to case, and shown as first written.
 * - R8 a player picked from the team for a position: the team is everyone down on any of its lineups, so
 *   a player left off this lineup for a day is still offered; only those not already down for the
 *   position are offered, a name typed two ways counting as there (R7); the pick goes on the chart as
 *   first written (this lineup's spelling first), at the bottom, and never past the last line.
 */

import type { Player, Roster, RosterSlot, Team } from "./types";

/** Lines a position's depth chart may hold. */
export const MAX_DEPTH = 8;
/** Positions a roster may hold: both sides of a 5v5 team with room for the tags a coach adds. */
export const MAX_SLOTS = 30;
/** Letters in a name. */
export const MAX_NAME = 40;
/** Letters of a name that fit under a token on the field (R4). */
const CAPTION = 12;

const sameSlot = (s: RosterSlot, team: Team, tag: string): boolean => s.team === team && s.tag === tag;

/** The slot for a tag on a team, or null when nobody is down for it. */
export function slotOf(roster: Roster, team: Team, tag: string): RosterSlot | null {
  return roster.find((s) => sameSlot(s, team, tag)) ?? null;
}

/** The depth chart for a tag on a team, starter first; empty when nobody is down for it. */
export function depthOf(roster: Roster, team: Team, tag: string): readonly string[] {
  return slotOf(roster, team, tag)?.depth ?? [];
}

/** The starter's name, or null when the first line is blank or the position has nobody (R2). */
export function starterOf(roster: Roster, team: Team, tag: string): string | null {
  const first = depthOf(roster, team, tag)[0]?.trim() ?? "";
  return first || null;
}

/**
 * The roster with a position's depth chart replaced: in place for a slot already there, at the end for a
 * new one, and gone when no lines are left (R3). A tag with no letters names no position (R6).
 */
export function withDepth(roster: Roster, team: Team, tag: string, depth: readonly string[]): Roster {
  if (!tag) return roster;
  const lines = depth.slice(0, MAX_DEPTH).map(cleanName);
  const rest = roster.filter((s) => !sameSlot(s, team, tag));
  if (!lines.length) return rest;
  const at = roster.findIndex((s) => sameSlot(s, team, tag));
  const slot: RosterSlot = { team, tag, depth: lines };
  if (at < 0) return [...rest, slot];
  return roster.map((s) => (sameSlot(s, team, tag) ? slot : s));
}

/** A name as stored: control characters out, at most MAX_NAME letters, spaces kept as typed (R2). */
export function cleanName(v: unknown): string {
  return typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, MAX_NAME) : "";
}

/** A name as it fits under a token (R4): whole when short, else the first word, else cut with an ellipsis. */
export function shortName(name: string): string {
  const whole = name.trim();
  if (whole.length <= CAPTION) return whole;
  const first = whole.split(/\s+/)[0] ?? "";
  if (first.length > 0 && first.length <= CAPTION) return first;
  return `${whole.slice(0, CAPTION - 1)}…`;
}

/** Each player's starter by id, shortened for the field; players with no tag or nobody down for it are left out. */
export function starters(roster: Roster, players: readonly Player[]): Readonly<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const p of players) {
    const who = p.label ? starterOf(roster, p.team, p.label) : null;
    if (who) out[p.id] = shortName(who);
  }
  return out;
}

/** "Starter", "2nd", "3rd", "4th"…: a line's place on the depth chart, for its label. */
export function depthWord(index: number): string {
  if (index === 0) return "Starter";
  const n = index + 1;
  const tail = n % 10 === 2 && n % 100 !== 12 ? "nd" : n % 10 === 3 && n % 100 !== 13 ? "rd" : "th";
  return `${String(n)}${tail}`;
}

/** A name as players are told apart (R7). */
const key = (name: string): string => name.trim().toLocaleLowerCase();

/** Everyone on the roster, each name once as first written, in alphabetical order; blank lines are nobody. */
export function playerNames(roster: Roster): string[] {
  const seen = new Map<string, string>();
  for (const slot of roster) {
    for (const name of slot.depth) {
      const k = key(name);
      if (k && !seen.has(k)) seen.set(k, name.trim());
    }
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}

/** Everyone on the team: each name once across all its lineups, the first lineup's spelling first (R8). */
export function teamNames(rosters: readonly Roster[]): string[] {
  return playerNames(rosters.flat());
}

/** Everyone on the team who is not down for a position yet, in alphabetical order (R8). */
export function available(team: readonly string[], depth: readonly string[]): string[] {
  const down = new Set(depth.map(key));
  return team.filter((name) => !down.has(key(name)));
}

/** The depth chart with a player from the lineup added at the bottom (R8); unchanged when they are on it or it is full. */
export function withPlayer(depth: readonly string[], name: string): readonly string[] {
  const k = key(name);
  if (!k || depth.length >= MAX_DEPTH || depth.some((n) => key(n) === k)) return depth;
  return [...depth, name.trim()];
}

/** One place a player holds: a position and how deep they sit at it (0 is the starter). */
export interface Standing {
  team: Team;
  tag: string;
  depth: number;
}

/** Every position a player is down for, in roster order, with where they sit at each (R7). */
export function standings(roster: Roster, name: string): Standing[] {
  const k = key(name);
  if (!k) return [];
  return roster.flatMap((slot) => {
    const at = slot.depth.findIndex((n) => key(n) === k);
    return at < 0 ? [] : [{ team: slot.team, tag: slot.tag, depth: at }];
  });
}
