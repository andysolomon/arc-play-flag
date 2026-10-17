import { DEFAULT_END_ZONE, parseEndZone } from "@/lib/endzone";
import { LOS_YARD, readLos } from "@/lib/play/field";
import { defaultLineups } from "@/lib/play/lineup";
import { parsePlaces } from "@/lib/play/reader";
import {
  DEFAULT_TEAM, normalizeDraft, normalizeLineups, normalizePlaybook, normalizeSavedPlay, normalizeTeam, settleBook,
} from "@/lib/play/storage";
import type { Playbook, SavedPlay } from "@/lib/play/types";
import { parseShares } from "@/lib/sharing/shares";
import { parseThemeChoice } from "@/lib/theme";
import type { AccountPrefs, CoachPrefs, TeamData, TeamSummary } from "./types";

/** Teams one account may hold. */
export const MAX_TEAMS = 12;
/** A team's data as JSON, at most (bigger than any library this app writes; the share API allows the same). */
export const MAX_TEAM_BYTES = 4_000_000;
export const MAX_TEAM_PLAYS = 1_000;
export const MAX_TEAM_PLAYBOOKS = 1_000;
/** The name a team gets when its settings have none. */
export const UNNAMED_TEAM = "My team";
/** Touchdowns an account counts up to: more than a coach throws. */
export const MAX_TOUCHDOWNS = 1_000_000_000;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const UNSAFE = new Set(["__proto__", "constructor", "prototype"]);
const safeId = (id: string): boolean => id.length > 0 && !UNSAFE.has(id);

/** The desk of a team that has none yet: a clear board, no pick, no places, no links. */
export const EMPTY_DESK: Pick<TeamData, "draft" | "currentBook" | "reader" | "shares"> = { draft: null, currentBook: null, reader: {}, shares: {} };

/**
 * A team's data from any JSON-ish value, read the way the device reads its own storage: every play
 * and book normalized, ids made unique, a book's reference to a play that isn't there dropped, the
 * pick and the reader's places kept only for books that are there. Null when it isn't a record with
 * lists of plays and books, or holds more than a team may.
 */
export function readTeamData(raw: unknown): TeamData | null {
  if (!isRecord(raw) || !Array.isArray(raw.plays) || !Array.isArray(raw.playbooks)) return null;
  if (raw.plays.length > MAX_TEAM_PLAYS || raw.playbooks.length > MAX_TEAM_PLAYBOOKS) return null;
  const plays: SavedPlay[] = [];
  const seen = new Set<string>();
  for (const v of raw.plays) {
    const p = normalizeSavedPlay(v);
    if (!p || !safeId(p.id) || seen.has(p.id)) continue;
    seen.add(p.id);
    plays.push(p);
  }
  const playbooks: Playbook[] = [];
  const books = new Set<string>();
  for (const v of raw.playbooks) {
    const b = normalizePlaybook(v);
    if (!b || !safeId(b.id) || books.has(b.id)) continue;
    books.add(b.id);
    playbooks.push(settleBook({ ...b, plays: b.plays.filter((id) => seen.has(id)) }));
  }
  const reader = Object.fromEntries(Object.entries(parsePlaces(raw.reader)).filter(([id]) => books.has(id)));
  return {
    plays,
    playbooks,
    team: normalizeTeam(raw.team) ?? DEFAULT_TEAM,
    lineups: normalizeLineups(raw.lineups) ?? defaultLineups(),
    draft: normalizeDraft(raw.draft),
    currentBook: typeof raw.currentBook === "string" && books.has(raw.currentBook) ? raw.currentBook : null,
    reader,
    shares: parseShares(raw.shares),
  };
}

/** True when a record was written by a build from before the desk went up (ADR 014): it names none of the desk's keys. */
export const lacksDesk = (raw: unknown): boolean => isRecord(raw) && !("draft" in raw) && !("currentBook" in raw) && !("reader" in raw) && !("shares" in raw);

/** A team's data as stored by any version: one from before the desk reads with an empty desk. */
export function completeTeamData(stored: Partial<TeamData> & Pick<TeamData, "plays" | "playbooks" | "team" | "lineups">): TeamData {
  return { ...EMPTY_DESK, ...stored };
}

/** A team with nothing in it yet, wearing a name and colour. */
export function emptyTeamData(name: string, color: string = DEFAULT_TEAM.color): TeamData {
  return { plays: [], playbooks: [], team: normalizeTeam({ name, color }) ?? DEFAULT_TEAM, lineups: defaultLineups(), ...EMPTY_DESK };
}

/** The name a team is listed under: its settings' name, or a stand-in when there is none. */
export const teamName = (data: TeamData): string => data.team.name.trim() || UNNAMED_TEAM;

/** True when there is anything on the device worth an account: a play, a book, a team name, a name on a lineup. A sketch on the board alone is not (A23). */
export function hasWork(data: TeamData): boolean {
  return data.plays.length > 0 || data.playbooks.length > 0 || data.team.name.trim().length > 0
    || data.lineups.lineups.some((l) => l.slots.length > 0) || data.lineups.players.length > 0;
}

/**
 * Two devices' versions of one team as one (ADR 012, A8): every play and book from both, this device's
 * version of any it also has, in the account's order with this device's additions after; the team's
 * settings and lineups are this device's, since they are what the coach last touched here, and so is
 * the board when this device has anything on it (A22). The reader's places and share links are both
 * devices', this device's word on any book or play both know.
 */
export function mergeTeamData(local: TeamData, remote: TeamData): TeamData {
  const plays = new Map(remote.plays.map((p) => [p.id, p] as const));
  for (const p of local.plays) plays.set(p.id, p);
  const books = new Map(remote.playbooks.map((b) => [b.id, b] as const));
  for (const b of local.playbooks) books.set(b.id, b);
  const ids = new Set(plays.keys());
  const shares = { ...remote.shares };
  for (const [id, links] of Object.entries(local.shares)) {
    const tokens = new Set(links.map((l) => l.token));
    shares[id] = [...links, ...(shares[id] ?? []).filter((l) => !tokens.has(l.token))];
  }
  const currentBook = local.currentBook ?? remote.currentBook;
  return {
    plays: [...plays.values()],
    playbooks: [...books.values()].map((b) => settleBook({ ...b, plays: b.plays.filter((id) => ids.has(id)) })),
    team: local.team,
    lineups: local.lineups,
    draft: local.draft ?? remote.draft,
    currentBook: currentBook && books.has(currentBook) ? currentBook : null,
    reader: Object.fromEntries(Object.entries({ ...remote.reader, ...local.reader }).filter(([id]) => books.has(id))),
    shares,
  };
}

/** The team as the account lists it. */
export function summarize(id: string, data: TeamData, rev: number, updated: string): TeamSummary {
  return { id, name: teamName(data), color: data.team.color, plays: data.plays.length, playbooks: data.playbooks.length, updated, rev };
}

/** Compares two teams' data without regard to key order. */
export function sameTeamData(a: TeamData, b: TeamData): boolean {
  return canonical(a) === canonical(b);
}

// ---- the coach's look ----------------------------------------------------------------------------------

/** What a coach gets before they pick anything: the device's own light or dark, the green field, the classic end zone, the ball on the drive start. */
export const DEFAULT_PREFS: CoachPrefs = {
  theme: "auto", field: "standard", endZone: DEFAULT_END_ZONE, deepField: false, los: LOS_YARD, touchdowns: 0, firstUseDone: false,
};

/** A whole number of touchdowns from any value, within what an account counts. */
export const readTouchdowns = (v: unknown): number =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? Math.min(v, MAX_TOUCHDOWNS) : 0;

/** The coach's look from any JSON-ish value, each choice read the way the device reads its own: anything that isn't one is the default. */
export function readPrefs(raw: unknown): CoachPrefs {
  if (!isRecord(raw)) return { ...DEFAULT_PREFS };
  return {
    theme: parseThemeChoice(raw.theme),
    field: raw.field === "themed" ? "themed" : "standard",
    endZone: parseEndZone(raw.endZone),
    deepField: raw.deepField === true,
    los: readLos(raw.los),
    touchdowns: readTouchdowns(raw.touchdowns),
    firstUseDone: raw.firstUseDone === true,
  };
}

/** True when the coach picked anything on this device: a look that isn't the defaults is theirs, and wins over the account's (A26). */
export const hasLook = (p: CoachPrefs): boolean => canonical(readPrefs(p)) !== canonical(DEFAULT_PREFS);

/** The look with its rev, as the account hands it out. */
export const withRev = (prefs: CoachPrefs, rev: number): AccountPrefs => ({ ...readPrefs(prefs), rev });

/** The look without its rev, as a device holds it. */
export const devicePrefsOf = (prefs: AccountPrefs): CoachPrefs => readPrefs(prefs);

/**
 * Two devices' looks as one (A8, A25): this device's choices, since the coach made them here last, and
 * the higher count of touchdowns, so an end zone opened anywhere stays open.
 */
export function mergePrefs(local: CoachPrefs, remote: CoachPrefs): CoachPrefs {
  return { ...local, touchdowns: Math.max(local.touchdowns, remote.touchdowns) };
}

/** JSON with keys sorted, so two reads of the same data are the same string. */
export function canonical(v: unknown): string {
  return JSON.stringify(sortKeys(v));
}

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (!isRecord(v)) return v;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(v).sort()) out[k] = sortKeys(v[k]);
  return out;
}
