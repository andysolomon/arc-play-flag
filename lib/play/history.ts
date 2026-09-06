import type { Player } from "./types";

export const HISTORY_CAP = 60;

/** Snapshots of the player array, pushed before any mutation. */
export interface History {
  past: readonly (readonly Player[])[];
  future: readonly (readonly Player[])[];
}

export const emptyHistory: History = { past: [], future: [] };

export function push(h: History, snapshot: readonly Player[]): History {
  const past = [...h.past, snapshot];
  return { past: past.length > HISTORY_CAP ? past.slice(-HISTORY_CAP) : past, future: [] };
}

export interface HistoryStep {
  history: History;
  players: readonly Player[];
}

export function undo(h: History, current: readonly Player[]): HistoryStep | null {
  const prev = h.past[h.past.length - 1];
  if (!prev) return null;
  return {
    players: prev,
    history: { past: h.past.slice(0, -1), future: [current, ...h.future] },
  };
}

export function redo(h: History, current: readonly Player[]): HistoryStep | null {
  const next = h.future[0];
  if (!next) return null;
  return {
    players: next,
    history: { past: [...h.past, current], future: h.future.slice(1) },
  };
}
