import type { Pair, Playbook, Player, Route, RouteType, SavedPlay, Team, TeamSettings } from "./types";

export const PLAYS_KEY = "ffpd.plays.v2";
/** The prototype's library, keyed by play name. Read once and migrated into v2. */
export const LEGACY_PLAYS_KEY = "ffpd.plays.v1";
export const PLAYBOOKS_KEY = "ffpd.playbooks.v1";
export const TEAM_KEY = "ffpd.team.v1";
export const DRAFT_KEY = "ffpd.draft.v1";

export type Library = Record<string, SavedPlay>;
export type Playbooks = Record<string, Playbook>;
export interface DraftRecord {
  name: string;
  players: Player[];
  /** the saved play this draft came from, when it did */
  id?: string | null;
  notes?: string;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export type StorageFailure = "unavailable" | "quota" | "write";

/** A write that did not land. Nothing is reported saved until the record reads back. */
export class StorageError extends Error {
  readonly reason: StorageFailure;
  readonly key: string;
  constructor(reason: StorageFailure, key: string, cause?: unknown) {
    super(`storage ${reason}: ${key}`, cause === undefined ? undefined : { cause });
    this.name = "StorageError";
    this.reason = reason;
    this.key = key;
  }
}

/** One line a coach can act on. */
export function failureMessage(e: StorageError): string {
  switch (e.reason) {
    case "quota": return "Couldn't save: this browser's storage is full.";
    case "unavailable": return "Couldn't save: this browser isn't keeping storage (private window?).";
    case "write": return "Couldn't save: the browser refused the write.";
  }
}

export const DEFAULT_TEAM: TeamSettings = { name: "", color: "#f2b705" };
export const MAX_NOTES = 600;

function browserStorage(): StorageLike | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const num = (v: unknown, fallback: number): number => (typeof v === "number" && Number.isFinite(v) ? v : fallback);

const ROUTE_TYPES = new Set<string>([
  "go", "out", "in", "slant", "corner", "post", "curl", "flat", "cross", "wheel", "handoff",
  "dive", "stretch", "counter", "reverse", "delay", "pitch",
  "custom", "man", "zoneDeep", "zoneFlat", "curlFlat", "midRead", "blitz", "spy",
]);

/** A short random id: 10 base36 chars from crypto when it's there, Math.random otherwise. */
export function newId(): string {
  const c = globalThis.crypto;
  if (c && "getRandomValues" in c) {
    const bytes = c.getRandomValues(new Uint8Array(8));
    let s = "";
    for (const b of bytes) s += (b % 36).toString(36);
    return s + Date.now().toString(36).slice(-2);
  }
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-2);
}

function toPair(v: unknown): Pair | null {
  if (!Array.isArray(v) || v.length < 2) return null;
  const x: unknown = v[0], y: unknown = v[1];
  return typeof x === "number" && typeof y === "number" ? [x, y] : null;
}

function normalizeRoute(v: unknown): Route | null {
  if (!isRecord(v) || typeof v.type !== "string" || !ROUTE_TYPES.has(v.type)) return null;
  const r: Route = { type: v.type as RouteType };
  if (Array.isArray(v.pts)) r.pts = v.pts.map(toPair).filter((q): q is Pair => q !== null);
  if (typeof v.target === "string") r.target = v.target;
  if (v.mirror === true) r.mirror = true;
  if (v.primary === true) r.primary = true;
  return r;
}

/**
 * Accepts the prototype's stored shape (and anything older that looks like it) and
 * returns players clamped back onto the field, exactly as the prototype's load does.
 */
export function normalizePlayers(raw: unknown): Player[] {
  if (!Array.isArray(raw)) return [];
  const out: Player[] = [];
  raw.forEach((v: unknown, i) => {
    if (!isRecord(v)) return;
    const team: Team = v.team === "defense" ? "defense" : "offense";
    const x = Math.max(1.2, Math.min(28.8, num(v.x, 15)));
    const y0 = num(v.y, team === "offense" ? 1 : -5);
    const y = team === "offense" ? Math.max(0.9, Math.min(7.4, y0)) : Math.min(-0.9, Math.max(-36, y0));
    out.push({
      id: typeof v.id === "string" ? v.id : `p${String(i)}`,
      team,
      label: typeof v.label === "string" ? v.label.slice(0, 3) : "",
      x, y,
      route: normalizeRoute(v.route),
    });
  });
  return out;
}

export const cleanNotes = (v: unknown): string => (typeof v === "string" ? v.slice(0, MAX_NOTES) : "");
const cleanName = (v: unknown, fallback: string): string => (typeof v === "string" && v.trim() ? v.slice(0, 80) : fallback);

/** One saved play from any JSON-ish value, or null when there are no players in it. */
export function normalizeSavedPlay(raw: unknown, fallbackId = newId()): SavedPlay | null {
  if (!isRecord(raw)) return null;
  const players = normalizePlayers(raw.players);
  if (!players.length) return null;
  return {
    id: typeof raw.id === "string" && raw.id ? raw.id.slice(0, 40) : fallbackId,
    name: cleanName(raw.name, "Untitled play"),
    players,
    notes: cleanNotes(raw.notes),
  };
}

function parse(storage: StorageLike | null, key: string): unknown {
  if (!storage) return null;
  try {
    return JSON.parse(storage.getItem(key) ?? "null");
  } catch {
    return null;
  }
}

const isQuota = (e: unknown): boolean =>
  isRecord(e) && (e.name === "QuotaExceededError" || e.name === "NS_ERROR_DOM_QUOTA_REACHED" || e.code === 22 || e.code === 1014);

/**
 * Writes and reads back, throwing a StorageError when either fails, so no caller can
 * report a save that isn't there (a full quota, a private window, a storage that drops writes).
 */
function write(storage: StorageLike | null, key: string, value: unknown): void {
  if (!storage) throw new StorageError("unavailable", key);
  const json = JSON.stringify(value);
  try {
    storage.setItem(key, json);
  } catch (e) {
    throw new StorageError(isQuota(e) ? "quota" : "write", key, e);
  }
  let back: string | null;
  try {
    back = storage.getItem(key);
  } catch (e) {
    throw new StorageError("write", key, e);
  }
  if (back !== json) throw new StorageError("write", key);
}

/** The prototype's library (name → players) as v2 records. */
function migrateLegacy(storage: StorageLike | null): Library | null {
  const parsed = parse(storage, LEGACY_PLAYS_KEY);
  if (!isRecord(parsed)) return null;
  const lib: Library = {};
  for (const [name, rec] of Object.entries(parsed)) {
    if (!isRecord(rec)) continue;
    const players = normalizePlayers(rec.players);
    if (!players.length) continue;
    const id = newId();
    lib[id] = { id, name: name.slice(0, 80) || "Untitled play", players, notes: "" };
  }
  return lib;
}

export function readAll(storage: StorageLike | null = browserStorage()): Library {
  if (!storage) return {};
  const parsed = parse(storage, PLAYS_KEY);
  if (isRecord(parsed)) {
    const lib: Library = {};
    for (const [id, rec] of Object.entries(parsed)) {
      const p = normalizeSavedPlay(rec, id);
      if (p) lib[id] = { ...p, id };
    }
    return lib;
  }
  const migrated = migrateLegacy(storage);
  if (!migrated) return {};
  try {
    write(storage, PLAYS_KEY, migrated);
  } catch {
    /* still readable this session; the next successful save writes it through */
  }
  return migrated;
}

function writeAll(lib: Library, storage: StorageLike | null): void {
  write(storage, PLAYS_KEY, lib);
}

/** Upserts one play and returns the whole library. Throws a StorageError when the write doesn't land. */
export function store(play: SavedPlay, storage: StorageLike | null = browserStorage()): Library {
  const all = readAll(storage);
  all[play.id] = { ...play, players: [...play.players], notes: cleanNotes(play.notes) };
  writeAll(all, storage);
  return all;
}

/** Removes a play and every reference to it in a playbook. Throws a StorageError when a write doesn't land. */
export function remove(id: string, storage: StorageLike | null = browserStorage()): { plays: Library; playbooks: Playbooks } {
  const plays = readAll(storage);
  if (id in plays) {
    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
    delete plays[id];
    writeAll(plays, storage);
  }
  const books = readPlaybooks(storage);
  let touched = false;
  for (const b of Object.values(books)) {
    if (!b.plays.includes(id)) continue;
    b.plays = b.plays.filter((p) => p !== id);
    touched = true;
  }
  if (touched) writePlaybooks(books, storage);
  return { plays, playbooks: books };
}

export function normalizePlaybook(raw: unknown, fallbackId = newId()): Playbook | null {
  if (!isRecord(raw)) return null;
  const plays = Array.isArray(raw.plays) ? raw.plays.filter((p): p is string => typeof p === "string") : [];
  return {
    id: typeof raw.id === "string" && raw.id ? raw.id.slice(0, 40) : fallbackId,
    name: cleanName(raw.name, "Playbook"),
    plays: [...new Set(plays)],
  };
}

export function readPlaybooks(storage: StorageLike | null = browserStorage()): Playbooks {
  const parsed = parse(storage, PLAYBOOKS_KEY);
  if (!isRecord(parsed)) return {};
  const out: Playbooks = {};
  for (const [id, rec] of Object.entries(parsed)) {
    const b = normalizePlaybook(rec, id);
    if (b) out[id] = { ...b, id };
  }
  return out;
}

/** Throws a StorageError when the write doesn't land. */
export function writePlaybooks(books: Playbooks, storage: StorageLike | null = browserStorage()): void {
  write(storage, PLAYBOOKS_KEY, books);
}

export function storePlaybook(book: Playbook, storage: StorageLike | null = browserStorage()): Playbooks {
  const all = readPlaybooks(storage);
  all[book.id] = { ...book, plays: [...book.plays] };
  writePlaybooks(all, storage);
  return all;
}

export function removePlaybook(id: string, storage: StorageLike | null = browserStorage()): Playbooks {
  const all = readPlaybooks(storage);
  // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
  delete all[id];
  writePlaybooks(all, storage);
  return all;
}

export function normalizeTeam(raw: unknown): TeamSettings | null {
  if (!isRecord(raw)) return null;
  const color = typeof raw.color === "string" && /^#[0-9a-f]{6}$/i.test(raw.color) ? raw.color.toLowerCase() : DEFAULT_TEAM.color;
  return { name: typeof raw.name === "string" ? raw.name.slice(0, 40) : "", color };
}

export function readTeam(storage: StorageLike | null = browserStorage()): TeamSettings {
  return normalizeTeam(parse(storage, TEAM_KEY)) ?? DEFAULT_TEAM;
}

/** True when the device has never had a team set. */
export function hasTeam(storage: StorageLike | null = browserStorage()): boolean {
  return normalizeTeam(parse(storage, TEAM_KEY)) !== null;
}

/** Throws a StorageError when the write doesn't land. */
export function writeTeam(team: TeamSettings, storage: StorageLike | null = browserStorage()): void {
  write(storage, TEAM_KEY, normalizeTeam(team) ?? DEFAULT_TEAM);
}

export function readDraft(storage: StorageLike | null = browserStorage()): DraftRecord | null {
  const parsed = parse(storage, DRAFT_KEY);
  if (!isRecord(parsed) || !Array.isArray(parsed.players)) return null;
  const players = normalizePlayers(parsed.players);
  if (!players.length) return null;
  return {
    name: typeof parsed.name === "string" ? parsed.name : "New play",
    players,
    id: typeof parsed.id === "string" ? parsed.id : null,
    notes: cleanNotes(parsed.notes),
  };
}

/** Throws a StorageError when the write doesn't land. */
export function writeDraft(draft: DraftRecord, storage: StorageLike | null = browserStorage()): void {
  write(storage, DRAFT_KEY, draft);
}

export function kebab(name: string): string {
  const k = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return k || "play";
}
