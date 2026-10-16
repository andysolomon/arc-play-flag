/**
 * Lineups: versions of the roster (docs/adr/008-roster-depth-chart.md). The starting lineup is always
 * there; a coach branches any lineup into a copy and changes it, so a day without a starter, or a
 * different opponent, has its own roster without touching the main one. Pure; storage reads and writes
 * them in lib/play/storage.ts.
 *
 * Ways it could go wrong, written down before the code:
 *
 * - V1 the starting lineup deleted or missing: it can't be deleted, and a stored set without it gets
 *   it back, empty, at the front.
 * - V2 the active lineup gone (deleted, or a stored id nobody has): the field falls back to the
 *   lineup it was branched from, else the starting lineup.
 * - V3 a lineup deleted that others were branched from: they stay, and forget their parent.
 * - V4 a branch of a branch: it copies the slots of the lineup it was made from, not the main one.
 * - V5 a blank name: kept as typed while the coach writes it; the list shows "Untitled lineup".
 * - V6 names turned on with no roster: there is nothing to show, so the switch waits for a roster (it is
 *   disabled in Play tools until some depth chart has a name), and a stored flag with no roster behind it is
 *   dropped on read, so the last name taken off a lineup turns the names off with it.
 *
 * The team's players are one list, the same on every lineup: a player joins the team by name, and a
 * depth chart is filled from it. Ways that could go wrong:
 *
 * - T1 a player added with nowhere to play yet: on the team by name, listed with no position.
 * - T2 a name added twice, or typed two ways ("devon", "Devon "): one player (R7); the second add is
 *   nothing, and the panel opens the page already there.
 * - T3 a blank name added, or a player renamed to blank: nobody; nothing changes.
 * - T4 a player removed from the team: off the list and off every depth chart on every lineup (R8). It
 *   is not undoable, so the panel asks once.
 * - T5 a player put at a position, from their page or from the depth chart's chooser: only those not down
 *   for it yet are offered, a name typed two ways counting as there (R7), and a player left off this
 *   lineup for a day is still offered, being on the team; the pick goes at the bottom, never past eight
 *   lines. One who holds the position already, or a full chart, changes nothing.
 * - T6 a name on a depth chart that is not on the team's list (typed on a chart before there was one):
 *   it joins the team when the lineups are read, so taking it off its chart keeps it on the team.
 * - T7 a player renamed to the name of another player on the team: refused, so two players never
 *   merge; renamed to their own name in other letters ("devon" to "Devon"): allowed. A rename follows
 *   them onto every depth chart on every lineup.
 * - T8 the team full, fifteen players (MAX_TEAM): no more can join until one is removed. A device whose
 *   depth charts already hold more names than that (typed before the team's list, T6) keeps every one of
 *   them, and is full until it is back under.
 *
 * The standard formation roster mode lays out is the team's too: a coach drags a position, or steps it
 * with the arrow keys, to stand it where they like. Ways that could go wrong:
 *
 * - F1 a position dragged off the field, or over the line of scrimmage: held to its own side, at least
 *   LOS_GAP off the line and inside the sidelines, as a player on a play is; a stored spot past that is
 *   pulled back when read.
 * - F2 a position dropped back on its home spot: nothing is kept for it, so a formation with nothing moved
 *   stores nothing and Reset spots has nothing to do.
 * - F3 a spot for a tag the standard formation has no token for (FS, H, a tag stored by hand): it has
 *   nowhere to stand, since such a position is never drawn (R9), so it is dropped.
 * - F4 two spots stored for one position: the first is kept, as a second slot for a tag is ignored.
 * - F5 a spot that is not a number (missing, NaN, a string, Infinity): dropped; the position stands at home.
 * - F6 the play open behind roster mode: never moved. A spot is the roster's alone, never written into a
 *   play, its history, a share link, a playbook file or a picture, and leaving roster mode brings the play
 *   back as it was.
 * - F7 a position moved with one lineup active: moved on every lineup, like the team, so a branch stands
 *   where the lineup it came from does.
 * - F8 Reset spots: every position on the sides on view goes home in one write. It is not undoable, so the
 *   panel asks once.
 */

import { MAX_NAME, cleanName, playerNames, renamedIn, sameName, withoutName } from "./roster";
import { LOS_GAP, X_MAX, X_MIN, Y_MAX, Y_MIN, defaults } from "./routes";
import type { Lineup, Lineups, Player, Roster, Spot, Team } from "./types";

export const MAIN_LINEUP = "main";
export const MAIN_NAME = "Starting Lineup";
/** Lineups a team may keep. */
export const MAX_LINEUPS = 20;
export const MAX_LINEUP_NAME = 40;
/** Players a team may hold. */
export const MAX_TEAM = 15;

export function defaultLineups(): Lineups {
  return { active: MAIN_LINEUP, lineups: [{ id: MAIN_LINEUP, name: MAIN_NAME, slots: [] }], players: [] };
}

export function lineupOf(ls: Lineups, id: string | undefined): Lineup | null {
  return ls.lineups.find((l) => l.id === id) ?? null;
}

/** The lineup the field shows: the active one, else its parent, else the starting lineup, else the first (V2). */
export function activeLineup(ls: Lineups): Lineup {
  const picked = lineupOf(ls, ls.active);
  if (picked) return picked;
  const main = lineupOf(ls, MAIN_LINEUP) ?? ls.lineups[0];
  if (!main) return defaultLineups().lineups[0] as Lineup;
  return main;
}

/** A lineup's name for a list, "Untitled lineup" while it is blank (V5). */
export const lineupName = (l: Lineup): string => l.name.trim() || "Untitled lineup";

export function withActive(ls: Lineups, id: string): Lineups {
  return lineupOf(ls, id) ? { ...ls, active: id } : ls;
}

export function withSlots(ls: Lineups, id: string, slots: Roster): Lineups {
  return { ...ls, lineups: ls.lineups.map((l) => (l.id === id ? { ...l, slots } : l)) };
}

export function renamed(ls: Lineups, id: string, name: string): Lineups {
  return { ...ls, lineups: ls.lineups.map((l) => (l.id === id ? { ...l, name: name.slice(0, MAX_LINEUP_NAME) } : l)) };
}

/**
 * A new lineup, a copy of `fromId`'s slots (V4), active at once. Null when there is no such lineup or no
 * room. Named "Lineup n" until the coach names it.
 */
export function branched(ls: Lineups, fromId: string, id: string): Lineups | null {
  const from = lineupOf(ls, fromId);
  if (!from || ls.lineups.length >= MAX_LINEUPS || lineupOf(ls, id)) return null;
  const lineup: Lineup = { id, name: `Lineup ${String(ls.lineups.length + 1)}`, from: from.id, slots: from.slots.map((s) => ({ ...s, depth: [...s.depth] })) };
  return { ...ls, active: id, lineups: [...ls.lineups, lineup] };
}

/** The lineups without one; never the starting lineup (V1). Its branches forget it (V3); the field falls back (V2). */
export function without(ls: Lineups, id: string): Lineups {
  const gone = lineupOf(ls, id);
  if (!gone || id === MAIN_LINEUP) return ls;
  const lineups = ls.lineups.filter((l) => l.id !== id).map((l) => {
    if (l.from !== id) return l;
    const rest = { ...l };
    delete rest.from;
    return rest;
  });
  const active = ls.active === id ? (gone.from && lineups.some((l) => l.id === gone.from) ? gone.from : MAIN_LINEUP) : ls.active;
  return { ...ls, active, lineups };
}

/** Whether any depth chart on any lineup has a name on it: a starter to show on a play (V6). */
export function hasNames(ls: Lineups): boolean {
  return ls.lineups.some((l) => l.slots.some((s) => s.depth.some((n) => n.trim() !== "")));
}

/** Whether a play shows its starters' names: turned on, with a roster behind it (V6). */
export function showsNames(ls: Lineups): boolean {
  return ls.names === true && hasNames(ls);
}

/** The lineups with the names shown on plays or not; on only with a roster to show (V6). Everything else is kept. */
export function withNames(ls: Lineups, on: boolean): Lineups {
  const rest: Lineups = { ...ls };
  delete rest.names;
  return on && hasNames(ls) ? { ...rest, names: true } : rest;
}

/** What a lineup was branched from, by name, or null for the starting lineup and an orphan. */
export function fromName(ls: Lineups, l: Lineup): string | null {
  const parent = lineupOf(ls, l.from);
  return parent ? lineupName(parent) : null;
}

/** A name as it would join the team: control characters out, trimmed, cut to fit; "" when it is blank (T3). */
const asJoined = (name: string): string => cleanName(name).trim().slice(0, MAX_NAME);

/** Everyone on the team, each once (R7), in alphabetical order: the team's list and any name on a depth chart (T6). */
export function teamNames(ls: Lineups): string[] {
  return playerNames(ls.lineups.flatMap((l) => l.slots), ls.players);
}

/** The team's own spelling of a name, or null when nobody on the team goes by it (R7). */
export function onTeam(ls: Lineups, name: string): string | null {
  return teamNames(ls).find((n) => sameName(n, name)) ?? null;
}

/** Whether the team can take another player (T8). */
export const teamFull = (ls: Lineups): boolean => teamNames(ls).length >= MAX_TEAM;

/** The lineups with a player joining the team by name (T1). Null when the name is blank (T3), already on the team (T2), or the team is full (T8). */
export function withPlayer(ls: Lineups, name: string): Lineups | null {
  const clean = asJoined(name);
  if (!clean || onTeam(ls, clean) !== null || teamFull(ls)) return null;
  return { ...ls, players: [...ls.players, clean] };
}

/** The lineups with a player off the team: off its list and off every depth chart on every lineup (T4, R8). */
export function withoutPlayer(ls: Lineups, name: string): Lineups {
  return {
    ...ls,
    players: ls.players.filter((n) => !sameName(n, name)),
    lineups: ls.lineups.map((l) => ({ ...l, slots: withoutName(l.slots, name) })),
  };
}

/**
 * The lineups with a player renamed, on the team's list and on every depth chart on every lineup (T7).
 * Null when the new name is blank (T3) or belongs to another player on the team (T7).
 */
export function renamedPlayer(ls: Lineups, from: string, to: string): Lineups | null {
  const clean = asJoined(to);
  if (!clean) return null;
  const other = onTeam(ls, clean);
  if (other !== null && !sameName(other, from)) return null;
  const listed = ls.players.some((n) => sameName(n, from));
  return {
    ...ls,
    players: listed ? ls.players.map((n) => (sameName(n, from) ? clean : n)) : [...ls.players, clean],
    lineups: ls.lineups.map((l) => ({ ...l, slots: renamedIn(l.slots, from, clean) })),
  };
}

/** The standard formation at its home spots, which roster mode lays out (docs/adr/008-roster-depth-chart.md). */
const HOME: readonly Player[] = defaults();

const sameSpot = (s: Spot, team: Team, tag: string): boolean => s.team === team && s.tag === tag;

/**
 * A position of the standard formation stood at a spot: held to its side of the line and inside the
 * sidelines (F1). Null when its tag has no token in the formation (F3), or when that is its home spot (F2).
 */
export function placedSpot(team: Team, tag: string, x: number, y: number): Spot | null {
  const home = HOME.find((p) => p.team === team && p.label === tag);
  if (!home) return null;
  const sx = Math.max(X_MIN, Math.min(X_MAX, x));
  const sy = team === "offense" ? Math.max(LOS_GAP, Math.min(Y_MAX, y)) : Math.max(Y_MIN, Math.min(-LOS_GAP, y));
  if (Math.abs(sx - home.x) < 0.01 && Math.abs(sy - home.y) < 0.01) return null;
  return { team, tag, x: sx, y: sy };
}

/** The lineups with these spots: stored only once a position has moved (F2). Everything else is kept. */
function withSpots(ls: Lineups, spots: readonly Spot[]): Lineups {
  const rest: Lineups = { ...ls };
  delete rest.spots;
  return spots.length ? { ...rest, spots: [...spots] } : rest;
}

/**
 * The lineups with a position of the standard formation stood where it was dropped, the same on every
 * lineup (F7): in place for one moved before, at the end for one moving off home, and gone when it is
 * dropped back home (F2). A tag the formation has no token for moves nothing (F3).
 */
export function withSpot(ls: Lineups, team: Team, tag: string, x: number, y: number): Lineups {
  const spot = placedSpot(team, tag, x, y);
  const spots = ls.spots ?? [];
  if (!spot) return withSpots(ls, spots.filter((s) => !sameSpot(s, team, tag)));
  return withSpots(ls, spots.some((s) => sameSpot(s, team, tag)) ? spots.map((s) => (sameSpot(s, team, tag) ? spot : s)) : [...spots, spot]);
}

/** The lineups with every position on these sides back at its home spot, in one write (F8). */
export function withoutSpots(ls: Lineups, teams: readonly Team[]): Lineups {
  return withSpots(ls, (ls.spots ?? []).filter((s) => !teams.includes(s.team)));
}

/** Whether any position on these sides stands off its home spot: something for Reset spots to do (F8). */
export function hasSpots(ls: Lineups, teams: readonly Team[]): boolean {
  return (ls.spots ?? []).some((s) => teams.includes(s.team));
}

/** The standard formation as the coach has stood it: each position at its spot, else at home. The ids are the formation's own. */
export function formationOf(ls: Lineups): Player[] {
  return HOME.map((p) => {
    const spot = ls.spots?.find((s) => sameSpot(s, p.team, p.label));
    return spot ? { ...p, x: spot.x, y: spot.y } : { ...p };
  });
}
