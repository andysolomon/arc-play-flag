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
 */

import type { Lineup, Lineups, Roster } from "./types";

export const MAIN_LINEUP = "main";
export const MAIN_NAME = "Starting Lineup";
/** Lineups a team may keep. */
export const MAX_LINEUPS = 20;
export const MAX_LINEUP_NAME = 40;

export function defaultLineups(): Lineups {
  return { active: MAIN_LINEUP, lineups: [{ id: MAIN_LINEUP, name: MAIN_NAME, slots: [] }] };
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
  return { active: id, lineups: [...ls.lineups, lineup] };
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
  return { active, lineups };
}

/** What a lineup was branched from, by name, or null for the starting lineup and an orphan. */
export function fromName(ls: Lineups, l: Lineup): string | null {
  const parent = lineupOf(ls, l.from);
  return parent ? lineupName(parent) : null;
}
