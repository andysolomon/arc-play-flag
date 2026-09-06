import {
  hasTeam, newId, readAll, readPlaybooks, readTeam, remove, removePlaybook, store, storePlaybook, writeTeam,
} from "./storage";
import type { Playbook, SavedPlay, TeamSettings } from "./types";

/**
 * The on-device library (plays, playbooks, team) as one external store, so components
 * read snapshots with useSyncExternalStore (server snapshot: empty) and re-render on
 * every write. Snapshots are arrays in insertion order and are rebuilt only after a write.
 */
const NO_PLAYS: readonly SavedPlay[] = [];
const NO_BOOKS: readonly Playbook[] = [];
let plays: readonly SavedPlay[] | null = null;
let books: readonly Playbook[] | null = null;
let team: TeamSettings | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const cb of listeners) cb();
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
export function savePlay(play: Omit<SavedPlay, "id"> & { id?: string | null }): SavedPlay {
  const rec: SavedPlay = { id: play.id ?? newId(), name: play.name, players: [...play.players], notes: play.notes };
  plays = Object.values(store(rec));
  emit();
  return rec;
}

/** Playbooks a play appears in. */
export function booksHolding(playId: string): readonly Playbook[] {
  return getPlaybooks().filter((b) => b.plays.includes(playId));
}

export function deletePlay(id: string): void {
  const next = remove(id);
  plays = Object.values(next.plays);
  books = Object.values(next.playbooks);
  emit();
}

export function createPlaybook(name: string, playIds: readonly string[] = []): Playbook {
  const book: Playbook = { id: newId(), name, plays: [...playIds] };
  books = Object.values(storePlaybook(book));
  emit();
  return book;
}

export function updatePlaybook(book: Playbook): void {
  books = Object.values(storePlaybook(book));
  emit();
}

export function deletePlaybook(id: string): void {
  books = Object.values(removePlaybook(id));
  emit();
}

export function setTeam(next: TeamSettings): void {
  writeTeam(next);
  team = readTeam();
  emit();
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

/** Stores an import plan's plays and book in one go, then rebuilds every snapshot. */
export function applyImport(plan: { plays: readonly SavedPlay[]; book: Playbook | null }, importedTeam: TeamSettings | null): void {
  for (const p of plan.plays) store(p);
  if (plan.book) storePlaybook(plan.book);
  if (importedTeam && !hasTeam()) writeTeam(importedTeam);
  refresh();
}
