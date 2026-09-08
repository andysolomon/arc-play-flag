import type { Player } from "./types";

export const HISTORY_CAP = 60;

/** Everything that identifies a document and what it holds: what Save writes. */
export interface Doc {
  id: string | null;
  name: string;
  notes: string;
  players: readonly Player[];
}

/**
 * One undo step, pushed before any mutation. An ordinary edit restores only the players
 * and leaves the name and notes as they are now, since typing into them is not undoable.
 * A `swap` (Open, New play) restores the whole document, identity included, so undoing
 * it can never leave one play's diagram under another play's id.
 */
export interface Entry extends Doc {
  swap: boolean;
}

export interface History {
  past: readonly Entry[];
  future: readonly Entry[];
}

export const emptyHistory: History = { past: [], future: [] };

export function push(h: History, doc: Doc, swap = false): History {
  const past = [...h.past, { id: doc.id, name: doc.name, notes: doc.notes, players: doc.players, swap }];
  return { past: past.length > HISTORY_CAP ? past.slice(-HISTORY_CAP) : past, future: [] };
}

export interface HistoryStep {
  history: History;
  doc: Doc;
}

function apply(entry: Entry, current: Doc): Doc {
  return entry.swap
    ? { id: entry.id, name: entry.name, notes: entry.notes, players: entry.players }
    : { id: current.id, name: current.name, notes: current.notes, players: entry.players };
}

/** What the reverse step must restore: the same kind of entry, taken from the current document. */
function inverse(entry: Entry, current: Doc): Entry {
  return { id: current.id, name: current.name, notes: current.notes, players: current.players, swap: entry.swap };
}

export function undo(h: History, current: Doc): HistoryStep | null {
  const prev = h.past[h.past.length - 1];
  if (!prev) return null;
  return {
    doc: apply(prev, current),
    history: { past: h.past.slice(0, -1), future: [inverse(prev, current), ...h.future] },
  };
}

export function redo(h: History, current: Doc): HistoryStep | null {
  const next = h.future[0];
  if (!next) return null;
  return {
    doc: apply(next, current),
    history: { past: [...h.past, inverse(next, current)], future: h.future.slice(1) },
  };
}
