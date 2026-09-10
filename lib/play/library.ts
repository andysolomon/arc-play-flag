import {
  StorageError, hasTeam, importAll, newId, readAll, readPlaybooks, readTeam, remove, removePlaybook, store, storePlaybook, writeTeam,
} from "./storage";
import { isRun } from "./routes";
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
export type PlayFilter = "all" | "run" | "pass" | "defense";
export type PlaySort = "recent" | "name";

export interface PlayDiscovery {
  query?: string;
  filter?: PlayFilter;
  sort?: PlaySort;
}

/** A play may match more than one route filter; blank diagrams remain under All. */
export function playMatchesFilter(play: SavedPlay, filter: Exclude<PlayFilter, "all">): boolean {
  if (filter === "defense") return play.players.some((p) => p.team === "defense" && p.route);
  if (filter === "run") return play.players.some((p) => p.team === "offense" && p.route && isRun(p.route.type));
  return play.players.some((p) => p.team === "offense" && p.route && !isRun(p.route.type));
}

/** Search name + notes, then return a stable name or newest-insertion-first view. */
export function discoverPlays(source: readonly SavedPlay[], options: PlayDiscovery = {}): SavedPlay[] {
  const query = options.query?.trim().toLocaleLowerCase() ?? "";
  const filter = options.filter ?? "all";
  const found = source.filter((play) => {
    if (filter !== "all" && !playMatchesFilter(play, filter)) return false;
    return !query || `${play.name}\n${play.notes}`.toLocaleLowerCase().includes(query);
  });
  if ((options.sort ?? "recent") === "name") {
    return found.map((play, index) => ({ play, index })).sort((a, b) =>
      a.play.name.localeCompare(b.play.name, undefined, { sensitivity: "base" }) || a.index - b.index,
    ).map(({ play }) => play);
  }
  return found.reverse();
}

/** A route-free, deeply detached formation that callers can safely edit and reuse. */
export function formationTemplate(play: SavedPlay): SavedPlay {
  return {
    id: play.id,
    name: play.name,
    notes: "",
    players: play.players.map((player) => ({ ...player, route: null })),
  };
}

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

/** Adds one durable reference once, preserving every existing reference and its order. */
export function addPlayToPlaybook(bookId: string, playId: string): Written<Playbook> {
  const book = playbookById(bookId);
  if (!book || !playById(playId)) return { ok: false, error: new StorageError("write", "playbook reference") };
  if (book.plays.includes(playId)) return { ok: true, value: book };
  const next = { ...book, plays: [...book.plays, playId] };
  const written = updatePlaybook(next);
  return written.ok ? { ok: true, value: next } : written;
}

/** Swaps two known references without rebuilding the list, so unknown references survive. */
export function swapPlaybookReferences(book: Playbook, first: string, second: string): Playbook {
  const a = book.plays.indexOf(first);
  const b = book.plays.indexOf(second);
  if (a < 0 || b < 0 || a === b) return book;
  const plays = [...book.plays];
  plays[a] = second;
  plays[b] = first;
  return { ...book, plays };
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
 * Stores an import plan's plays and book as one change, then rebuilds every snapshot.
 * A write that fails part-way is rolled back, so the library is either fully imported
 * or exactly as it was. The team is a courtesy on a fresh device and never blocks.
 */
export function applyImport(plan: { plays: readonly SavedPlay[]; book: Playbook | null }, importedTeam: TeamSettings | null): Written {
  const r = attempt(() => {
    importAll(plan.plays, plan.book);
    return null;
  });
  if (r.ok && importedTeam && !hasTeam()) attempt(() => { writeTeam(importedTeam); });
  refresh();
  return r;
}
