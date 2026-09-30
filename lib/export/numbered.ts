import type { Player, Playbook, SavedPlay, Team, Vis } from "@/lib/play/types";

/**
 * Which team a playbook drawing shows: this play's side, both teams when the play includes the
 * other one (drawn faded), unless a coach overrode it.
 */
export function playShow(play: SavedPlay, vis?: Vis): Vis {
  return vis ?? (play.artShadow ? "both" : play.side);
}

/** The art options that draw a play as its pictures should: who is shown, and whose side it is. */
export function artView(play: SavedPlay, vis?: Vis): { show: Vis; side: Team } {
  return { show: playShow(play, vis), side: play.side };
}

/** A play with its number: its position in the playbook, counted from 1. */
export interface Numbered {
  n: number;
  play: SavedPlay;
}

/** The playbook's plays in order, skipping ids that no longer exist. */
export function numbered(book: Playbook, library: readonly SavedPlay[]): Numbered[] {
  const byId = new Map(library.map((p) => [p.id, p]));
  const out: Numbered[] = [];
  for (const id of book.plays) {
    const play = byId.get(id);
    if (play) out.push({ n: out.length + 1, play });
  }
  return out;
}

/** A player's place on a wristband: their tag on one side of the ball. */
export interface Position {
  team: Team;
  label: string;
}

/** A player who gets a wristband insert of their own: tagged, on the play's own side, and not the quarterback. */
const banded = (play: SavedPlay, p: Player): boolean =>
  p.team === play.side && !!p.label && !(p.team === "offense" && p.label === "QB");

/**
 * The positions across a set of plays, in order of first appearance. Each play gives the
 * players on its own side, so a defensive call gives its defenders and never the shadow
 * offense it carries. The quarterback and untagged players get no band of their own.
 */
export function positionsOf(plays: readonly Numbered[]): Position[] {
  const seen: Position[] = [];
  for (const { play } of plays) {
    for (const p of play.players) {
      if (!banded(play, p) || seen.some((s) => s.team === p.team && s.label === p.label)) continue;
      seen.push({ team: p.team, label: p.label });
    }
  }
  return seen;
}

/** The id of the player holding `position` in a play, or null when the play is the other side's or has no such tag. */
export function playerAt(play: SavedPlay, position: Position | null): string | null {
  if (!position || position.team !== play.side) return null;
  return play.players.find((p) => p.team === position.team && p.label === position.label)?.id ?? null;
}

/** A position's name on its insert: the tag, and whose it is when the other side uses the same tag. */
export function positionName(position: Position, all: readonly Position[]): string {
  return all.some((q) => q.team !== position.team && q.label === position.label) ? `${position.label} (${position.team})` : position.label;
}

/** The plays with an untagged player on their own side, who prints only on the unhighlighted insert. */
export function untagged(plays: readonly Numbered[]): Numbered[] {
  return plays.filter(({ play }) => play.players.some((p) => p.team === play.side && !p.label));
}
