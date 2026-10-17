import { defaultLineups } from "@/lib/play/lineup";
import { DEFAULT_TEAM, normalizeLineups, normalizePlaybook, normalizeSavedPlay, normalizeTeam, settleBook } from "@/lib/play/storage";
import type { Playbook, SavedPlay } from "@/lib/play/types";
import type { TeamData, TeamSummary } from "./types";

/** Teams one account may hold. */
export const MAX_TEAMS = 12;
/** A team's data as JSON, at most (bigger than any library this app writes; the share API allows the same). */
export const MAX_TEAM_BYTES = 4_000_000;
export const MAX_TEAM_PLAYS = 1_000;
export const MAX_TEAM_PLAYBOOKS = 1_000;
/** The name a team gets when its settings have none. */
export const UNNAMED_TEAM = "My team";

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const UNSAFE = new Set(["__proto__", "constructor", "prototype"]);
const safeId = (id: string): boolean => id.length > 0 && !UNSAFE.has(id);

/**
 * A team's data from any JSON-ish value, read the way the device reads its own storage: every play
 * and book normalized, ids made unique, a book's reference to a play that isn't there dropped. Null
 * when it isn't a record with lists of plays and books, or holds more than a team may.
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
  return {
    plays,
    playbooks,
    team: normalizeTeam(raw.team) ?? DEFAULT_TEAM,
    lineups: normalizeLineups(raw.lineups) ?? defaultLineups(),
  };
}

/** A team with nothing in it yet, wearing a name and colour. */
export function emptyTeamData(name: string, color: string = DEFAULT_TEAM.color): TeamData {
  return { plays: [], playbooks: [], team: normalizeTeam({ name, color }) ?? DEFAULT_TEAM, lineups: defaultLineups() };
}

/** The name a team is listed under: its settings' name, or a stand-in when there is none. */
export const teamName = (data: TeamData): string => data.team.name.trim() || UNNAMED_TEAM;

/** True when there is anything on the device worth an account: a play, a book, a team name, a name on a lineup. */
export function hasWork(data: TeamData): boolean {
  return data.plays.length > 0 || data.playbooks.length > 0 || data.team.name.trim().length > 0
    || data.lineups.lineups.some((l) => l.slots.length > 0) || data.lineups.players.length > 0;
}

/**
 * Two devices' versions of one team as one (ADR 012, A8): every play and book from both, this device's
 * version of any it also has, in the account's order with this device's additions after; the team's
 * settings and lineups are this device's, since they are what the coach last touched here.
 */
export function mergeTeamData(local: TeamData, remote: TeamData): TeamData {
  const plays = new Map(remote.plays.map((p) => [p.id, p] as const));
  for (const p of local.plays) plays.set(p.id, p);
  const books = new Map(remote.playbooks.map((b) => [b.id, b] as const));
  for (const b of local.playbooks) books.set(b.id, b);
  const ids = new Set(plays.keys());
  return {
    plays: [...plays.values()],
    playbooks: [...books.values()].map((b) => settleBook({ ...b, plays: b.plays.filter((id) => ids.has(id)) })),
    team: local.team,
    lineups: local.lineups,
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
