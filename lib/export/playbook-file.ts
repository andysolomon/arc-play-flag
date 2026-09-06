import { newId, normalizePlaybook, normalizeSavedPlay, normalizeTeam } from "@/lib/play/storage";
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

export function encodePlaybookFile(book: Playbook, library: readonly SavedPlay[], team: TeamSettings | null): string {
  const byId = new Map(library.map((p) => [p.id, p]));
  const plays = book.plays.flatMap((id) => { const p = byId.get(id); return p ? [p] : []; });
  const file: PlaybookFile = {
    kind: FILE_KIND,
    version: 1,
    exported: new Date().toISOString(),
    playbook: { id: book.id, name: book.name, plays: plays.map((p) => p.id) },
    plays,
    team: team && team.name ? team : null,
  };
  return JSON.stringify(file, null, 2);
}

export function decodePlaybookFile(json: string): PlaybookFile | null {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (r.kind !== FILE_KIND || !Array.isArray(r.plays)) return null;
  const plays = r.plays.map((p) => normalizeSavedPlay(p)).filter((p): p is SavedPlay => p !== null);
  const book = normalizePlaybook(r.playbook);
  if (!book) return null;
  const known = new Set(plays.map((p) => p.id));
  book.plays = book.plays.filter((id) => known.has(id));
  return {
    kind: FILE_KIND,
    version: 1,
    exported: typeof r.exported === "string" ? r.exported : "",
    playbook: book,
    plays,
    team: normalizeTeam(r.team),
  };
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
