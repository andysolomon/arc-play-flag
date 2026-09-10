import {
  DRAFT_KEY, PLAYBOOKS_KEY, PLAYS_KEY, TEAM_KEY, kebab, normalizeDraft, normalizePlaybook, normalizeSavedPlay, normalizeTeam,
  readAll, readDraft, readPlaybooks, readTeam, writeMany, type DraftRecord, type Library, type Playbooks, type StorageLike,
} from "@/lib/play/storage";
import type { Playbook, SavedPlay, TeamSettings } from "@/lib/play/types";

export const BACKUP_KIND = "ffpd.backup";
export const BACKUP_VERSION = 1;
export const MAX_BACKUP_BYTES = 8_000_000;
export const MAX_BACKUP_PLAYS = 1_000;
export const MAX_BACKUP_PLAYBOOKS = 1_000;

export interface BackupFile {
  kind: typeof BACKUP_KIND;
  version: typeof BACKUP_VERSION;
  exported: string;
  plays: SavedPlay[];
  playbooks: Playbook[];
  team: TeamSettings;
  draft: DraftRecord | null;
}

export interface BackupState {
  plays: Library;
  playbooks: Playbooks;
  team: TeamSettings;
  draft: DraftRecord | null;
}

export type BackupReadError =
  | "tooLarge" | "notJson" | "notBackup" | "newerVersion" | "unknownVersion" | "tooManyItems" | "invalidData";
export type BackupRead = { ok: true; file: BackupFile } | { ok: false; error: BackupReadError };
export type RestoreMode = "merge" | "replace";

export interface RestorePlan {
  mode: RestoreMode;
  state: BackupState;
  incomingPlays: number;
  incomingPlaybooks: number;
  matchingPlays: number;
  matchingPlaybooks: number;
  currentOnlyPlays: number;
  currentOnlyPlaybooks: number;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const POLLUTION_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const safeId = (id: unknown): id is string => typeof id === "string" && id.length > 0 && !POLLUTION_KEYS.has(id);

function safePlayers(players: SavedPlay["players"]): boolean {
  return players.every((player) => safeId(player.id) && (!player.route || player.route.target === undefined || safeId(player.route.target)));
}

/** Compares JSON data without depending on object-key order. */
function sameData(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => sameData(v, b[i]));
  }
  if (!isRecord(a) || !isRecord(b)) return false;
  const ak = Object.keys(a).sort(), bk = Object.keys(b).sort();
  return ak.length === bk.length && ak.every((k, i) => k === bk[i] && sameData(a[k], b[k]));
}

function canonicalPlay(raw: unknown): SavedPlay | null {
  if (!isRecord(raw) || !safeId(raw.id)) return null;
  const play = normalizeSavedPlay(raw, raw.id);
  return play && sameData(raw, play) && safePlayers(play.players) ? play : null;
}

function canonicalBook(raw: unknown): Playbook | null {
  if (!isRecord(raw) || !safeId(raw.id)) return null;
  const book = normalizePlaybook(raw, raw.id);
  return book && sameData(raw, book) ? book : null;
}

export function backupMessage(error: BackupReadError): string {
  switch (error) {
    case "tooLarge": return "That file is too big to be a device backup.";
    case "notJson": return "That backup isn't readable. Was it edited?";
    case "notBackup": return "That file isn't a device backup.";
    case "newerVersion": return "That backup was made by a newer version of this app. Update, then try again.";
    case "unknownVersion": return "That backup's version isn't one this app can read.";
    case "tooManyItems": return "That backup contains more plays or playbooks than this app can restore.";
    case "invalidData": return "That backup is incomplete or contains invalid data. Nothing was changed.";
  }
}

export function readBackupState(storage?: StorageLike | null): BackupState {
  return {
    plays: readAll(storage),
    playbooks: readPlaybooks(storage),
    team: readTeam(storage),
    draft: readDraft(storage),
  };
}

/** Creates a complete, versioned snapshot of data this app keeps on the device. */
export function createBackup(storage?: StorageLike | null): BackupFile {
  const state = readBackupState(storage);
  return {
    kind: BACKUP_KIND,
    version: BACKUP_VERSION,
    exported: new Date().toISOString(),
    plays: Object.values(state.plays),
    playbooks: Object.values(state.playbooks),
    team: state.team,
    draft: state.draft,
  };
}

export function encodeBackupFile(storage?: StorageLike | null): { json: string; filename: string } {
  const file = createBackup(storage);
  const day = file.exported.slice(0, 10);
  const team = file.team.name ? `${kebab(file.team.name)}-` : "";
  return { json: JSON.stringify(file, null, 2), filename: `${team}device-backup-${day}.json` };
}

/** Validates the entire backup and every reference before returning any restorable data. */
export function readBackupFile(json: string): BackupRead {
  if (json.length > MAX_BACKUP_BYTES) return { ok: false, error: "tooLarge" };
  let raw: unknown;
  try { raw = JSON.parse(json); } catch { return { ok: false, error: "notJson" }; }
  if (!isRecord(raw) || raw.kind !== BACKUP_KIND || !Array.isArray(raw.plays) || !Array.isArray(raw.playbooks)) {
    return { ok: false, error: "notBackup" };
  }
  if (typeof raw.version !== "number" || !Number.isInteger(raw.version) || raw.version < 1) {
    return { ok: false, error: "unknownVersion" };
  }
  if (raw.version > BACKUP_VERSION) return { ok: false, error: "newerVersion" };
  if (raw.plays.length > MAX_BACKUP_PLAYS || raw.playbooks.length > MAX_BACKUP_PLAYBOOKS) {
    return { ok: false, error: "tooManyItems" };
  }
  const plays = raw.plays.map(canonicalPlay);
  const playbooks = raw.playbooks.map(canonicalBook);
  const team = normalizeTeam(raw.team);
  const draft = raw.draft === null ? null : normalizeDraft(raw.draft);
  if (plays.some((p) => p === null) || playbooks.some((b) => b === null) || !team || !sameData(raw.team, team)) {
    return { ok: false, error: "invalidData" };
  }
  if (raw.draft !== null && (!draft || !sameData(raw.draft, draft))) return { ok: false, error: "invalidData" };
  const validPlays = plays as SavedPlay[];
  const validBooks = playbooks as Playbook[];
  if (validBooks.some((b) => !safeId(b.id) || b.plays.some((id) => !safeId(id)))
    || (draft !== null && (!safePlayers(draft.players) || (draft.id !== null && !safeId(draft.id))))) {
    return { ok: false, error: "invalidData" };
  }
  const playIds = new Set(validPlays.map((p) => p.id));
  const bookIds = new Set(validBooks.map((b) => b.id));
  if (playIds.size !== validPlays.length || bookIds.size !== validBooks.length) return { ok: false, error: "invalidData" };
  if (validBooks.some((b) => b.plays.some((id) => !playIds.has(id)))) return { ok: false, error: "invalidData" };
  if (typeof raw.exported !== "string" || Number.isNaN(Date.parse(raw.exported))) return { ok: false, error: "invalidData" };
  return {
    ok: true,
    file: { kind: BACKUP_KIND, version: BACKUP_VERSION, exported: raw.exported, plays: validPlays, playbooks: validBooks, team, draft },
  };
}

export function planBackupRestore(file: BackupFile, current: BackupState, mode: RestoreMode): RestorePlan {
  const incomingPlays = Object.fromEntries(file.plays.map((p) => [p.id, p]));
  const incomingBooks = Object.fromEntries(file.playbooks.map((b) => [b.id, b]));
  const currentPlayIds = new Set(Object.keys(current.plays));
  const currentBookIds = new Set(Object.keys(current.playbooks));
  return {
    mode,
    state: {
      plays: mode === "merge" ? { ...current.plays, ...incomingPlays } : incomingPlays,
      playbooks: mode === "merge" ? { ...current.playbooks, ...incomingBooks } : incomingBooks,
      team: file.team,
      draft: file.draft,
    },
    incomingPlays: file.plays.length,
    incomingPlaybooks: file.playbooks.length,
    matchingPlays: file.plays.filter((p) => currentPlayIds.has(p.id)).length,
    matchingPlaybooks: file.playbooks.filter((b) => currentBookIds.has(b.id)).length,
    currentOnlyPlays: Object.keys(current.plays).filter((id) => !(id in incomingPlays)).length,
    currentOnlyPlaybooks: Object.keys(current.playbooks).filter((id) => !(id in incomingBooks)).length,
  };
}

/** Commits all four storage keys together; writeMany restores their prior values on failure. */
export function applyBackupRestore(plan: RestorePlan, storage?: StorageLike | null): void {
  writeMany([
    [PLAYS_KEY, plan.state.plays],
    [PLAYBOOKS_KEY, plan.state.playbooks],
    [TEAM_KEY, plan.state.team],
    [DRAFT_KEY, plan.state.draft],
  ], storage);
}
