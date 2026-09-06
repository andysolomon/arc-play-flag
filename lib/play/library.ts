import { readAll, store } from "./storage";
import type { Player } from "./types";

/**
 * The saved-play library as an external store, so components can read the
 * names with useSyncExternalStore (server snapshot: none) and re-render on save.
 */
const EMPTY: readonly string[] = [];
let names: readonly string[] | null = null;
const listeners = new Set<() => void>();

export function getNames(): readonly string[] {
  names ??= Object.keys(readAll());
  return names;
}

export function getServerNames(): readonly string[] {
  return EMPTY;
}

export function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

export function saveToLibrary(name: string, players: readonly Player[]): void {
  names = Object.keys(store(name, players));
  for (const cb of listeners) cb();
}
