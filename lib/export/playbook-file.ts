import { kebab, newId, normalizePlaybook, normalizeSavedPlay, normalizeTeam } from "@/lib/play/storage";
import type { Playbook, SavedPlay, TeamSettings } from "@/lib/play/types";

/**
 * A playbook as a plain file: the book, full copies of its plays, and the team, so it
 * opens on another device with nothing else installed.
 */
export const FILE_KIND = "ffpd.playbook";

export interface PlaybookFile {
  kind: typeof FILE_KIND;
  version: 1;
  exported: string;
  playbook: Playbook;
  plays: SavedPlay[];
  team: TeamSettings | null;
}

/** The only schema this build reads. A higher number is a file from a newer app. */
export const FILE_VERSION = 1;
/** Bigger than any playbook this app writes (500 full plays is about 1 MB). */
export const MAX_FILE_BYTES = 4_000_000;
export const MAX_FILE_PLAYS = 500;

export type ImportError = "tooLarge" | "notJson" | "notPlaybook" | "newerVersion" | "unknownVersion" | "tooManyPlays" | "duplicatePlays";
/** `skipped` counts plays in the file that could not be read (no players) and were left out. */
export type ImportRead = { ok: true; file: PlaybookFile; skipped: number } | { ok: false; error: ImportError };

/** What to tell the coach, in one line. */
export function importMessage(e: ImportError): string {
  switch (e) {
    case "tooLarge": return "That file is too big to be a playbook.";
    case "notJson": return "That file isn't readable. Was it edited?";
    case "notPlaybook": return "That file isn't a playbook.";
    case "newerVersion": return "That playbook was made by a newer version of this app. Update, then try again.";
    case "unknownVersion": return "That playbook's version isn't one this app can read.";
    case "tooManyPlays": return `That file has more than ${String(MAX_FILE_PLAYS)} plays.`;
    case "duplicatePlays": return "That file lists the same play twice. Export it again.";
  }
}

export function encodePlaybookFile(book: Playbook, library: readonly SavedPlay[], team: TeamSettings | null): string {
  const byId = new Map(library.map((p) => [p.id, p]));
  const plays = book.plays.flatMap((id) => { const p = byId.get(id); return p ? [p] : []; });
  const file: PlaybookFile = {
    kind: FILE_KIND,
    version: FILE_VERSION,
    exported: new Date().toISOString(),
    playbook: { id: book.id, name: book.name, plays: plays.map((p) => p.id) },
    plays,
    team: team && team.name ? team : null,
  };
  return JSON.stringify(file, null, 2);
}

/**
 * Reads a file all the way through before anything is stored: the size, the schema
 * version, the play count, and every play and its routes are checked here, so a bad
 * file is refused with a reason and never touches the library.
 */
export function readPlaybookFile(json: string): ImportRead {
  if (json.length > MAX_FILE_BYTES) return { ok: false, error: "tooLarge" };
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return { ok: false, error: "notJson" };
  }
  if (typeof raw !== "object" || raw === null) return { ok: false, error: "notPlaybook" };
  const r = raw as Record<string, unknown>;
  if (r.kind !== FILE_KIND || !Array.isArray(r.plays)) return { ok: false, error: "notPlaybook" };
  if (typeof r.version !== "number" || !Number.isInteger(r.version) || r.version < 1) return { ok: false, error: "unknownVersion" };
  if (r.version > FILE_VERSION) return { ok: false, error: "newerVersion" };
  if (r.plays.length > MAX_FILE_PLAYS) return { ok: false, error: "tooManyPlays" };
  const plays = r.plays.map((p) => normalizeSavedPlay(p)).filter((p): p is SavedPlay => p !== null);
  if (new Set(plays.map((p) => p.id)).size !== plays.length) return { ok: false, error: "duplicatePlays" };
  const book = normalizePlaybook(r.playbook);
  if (!book) return { ok: false, error: "notPlaybook" };
  const known = new Set(plays.map((p) => p.id));
  book.plays = book.plays.filter((id) => known.has(id));
  return {
    ok: true,
    file: {
      kind: FILE_KIND,
      version: 1,
      exported: typeof r.exported === "string" ? r.exported : "",
      playbook: book,
      plays,
      team: normalizeTeam(r.team),
    },
    skipped: r.plays.length - plays.length,
  };
}

/** The file, or null for any reason: readPlaybookFile says which. */
export function decodePlaybookFile(json: string): PlaybookFile | null {
  const r = readPlaybookFile(json);
  return r.ok ? r.file : null;
}

export interface ImportPlan {
  /** plays to store (new ids for copies); identical plays already on the device are not here */
  plays: SavedPlay[];
  /** the playbook to store, or null when an identical one already exists */
  book: Playbook | null;
  reused: number;
  copied: number;
  added: number;
}

const same = (a: SavedPlay, b: SavedPlay): boolean =>
  a.name === b.name && a.notes === b.notes && JSON.stringify(a.players) === JSON.stringify(b.players);

/**
 * Nothing on the device changes: a play whose id is here and identical is reused, one
 * that differs comes in as a copy under a new id, and the book points at whichever won.
 */
export function planImport(file: PlaybookFile, library: readonly SavedPlay[], books: readonly Playbook[]): ImportPlan {
  const local = new Map(library.map((p) => [p.id, p]));
  const map = new Map<string, string>();
  const plays: SavedPlay[] = [];
  let reused = 0, copied = 0, added = 0;
  for (const p of file.plays) {
    const mine = local.get(p.id);
    if (!mine) { plays.push(p); map.set(p.id, p.id); added++; continue; }
    if (same(mine, p)) { map.set(p.id, p.id); reused++; continue; }
    const copy: SavedPlay = { ...p, id: newId() };
    plays.push(copy);
    map.set(p.id, copy.id);
    copied++;
  }
  const ids = file.playbook.plays.flatMap((id) => { const m = map.get(id); return m ? [m] : []; });
  const existing = books.find((b) => b.id === file.playbook.id);
  let book: Playbook | null;
  if (!existing) book = { id: file.playbook.id, name: file.playbook.name, plays: ids };
  else if (existing.name === file.playbook.name && existing.plays.join() === ids.join()) book = null;
  else book = { id: newId(), name: file.playbook.name + " (imported)", plays: ids };
  return { plays, book, reused, copied, added };
}

/**
 * A one-play playbook file for a play the device won't keep: the way out of a failed
 * save or a broken screen. "Import a file…" on the playbooks page takes it back.
 */
export function encodeRecoveryFile(play: SavedPlay): { json: string; filename: string } {
  const name = play.name || "Untitled play";
  return {
    json: encodePlaybookFile({ id: newId(), name: `${name} (recovered)`, plays: [play.id] }, [{ ...play, name }], null),
    filename: `${kebab(name)}.playbook.json`,
  };
}
