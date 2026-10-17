/**
 * What the account engines share (docs/adr/012-coach-accounts.md, docs/adr/013-organizations.md): the
 * state every panel reads, the device's marker saying which team it mirrors, and the two ways the
 * engines write the device whole. lib/account/sync.ts runs a coach's own team, lib/org/sync.ts an
 * organization's; neither imports the other's internals.
 */
import { refresh } from "@/lib/play/library";
import { CURRENT_BOOK_KEY } from "@/lib/play/current-book";
import {
  DRAFT_KEY, LINEUPS_KEY, PLAYBOOKS_KEY, PLAYS_KEY, StorageError, TEAM_KEY, failureMessage, readAll, readLineups, readPlaybooks, readTeam, writeMany,
} from "@/lib/play/storage";
import { ApiError } from "./api";
import { canonical } from "./data";
import type { AccountMode, AccountUser, TeamData, TeamSummary } from "./types";
import type { Level, OrgMode, OrgSummary, OrgTeamSummary, Presence } from "@/lib/org/types";

/**
 * Which team this device mirrors, the rev it last agreed with the account on, whether anything written
 * since has not gone up, and a hash of the data as it was then, so a write made signed out (A5) or in
 * another tab is seen for what it is on the next sign-in. An organization's team names its
 * organization and what the coach may do on it; its records are lib/org/sync.ts's.
 */
export const MARKER_KEY = "ffpd.account.v1";
/** the organization engine's own record of the team: per-record hashes, pending changes, stamps */
export const ORG_KEY = "ffpd.org.v1";
export interface Marker {
  teamId: string;
  rev: number;
  dirty: boolean;
  hash?: string;
  org?: string;
  level?: Level;
}

/** FNV-1a over the canonical JSON: short, cheap, and enough to tell "changed" from "the same". */
export function hashOf(canonicalJson: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < canonicalJson.length; i++) {
    h ^= canonicalJson.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36) + canonicalJson.length.toString(36);
}

export type SyncStatus =
  | "idle"
  /** asking the account who is signed in */
  | "checking"
  | "saving"
  | "saved"
  /** a write is on the device and not yet in the account (A7) */
  | "pending"
  | "offline"
  | "error"
  /** a switch, a new team, a deletion or a sign-out is in flight */
  | "busy";

export interface AccountState {
  mode: AccountMode | "unknown";
  user: AccountUser | null;
  teams: readonly TeamSummary[];
  /** the team this device mirrors, when it mirrors one of the account's or an organization's */
  teamId: string | null;
  status: SyncStatus;
  /** the last problem, in one line, or null */
  message: string | null;
  /** organizations (ADR 013): whether they are on, the coach's, every team of theirs the coach sees */
  orgMode: OrgMode | "unknown";
  orgs: readonly OrgSummary[];
  orgTeams: readonly OrgTeamSummary[];
  /** the organization of the team this device mirrors, and what the coach may do on it; null for a coach's own team */
  org: string | null;
  level: Level | null;
  /** the other coaches on this team right now */
  presence: readonly Presence[];
  /** something another coach did to the team, in one line, for a moment */
  notice: string | null;
}

export const INITIAL: AccountState = {
  mode: "unknown", user: null, teams: [], teamId: null, status: "idle", message: null,
  orgMode: "unknown", orgs: [], orgTeams: [], org: null, level: null, presence: [], notice: null,
};
let state: AccountState = INITIAL;
const listeners = new Set<() => void>();
const emit = (): void => { for (const cb of listeners) cb(); };
export function set(patch: Partial<AccountState>): void {
  state = { ...state, ...patch };
  emit();
}
export function subscribeAccount(cb: () => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}
export const getAccountState = (): AccountState => state;
export const getServerAccountState = (): AccountState => INITIAL;

/** The team this device mirrors, as the account lists it (a coach's own team; an organization's is `currentOrgTeam`). */
export const currentTeam = (s: AccountState = state): TeamSummary | null => s.teams.find((t) => t.id === s.teamId) ?? null;
export const currentOrgTeam = (s: AccountState = state): OrgTeamSummary | null => (s.org ? s.orgTeams.find((t) => t.id === s.teamId && t.org === s.org) ?? null : null);

// ---- the device ----------------------------------------------------------------------------------

export function readMarker(): Marker | null {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(MARKER_KEY) ?? "null");
    if (typeof v !== "object" || v === null) return null;
    const m = v as Record<string, unknown>;
    if (typeof m.teamId !== "string" || !m.teamId || typeof m.rev !== "number") return null;
    return {
      teamId: m.teamId, rev: m.rev, dirty: m.dirty === true,
      ...(typeof m.hash === "string" ? { hash: m.hash } : {}),
      ...(typeof m.org === "string" && m.org ? { org: m.org } : {}),
      ...(m.level === 0 || m.level === 1 || m.level === 2 || m.level === 3 ? { level: m.level } : {}),
    };
  } catch {
    return null;
  }
}

export function writeMarker(m: Marker | null): void {
  try {
    if (m) localStorage.setItem(MARKER_KEY, JSON.stringify(m));
    else localStorage.removeItem(MARKER_KEY);
  } catch {
    /* a blocked storage costs the marker its memory past this visit; the data it describes is checked on every visit anyway */
  }
}

/** What the device holds, as a team's data (A16: no draft, no picked book). */
export function deviceData(): TeamData {
  return { plays: Object.values(readAll()), playbooks: Object.values(readPlaybooks()), team: readTeam(), lineups: readLineups() };
}

/** True while an engine is writing the device, so its own writes are not taken for the coach's. */
let applying = false;
export const isApplying = (): boolean => applying;
/** The data as last pushed or pulled, canonical; null while unknown. */
let lastSynced: string | null = null;
export const getLastSynced = (): string | null => lastSynced;
export function setLastSynced(v: string | null): void { lastSynced = v; }

/** Runs an engine's own write to the device, so the library's listeners don't take it for the coach's. */
export function applied<T>(fn: () => T): T {
  applying = true;
  try {
    return fn();
  } finally {
    applying = false;
  }
}

/** Writes a team's data to the device as one change (A13: a failed write lands nothing and throws). */
export function applyData(data: TeamData, clearDevice: boolean): void {
  applied(() => {
    writeMany([
      [PLAYS_KEY, Object.fromEntries(data.plays.map((p) => [p.id, p]))],
      [PLAYBOOKS_KEY, Object.fromEntries(data.playbooks.map((b) => [b.id, b]))],
      [TEAM_KEY, data.team],
      [LINEUPS_KEY, data.lineups],
      ...(clearDevice ? [[DRAFT_KEY, null] as const] : []),
    ]);
    if (clearDevice) {
      try { localStorage.removeItem(CURRENT_BOOK_KEY); } catch { /* the pick is a convenience */ }
    }
    lastSynced = canonical(deviceData());
    refresh();
  });
}

/** Takes the team's data off the device (A11): the account has it. */
export function clearDevice(): void {
  applied(() => {
    for (const k of [PLAYS_KEY, PLAYBOOKS_KEY, TEAM_KEY, LINEUPS_KEY, DRAFT_KEY, CURRENT_BOOK_KEY, MARKER_KEY, ORG_KEY]) {
      try { localStorage.removeItem(k); } catch { /* nothing to keep */ }
    }
    lastSynced = null;
    refresh();
  });
}

export function problem(e: unknown): Pick<AccountState, "status" | "message"> {
  if (e instanceof StorageError) return { status: "error", message: failureMessage(e) };
  if (e instanceof ApiError) {
    if (e.status === 0) return { status: navigator.onLine ? "error" : "offline", message: navigator.onLine ? e.message : null };
    if (e.status === 429) return { status: "pending", message: "Your account is busy. Trying again in a while." };
    return { status: "error", message: e.message };
  }
  return { status: "error", message: "Something went wrong with your account. Your work stays on this device." };
}
