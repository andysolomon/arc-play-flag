import {
  StorageError, artShadow, hasTeam, importAll, newId, primaryPlayId, readAll, readLineups, readPlaybooks, readTeam, remove, removePlaybook,
  store, storePlaybook, writeLineups, writeTeam,
} from "./storage";
import { readCurrentBook, writeCurrentBook } from "./current-book";
import { losOf, withLos } from "./field";
import { callOf } from "./call";
import { isBallJob, isRun } from "./routes";
import { defaultLineups } from "./lineup";
import type { Lineups, Playbook, SavedPlay, TeamSettings } from "./types";

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

/**
 * Defense is the play's side; Run and Pass are offensive plays by what their routes do,
 * and an offensive play may match both. A lateral or a throw is a ball carrier's job, not
 * a route anyone catches: a chain that ends in a throw is a pass, one that ends in a keep
 * is a run by its keep. Blank diagrams remain under All.
 */
export function playMatchesFilter(play: SavedPlay, filter: Exclude<PlayFilter, "all">): boolean {
  if (filter === "defense") return play.side === "defense";
  if (play.side !== "offense") return false;
  if (filter === "run") return play.players.some((p) => p.team === "offense" && p.route && isRun(p.route.type));
  const call = callOf(play.players);
  return call === "double-pass" || call === "lateral-pass"
    || play.players.some((p) => p.team === "offense" && p.route && !isRun(p.route.type) && !isBallJob(p.route.type));
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
  return withLos({
    id: play.id,
    name: play.name,
    notes: "",
    side: play.side,
    ...artShadow(play.artShadow),
    players: play.players.map((player) => ({ ...player, route: null })),
  }, losOf(play));
}

const NO_PLAYS: readonly SavedPlay[] = [];
const NO_BOOKS: readonly Playbook[] = [];
const NO_LINEUPS: Lineups = defaultLineups();
let plays: readonly SavedPlay[] | null = null;
let books: readonly Playbook[] | null = null;
let team: TeamSettings | null = null;
let lineups: Lineups | null = null;
/** the current playbook's id, worked out from the pick on this device and the books; undefined until read */
let currentId: string | null | undefined;
/**
 * The playbook picked on this visit, kept in memory whether or not its write to storage landed, so a
 * blocked or full storage costs the pick only its memory past the visit, never the visit itself (C3).
 * Undefined until a pick is made here; until then the pick stored on the device stands.
 */
let pickedId: string | undefined;
const listeners = new Set<() => void>();

function emit(): void {
  for (const cb of listeners) cb();
}

/** The books after a write: the current playbook is worked out again, since it may be gone or new (C1). */
function setBooks(next: readonly Playbook[] | null): void {
  books = next;
  currentId = undefined;
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

/** The lineups, who plays each position in versions (docs/adr/008-roster-depth-chart.md); kept with the team, on this device. */
export function getLineups(): Lineups {
  lineups ??= readLineups();
  return lineups;
}
export const getServerLineups = (): Lineups => NO_LINEUPS;

export function playById(id: string | null | undefined): SavedPlay | null {
  return id ? getPlays().find((p) => p.id === id) ?? null : null;
}

export function playbookById(id: string | null | undefined): Playbook | null {
  return id ? getPlaybooks().find((b) => b.id === id) ?? null : null;
}

/**
 * The playbook the designer is working in on this device: the one picked here, while it exists,
 * else the first playbook, else none (lib/play/current-book.ts, C1).
 */
export function getCurrentBookId(): string | null {
  if (currentId === undefined) {
    const picked = pickedId ?? readCurrentBook();
    currentId = picked && playbookById(picked) ? picked : getPlaybooks()[0]?.id ?? null;
  }
  return currentId;
}
export const getServerCurrentBookId = (): string | null => null;

export function currentBook(): Playbook | null {
  return playbookById(getCurrentBookId());
}

/** Makes a playbook the current one on this device. False when there is no such book. */
export function setCurrentBook(id: string): boolean {
  if (!playbookById(id)) return false;
  writeCurrentBook(id);
  pickedId = id;
  currentId = id;
  emit();
  return true;
}

/**
 * The play the designer opens on a switch to this book: its primary, when that play is still
 * in the library, else the first play of the book that is (C5), else none (an empty book).
 */
export function primaryPlay(book: Playbook): SavedPlay | null {
  return playById(primaryPlayId(book)) ?? book.plays.map((id) => playById(id)).find((p) => p !== null) ?? null;
}

/** Makes one of the book's plays its primary. A play off the book is refused as a write that can't land. */
export function setPrimaryPlay(bookId: string, playId: string): Written {
  const book = playbookById(bookId);
  if (!book?.plays.includes(playId)) return { ok: false, error: new StorageError("write", "playbook primary") };
  return updatePlaybook({ ...book, primary: playId });
}

/** Saves a play (new id when none is given) and returns the record as stored. */
export function savePlay(play: Omit<SavedPlay, "id"> & { id?: string | null }): Written<SavedPlay> {
  // the ball spot goes last and only off the own goal line, as normalizeSavedPlay reads it back
  const rec: SavedPlay = withLos({
    id: play.id ?? newId(), name: play.name, players: [...play.players], notes: play.notes, side: play.side, ...artShadow(play.artShadow),
  }, losOf(play));
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
    setBooks(Object.values(next.playbooks));
    emit();
    return null;
  });
}

/** Makes a book and returns it as stored: with the first play given as its primary, when there is one. */
export function createPlaybook(name: string, playIds: readonly string[] = []): Written<Playbook> {
  const book: Playbook = { id: newId(), name, plays: [...playIds] };
  return attempt(() => {
    const all = storePlaybook(book);
    setBooks(Object.values(all));
    emit();
    return all[book.id] ?? book;
  });
}

export function updatePlaybook(book: Playbook): Written {
  return attempt(() => {
    setBooks(Object.values(storePlaybook(book)));
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
    setBooks(Object.values(removePlaybook(id)));
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

export function setLineups(next: Lineups): Written {
  return attempt(() => {
    writeLineups(next);
    lineups = readLineups();
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
  setBooks(null);
  team = null;
  lineups = null;
  emit();
}

/**
 * The device was rewritten whole, the pick included (the account engine brought a team down,
 * docs/adr/013-whole-desk-in-account.md): every snapshot and the pick are read again from storage,
 * so a pick made on this visit gives way to the one the account holds.
 */
export function reread(): void {
  pickedId = undefined;
  refresh();
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
