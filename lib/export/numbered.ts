import type { Playbook, SavedPlay } from "@/lib/play/types";

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

/**
 * The offensive positions across a set of plays, by label, in order of first appearance.
 * The quarterback and unlabelled players get no band of their own.
 */
export function positionsOf(plays: readonly Numbered[]): string[] {
  const seen: string[] = [];
  for (const { play } of plays) {
    for (const p of play.players) {
      if (p.team !== "offense" || !p.label || p.label === "QB" || seen.includes(p.label)) continue;
      seen.push(p.label);
    }
  }
  return seen;
}

/** The player id carrying `label` in a play, or null. */
export function playerWithLabel(play: SavedPlay, label: string | null): string | null {
  if (!label) return null;
  return play.players.find((p) => p.team === "offense" && p.label === label)?.id ?? null;
}
