import type { Player, Team } from "./types";

export const HISTORY_CAP = 60;

/** Everything that identifies a document and what it holds: what Save writes. */
export interface Doc {
  id: string | null;
  name: string;
  notes: string;
  /** offensive play or defensive call */
  side: Team;
  players: readonly Player[];
}

/**
 * One undo step: the players before an edit on this play.
 * Name, notes, side, and id belong to the play and are never undone.
 * Opening or starting a play clears the stacks, so a step cannot point at another play.
 */
export interface Entry {
  players: readonly Player[];
}

export interface History {
  past: readonly Entry[];
  future: readonly Entry[];
}

export const emptyHistory: History = { past: [], future: [] };

export function push(h: History, doc: Pick<Doc, "players">): History {
  const past = [...h.past, { players: doc.players }];
  return { past: past.length > HISTORY_CAP ? past.slice(-HISTORY_CAP) : past, future: [] };
}

export interface HistoryStep {
  history: History;
  doc: Doc;
}

function apply(entry: Entry, current: Doc): Doc {
  return { id: current.id, name: current.name, notes: current.notes, side: current.side, players: entry.players };
}

/** What the reverse step must restore: the players on the document as it is now. */
function inverse(current: Doc): Entry {
  return { players: current.players };
}

export function undo(h: History, current: Doc): HistoryStep | null {
  const prev = h.past[h.past.length - 1];
  if (!prev) return null;
  return {
    doc: apply(prev, current),
    history: { past: h.past.slice(0, -1), future: [inverse(current), ...h.future] },
  };
}

export function redo(h: History, current: Doc): HistoryStep | null {
  const next = h.future[0];
  if (!next) return null;
  return {
    doc: apply(next, current),
    history: { past: [...h.past, inverse(current)], future: h.future.slice(1) },
  };
}
