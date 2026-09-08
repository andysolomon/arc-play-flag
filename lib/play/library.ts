import {
  StorageError, hasTeam, newId, readAll, readPlaybooks, readTeam, remove, removePlaybook, store, storePlaybook, writeTeam,
} from "./storage";
import type { Playbook, SavedPlay, TeamSettings } from "./types";

/**
 * The on-device library (plays, playbooks, team) as one external store, so components
 * read snapshots with useSyncExternalStore (server snapshot: empty) and re-render on
 * every write. Snapshots are arrays in insertion order and are rebuilt only after a write.
 *
 * Every write returns a Written: the snapshot changes and listeners hear about it only
 * when the record is durably on the device, so a caller never says "Saved" for a write
 * that was dropped, and never adopts an id the device doesn't know.
 */
export type Written<T = null> = { ok: true; value: T } | { ok: false; error: StorageError };

const NO_PLAYS: readonly SavedPlay[] = [];
const NO_BOOKS: readonly Playbook[] = [];
let plays: readonly SavedPlay[] | null = null;
let books: readonly Playbook[] | null = null;
let team: TeamSettings | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const cb of listeners) cb();
}

/** Runs a write; a StorageError becomes a failed result, anything else is a bug and propagates. */
function attempt<T>(fn: () => T): Written<T> {
  try {
    return { ok: true, value: fn() };
  } catch (e) {
    if (e instanceof StorageError) return { ok: false, error: e };
    throw e;
  }
}

export function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

export function getPlays(): readonly SavedPlay[] {
  plays ??= Object.values(readAll());
  return plays;
}
export const getServerPlays = (): readonly SavedPlay[] => NO_PLAYS;

export function getPlaybooks(): readonly Playbook[] {
  books ??= Object.values(readPlaybooks());
  return books;
}
export const getServerPlaybooks = (): readonly Playbook[] => NO_BOOKS;

export function getTeam(): TeamSettings {
  team ??= readTeam();
  return team;
}
export const getServerTeam = (): TeamSettings => readTeam(null);

export function playById(id: string | null | undefined): SavedPlay | null {
  return id ? getPlays().find((p) => p.id === id) ?? null : null;
}

export function playbookById(id: string | null | undefined): Playbook | null {
  return id ? getPlaybooks().find((b) => b.id === id) ?? null : null;
}

/** Saves a play (new id when none is given) and returns the record as stored. */
export function savePlay(play: Omit<SavedPlay, "id"> & { id?: string | null }): Written<SavedPlay> {
  const rec: SavedPlay = { id: play.id ?? newId(), name: play.name, players: [...play.players], notes: play.notes };
  return attempt(() => {
    plays = Object.values(store(rec));
    emit();
    return rec;
  });
}

/** Playbooks a play appears in. */
export function booksHolding(playId: string): readonly Playbook[] {
  return getPlaybooks().filter((b) => b.plays.includes(playId));
}

export function deletePlay(id: string): Written {
  return attempt(() => {
    const next = remove(id);
    plays = Object.values(next.plays);
    books = Object.values(next.playbooks);
    emit();
    return null;
  });
}

export function createPlaybook(name: string, playIds: readonly string[] = []): Written<Playbook> {
  const book: Playbook = { id: newId(), name, plays: [...playIds] };
  return attempt(() => {
    books = Object.values(storePlaybook(book));
    emit();
    return book;
  });
}

export function updatePlaybook(book: Playbook): Written {
  return attempt(() => {
    books = Object.values(storePlaybook(book));
    emit();
    return null;
  });
}

export function deletePlaybook(id: string): Written {
  return attempt(() => {
    books = Object.values(removePlaybook(id));
    emit();
    return null;
  });
}

export function setTeam(next: TeamSettings): Written {
  return attempt(() => {
    writeTeam(next);
    team = readTeam();
    emit();
    return null;
  });
}

export function teamIsSet(): boolean {
  return hasTeam();
}

/** Drops every cached snapshot, for after a bulk write such as an import. */
export function refresh(): void {
  plays = null;
  books = null;
  team = null;
  emit();
}

/**
 * Stores an import plan's plays and book in one go, then rebuilds every snapshot. The
 * book is written last, so a failure part-way leaves extra plays but never a book that
 * points at plays which aren't there.
 */
export function applyImport(plan: { plays: readonly SavedPlay[]; book: Playbook | null }, importedTeam: TeamSettings | null): Written {
  const r = attempt(() => {
    for (const p of plan.plays) store(p);
    if (plan.book) storePlaybook(plan.book);
    if (importedTeam && !hasTeam()) writeTeam(importedTeam);
    return null;
  });
  refresh();
  return r;
}
