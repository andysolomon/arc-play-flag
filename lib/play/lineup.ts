/**
 * Lineups: versions of the roster (docs/adr/008-roster-depth-chart.md). The starting lineup is always
 * there, and the Secondary Lineup made from its depth charts; a coach branches any lineup into a copy and
 * changes it, so a day without a starter, or a different opponent, has its own roster without touching the
 * main one. Pure; storage reads and writes them in lib/play/storage.ts.
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
 * The Secondary Lineup is made, not kept: the starting lineup's depth charts with the next player up starting
 * at each position, the second unit a coach rotates in. It sits after the starting lineup wherever lineups are
 * listed. Ways that could go wrong:
 *
 * - S1 a position with nobody behind its starter: the starter keeps it, there being nobody else to play it.
 * - S2 one player next up at two positions on one side (Priya behind both X and Y): they can't start at both
 *   at once, so among the standard formation's positions nobody starts twice on a side. The positions take
 *   their starters a line down the charts at a time, one with fewer names first (so a position with only one
 *   choice gets it), then in roster order; one left with nobody free keeps its starter (S1). Offense and
 *   defense are apart: a player may start on both. A tag the formation lacks (FS, H) stands in for one of its
 *   positions on a play, so it takes its next player up as it is, never held against the others.
 * - S3 the starting lineup changed (a line moved, a player renamed or removed): the Secondary Lineup follows at
 *   once, being made from it on every read and never stored.
 * - S4 a change asked of it (its name, a depth chart, deleting it): nothing changes, and the panel offers none
 *   of it; a coach who wants it otherwise branches it.
 * - S5 a branch of it: a copy of its depth charts as made at that moment (V4), the coach's to change like any
 *   branch, and no longer following the starting lineup.
 * - S6 a device from before it, a backup, or a stored lineup claiming its id: nothing is stored for it but the
 *   pick (`active`) and a branch's `from`, so old lineups read as they were, a stored lineup with its id is
 *   dropped, and it does not count toward MAX_LINEUPS.
 */

import { MAX_DEPTH, MAX_NAME, cleanName, playerNames, renamedIn, sameName, withoutName } from "./roster";
import { defaults } from "./routes";
import type { Lineup, Lineups, Roster, Team } from "./types";

export const MAIN_LINEUP = "main";
export const MAIN_NAME = "Starting Lineup";
/** The Secondary Lineup's id: made from the starting lineup's depth charts, never stored (S6). */
export const SECOND_LINEUP = "second";
export const SECOND_NAME = "Secondary Lineup";
/** Lineups a team may keep; the Secondary Lineup, being made, is not counted (S6). */
export const MAX_LINEUPS = 20;
export const MAX_LINEUP_NAME = 40;
/** Players a team may hold. */
export const MAX_TEAM = 15;

export function defaultLineups(): Lineups {
  return { active: MAIN_LINEUP, lineups: [{ id: MAIN_LINEUP, name: MAIN_NAME, slots: [] }], players: [] };
}

/** The standard formation's positions by team and tag: the ones on the field together, so nobody starts at two (S2). */
const STANDARD = new Set(defaults().map((p) => `${p.team}:${p.label}`));

/**
 * A roster with the next player up starting at each position (S1): every depth chart moved up a line, its
 * starter to the foot, and nobody starting at two of the standard formation's positions on one side (S2).
 * Positions stay in the order they were.
 */
export function nextUp(roster: Roster): Roster {
  const turned = roster.map((s) => [...s.depth.slice(1), ...s.depth.slice(0, 1)]);
  const starts = new Map<number, string>();
  const sides: Team[] = ["offense", "defense"];
  for (const team of sides) {
    // the formation's positions on this side, fewer names first, then in roster order (the sort is stable)
    const at = roster.flatMap((s, i) => (s.team === team && STANDARD.has(`${team}:${s.tag}`) ? [i] : []))
      .sort((a, b) => (roster[a]?.depth.length ?? 0) - (roster[b]?.depth.length ?? 0));
    const taken: string[] = [];
    for (let line = 0; line < MAX_DEPTH; line++) {
      for (const i of at) {
        const who = turned[i]?.[line];
        if (who === undefined || starts.has(i) || taken.some((n) => sameName(n, who))) continue;
        starts.set(i, who);
        taken.push(who);
      }
    }
  }
  return roster.map((s, i) => {
    const line = turned[i] ?? [];
    // one with nobody free keeps its starter (S1); a tag the formation lacks takes its next player up as is
    const first = starts.get(i) ?? (STANDARD.has(`${s.team}:${s.tag}`) ? s.depth[0] : line[0]);
    const at = first === undefined ? -1 : line.indexOf(first);
    return { ...s, depth: at < 0 ? line : [...line.slice(at, at + 1), ...line.slice(0, at), ...line.slice(at + 1)] };
  });
}

/** The Secondary Lineup, made from the starting lineup's depth charts as they are now (S3). */
export function secondLineup(ls: Lineups): Lineup {
  const main = ls.lineups.find((l) => l.id === MAIN_LINEUP);
  return { id: SECOND_LINEUP, name: SECOND_NAME, from: MAIN_LINEUP, slots: nextUp(main?.slots ?? []) };
}

/** A lineup by id, the Secondary Lineup made fresh (S3); null when there is no such lineup. */
export function lineupOf(ls: Lineups, id: string | undefined): Lineup | null {
  if (id === SECOND_LINEUP) return secondLineup(ls);
  return ls.lineups.find((l) => l.id === id) ?? null;
}

/** Every lineup, as the menus list them: the Secondary Lineup straight after the starting lineup. */
export function allLineups(ls: Lineups): Lineup[] {
  const at = ls.lineups.findIndex((l) => l.id === MAIN_LINEUP) + 1;
  return [...ls.lineups.slice(0, at), secondLineup(ls), ...ls.lineups.slice(at)];
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
 * A new lineup, a copy of `fromId`'s slots (V4; the Secondary Lineup's as made now, S5), active at once. Null
 * when there is no such lineup or no room. Named "Lineup n", its place in the list, until the coach names it.
 */
export function branched(ls: Lineups, fromId: string, id: string): Lineups | null {
  const from = lineupOf(ls, fromId);
  if (!from || ls.lineups.length >= MAX_LINEUPS || lineupOf(ls, id)) return null;
  const lineup: Lineup = { id, name: `Lineup ${String(allLineups(ls).length + 1)}`, from: from.id, slots: from.slots.map((s) => ({ ...s, depth: [...s.depth] })) };
  return { ...ls, active: id, lineups: [...ls.lineups, lineup] };
}

/**
 * The lineups without one; never the starting lineup (V1) or the Secondary Lineup (S4). Its branches forget
 * it (V3); the field falls back (V2).
 */
export function without(ls: Lineups, id: string): Lineups {
  const gone = lineupOf(ls, id);
  if (!gone || id === MAIN_LINEUP || id === SECOND_LINEUP) return ls;
  const lineups = ls.lineups.filter((l) => l.id !== id).map((l) => {
    if (l.from !== id) return l;
    const rest = { ...l };
    delete rest.from;
    return rest;
  });
  const back = gone.from !== undefined && lineupOf({ ...ls, lineups }, gone.from) ? gone.from : MAIN_LINEUP;
  return { ...ls, active: ls.active === id ? back : ls.active, lineups };
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

/** What a lineup was branched from (the Secondary Lineup made from), by name, or null for the starting lineup and an orphan. */
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
