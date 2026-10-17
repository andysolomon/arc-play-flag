/**
 * The device's side of a coach's account (docs/adr/012-coach-accounts.md): the plays, playbooks,
 * team settings and lineups on this device mirror one of the account's teams, and every write to
 * them goes up to that team; another device signed in to the account brings them down. The library
 * (lib/play/library.ts) and storage are unchanged: this engine reads what they wrote and writes
 * what the account sends, so every screen keeps working signed out, offline, or with accounts off.
 *
 * Ways this could go wrong, written down before the code:
 *
 * - A1 accounts are not set up on this deployment: the panel says so and nothing else changes.
 * - A2 nobody is signed in: the device works as it always has; nothing is uploaded.
 * - A3 a coach signs in on a device with work on it that no team of theirs mirrors: a team is made
 *   from that work, named after the team settings (or "My team"); nothing on the device is dropped.
 * - A4 a coach signs in on an empty device: the team the account opened last comes down, else its
 *   first; an account with no teams gets an empty "My team".
 * - A5 the device mirrors a team of this account: changes made here since the last push (signed out,
 *   offline) are pushed; a team written elsewhere since comes down.
 * - A6 the device mirrors a team that isn't this account's (deleted, or another coach's): A3 when the
 *   device has work, A4 when it doesn't.
 * - A7 a write while offline, or a push that fails: the write stays on the device, marked as not yet
 *   pushed, and goes up when the device is back online, the page is focused, or on the next write.
 * - A8 two devices change one team: the later push is refused with the account's copy, the device
 *   merges it in (its own version of a play wins, the other device's new plays and books are kept,
 *   its team settings and lineups stand) and pushes again.
 * - A9 the team is deleted from another device: a push finds it gone and makes a new team from the
 *   device's work, so nothing is lost.
 * - A10 switching teams with a push pending: the push goes first; when it can't (offline), the switch
 *   is refused and says so.
 * - A11 signing out with a push pending: refused the same way. Signing out clears the device, since
 *   the work is in the account; signing in brings it back.
 * - A12 the session ends while working: the next push is refused as signed out; the device keeps
 *   everything and its marker, so signing in again pushes (A5).
 * - A13 storage is blocked (a private window): a pull can't land and says so; nothing is reported done.
 * - A14 the team is bigger than an account holds: the push is refused and says so; the device keeps it.
 * - A15 too many requests: the push waits and goes again later.
 * - A16 the draft on the chalkboard and the playbook picked in the designer are the device's: they
 *   never go to the account, and a switch to another team clears them.
 * - A17 a switch to another team reloads the page, so every screen reads the new team from the start.
 * - A18 one write that changes nothing (a pick remembered, a refresh): compared with what was last
 *   pushed or pulled, and not pushed.
 */
import { refresh, subscribe } from "@/lib/play/library";
import { CURRENT_BOOK_KEY } from "@/lib/play/current-book";
import {
  DRAFT_KEY, LINEUPS_KEY, PLAYBOOKS_KEY, PLAYS_KEY, StorageError, TEAM_KEY, failureMessage, readAll, readLineups, readPlaybooks, readTeam,
  writeMany,
} from "@/lib/play/storage";
import * as api from "./api";
import { ApiError } from "./api";
import { UNNAMED_TEAM, canonical, emptyTeamData, hasWork, mergeTeamData } from "./data";
import type { AccountMode, AccountResponse, AccountUser, TeamData, TeamRecord, TeamSummary } from "./types";

/**
 * Which team this device mirrors, the rev it last agreed with the account on, whether anything written
 * since has not gone up, and a hash of the data as it was then, so a write made signed out (A5) or in
 * another tab is seen for what it is on the next sign-in.
 */
export const MARKER_KEY = "ffpd.account.v1";
export interface Marker {
  teamId: string;
  rev: number;
  dirty: boolean;
  hash?: string;
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
  /** the team this device mirrors, when it mirrors one of the account's */
  teamId: string | null;
  status: SyncStatus;
  /** the last problem, in one line, or null */
  message: string | null;
}

const INITIAL: AccountState = { mode: "unknown", user: null, teams: [], teamId: null, status: "idle", message: null };
let state: AccountState = INITIAL;
const listeners = new Set<() => void>();
const emit = (): void => { for (const cb of listeners) cb(); };
function set(patch: Partial<AccountState>): void {
  state = { ...state, ...patch };
  emit();
}

export function subscribeAccount(cb: () => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}
export const getAccountState = (): AccountState => state;
export const getServerAccountState = (): AccountState => INITIAL;

/** The team this device mirrors, as the account lists it. */
export const currentTeam = (s: AccountState = state): TeamSummary | null => s.teams.find((t) => t.id === s.teamId) ?? null;

// ---- the device ----------------------------------------------------------------------------------

export function readMarker(): Marker | null {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(MARKER_KEY) ?? "null");
    if (typeof v !== "object" || v === null) return null;
    const m = v as Record<string, unknown>;
    if (typeof m.teamId !== "string" || !m.teamId || typeof m.rev !== "number") return null;
    return { teamId: m.teamId, rev: m.rev, dirty: m.dirty === true, ...(typeof m.hash === "string" ? { hash: m.hash } : {}) };
  } catch {
    return null;
  }
}

function writeMarker(m: Marker | null): void {
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

/** True while this engine is writing the device, so its own writes are not taken for the coach's. */
let applying = false;
/** The data as last pushed or pulled, canonical; null while unknown. */
let lastSynced: string | null = null;

/** Writes a team's data to the device as one change (A13: a failed write lands nothing and throws). */
function applyData(data: TeamData, clearDevice: boolean): void {
  applying = true;
  try {
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
  } finally {
    applying = false;
  }
}

/** Takes the team's data off the device (A11): the account has it. */
function clearDevice(): void {
  applying = true;
  try {
    for (const k of [PLAYS_KEY, PLAYBOOKS_KEY, TEAM_KEY, LINEUPS_KEY, DRAFT_KEY, CURRENT_BOOK_KEY, MARKER_KEY]) {
      try { localStorage.removeItem(k); } catch { /* nothing to keep */ }
    }
    lastSynced = null;
    refresh();
  } finally {
    applying = false;
  }
}

// ---- pushing ----------------------------------------------------------------------------------

const PUSH_DELAY = 1_200;
let pushTimer = 0;
let pushing: Promise<boolean> | null = null;
let pushAgain = false;

/** Records that the device and the account agree on `data` at `rev`. */
function synced(teamId: string, rev: number, data: TeamData): void {
  lastSynced = canonical(data);
  writeMarker({ teamId, rev, dirty: false, hash: hashOf(lastSynced) });
}

/** True when the device holds something other than what its marker says the account last had. */
function changedSinceMarker(m: Marker): boolean {
  return m.dirty || (m.hash !== undefined && m.hash !== hashOf(canonical(deviceData())));
}

/** A write landed on the device: it goes up shortly, with any that follow (A7, A18). */
function noteWrite(): void {
  if (applying) return;
  const m = readMarker();
  if (!state.user || !state.teamId) {
    // signed out (A2) or not settled yet: a change to a mirrored team is remembered for the next sign-in (A5)
    if (m && !m.dirty && !state.user && changedSinceMarker(m)) writeMarker({ ...m, dirty: true });
    return;
  }
  if (lastSynced !== null && canonical(deviceData()) === lastSynced) return;
  if (m && !m.dirty) writeMarker({ ...m, dirty: true });
  set({ status: "pending", message: null });
  window.clearTimeout(pushTimer);
  pushTimer = window.setTimeout(() => { void push(); }, PUSH_DELAY);
}

function problem(e: unknown): Pick<AccountState, "status" | "message"> {
  if (e instanceof StorageError) return { status: "error", message: failureMessage(e) };
  if (e instanceof ApiError) {
    if (e.status === 0) return { status: navigator.onLine ? "error" : "offline", message: navigator.onLine ? e.message : null };
    if (e.status === 429) return { status: "pending", message: "Your account is busy. Trying again in a while." };
    return { status: "error", message: e.message };
  }
  return { status: "error", message: "Something went wrong with your account. Your work stays on this device." };
}

/** Pushes the device's data to its team. Resolves true when the account has it. */
export function push(): Promise<boolean> {
  if (pushing) { pushAgain = true; return pushing; }
  pushing = (async () => {
    window.clearTimeout(pushTimer);
    const m = readMarker();
    if (!state.user || !m || m.teamId !== state.teamId) return false;
    let data = deviceData();
    // nothing new since the last push or pull (A18): a resume or a second go is no write
    if (!m.dirty && lastSynced !== null && canonical(data) === lastSynced) { set({ status: "saved" }); return true; }
    set({ status: "saving", message: null });
    try {
      let rev = m.rev;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const summary = await api.writeTeam(m.teamId, data, rev);
          synced(m.teamId, summary.rev, data);
          set({ status: "saved", message: null, teams: state.teams.map((t) => (t.id === summary.id ? summary : t)) });
          return true;
        } catch (e) {
          if (!(e instanceof ApiError) || e.status !== 409 || !e.record || attempt === 1) throw e;
          // A8: the account's copy comes in under this device's, and the whole goes up over its rev
          data = mergeTeamData(data, e.record.data);
          rev = e.record.rev;
          applyData(data, false);
          writeMarker({ teamId: m.teamId, rev, dirty: true });
        }
      }
      return false;
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        // A12: the device keeps its marker, dirty, for the next sign-in
        set({ user: null, teams: [], teamId: null, status: "idle", message: "You were signed out. Sign in again to keep saving to your account." });
        return false;
      }
      if (e instanceof ApiError && e.status === 404) {
        // A9: the team is gone from the account; the device's work becomes a new one
        try {
          const record = await api.createTeam({ data: deviceData() });
          adopt(record, false);
          set({ status: "saved", message: "That team was deleted elsewhere, so this device's work is now a new team.", teams: [...state.teams, summaryOf(record)], teamId: record.id });
          return true;
        } catch (e2) {
          set(problem(e2));
          return false;
        }
      }
      set(problem(e));
      return false;
    }
  })().finally(() => {
    pushing = null;
    if (pushAgain) { pushAgain = false; void push(); }
  });
  return pushing;
}

const summaryOf = (r: TeamRecord): TeamSummary => ({ id: r.id, name: r.name, color: r.color, plays: r.plays, playbooks: r.playbooks, updated: r.updated, rev: r.rev });

/** Makes the device mirror a team just read or made, with its data on the device as read. */
function adopt(record: TeamRecord, clear: boolean): void {
  applyData(record.data, clear);
  synced(record.id, record.rev, record.data);
}

// ---- starting ----------------------------------------------------------------------------------

let started = false;
let wired = false;

function wire(): void {
  if (wired) return;
  wired = true;
  subscribe(noteWrite);
  const resume = () => {
    if (state.mode === "unknown" || (state.mode !== "off" && !state.user && state.status === "offline")) { started = false; void start(); return; }
    if (state.user && readMarker()?.dirty) void push();
  };
  window.addEventListener("online", resume);
  window.addEventListener("focus", resume);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") resume(); });
}

/** Finds out who is signed in and settles the device against their account (A1–A6). Once per visit; again after a sign-in. */
export async function start(): Promise<void> {
  if (started) return;
  started = true;
  wire();
  set({ status: "checking", message: null });
  let res: AccountResponse;
  try {
    res = await api.account();
  } catch (e) {
    // the device may well be signed in and offline: the panel says so when it mirrors a team, instead of offering sign-in
    set({ ...problem(e), mode: state.mode, teamId: readMarker()?.teamId ?? null });
    return;
  }
  if (res.mode === "off") { set({ mode: "off", user: null, teams: [], teamId: null, status: "idle", message: null }); return; }
  if (!res.user) { set({ mode: res.mode, user: null, teams: [], teamId: null, status: "idle", message: null }); return; }
  set({ mode: res.mode, user: res.user, teams: res.teams, teamId: null, status: "checking", message: null });
  try {
    await settle(res.teams, res.current);
  } catch (e) {
    set(problem(e));
  }
}

async function settle(teams: readonly TeamSummary[], current: string | null): Promise<void> {
  const marker = readMarker();
  const mine = marker ? teams.find((t) => t.id === marker.teamId) : undefined;
  const device = deviceData();
  if (marker && mine) {
    set({ teamId: mine.id });
    if (changedSinceMarker(marker)) {
      // A5: written here since the device last agreed with the account (signed out, offline, another tab)
      writeMarker({ ...marker, dirty: true });
      lastSynced = null;
      await push();
      return;
    }
    if (mine.rev !== marker.rev) {
      // A5: written elsewhere since this device last agreed with it
      adopt(await api.readTeam(mine.id), false);
      set({ status: "saved", message: null });
      return;
    }
    lastSynced = canonical(device);
    set({ status: "saved", message: null });
    return;
  }
  if (hasWork(device)) {
    // A3, A6: the device's work becomes a team of this account
    const record = await api.createTeam({ data: device });
    adopt(record, false);
    set({ teams: [...teams, summaryOf(record)], teamId: record.id, status: "saved", message: null });
    return;
  }
  const target = (current && teams.find((t) => t.id === current)) ?? teams[0];
  if (target) {
    // A4: the account's team comes down onto the empty device
    adopt(await api.readTeam(target.id), true);
    set({ teamId: target.id, status: "saved", message: null });
    if (target.id !== current) void api.setCurrent(target.id).catch(() => undefined);
    return;
  }
  const record = await api.createTeam({ data: emptyTeamData(UNNAMED_TEAM) });
  adopt(record, true);
  set({ teams: [summaryOf(record)], teamId: record.id, status: "saved", message: null });
}

/** After a sign-in or sign-out the page didn't reload for (Clerk's), the account is read again. */
export function accountChanged(): void {
  started = false;
  void start();
}

// ---- what the panel does ----------------------------------------------------------------------------------

/** How Clerk signs out and opens the profile, registered by the bridge inside its provider. */
export interface AuthBridge {
  signOut: () => Promise<void>;
  openProfile?: () => void;
}
let bridge: AuthBridge | null = null;
export function registerAuthBridge(b: AuthBridge | null): void {
  bridge = b;
}
export const canOpenProfile = (): boolean => !!bridge?.openProfile;
export function openProfile(): void {
  bridge?.openProfile?.();
}

/** The pending push, done; false (with the panel told why) when it can't be (A10, A11). */
async function flushed(): Promise<boolean> {
  if (!readMarker()?.dirty && lastSynced !== null && canonical(deviceData()) === lastSynced) return true;
  if (await push()) return true;
  set({ message: "Your latest changes aren't in your account yet. Connect and try again." });
  return false;
}

/** Makes another of the account's teams the one this device mirrors, and reloads (A17). */
export async function switchTeam(id: string): Promise<void> {
  if (!state.user || id === state.teamId || !state.teams.some((t) => t.id === id)) return;
  if (!(await flushed())) return;
  set({ status: "busy", message: null });
  try {
    adopt(await api.readTeam(id), true);
    await api.setCurrent(id).catch(() => undefined);
    window.location.reload();
  } catch (e) {
    set(problem(e));
  }
}

/** Makes an empty team and switches to it. */
export async function createTeam(name: string): Promise<void> {
  if (!state.user) return;
  if (!(await flushed())) return;
  set({ status: "busy", message: null });
  try {
    const record = await api.createTeam({ name: name.trim() || UNNAMED_TEAM });
    adopt(record, true);
    window.location.reload();
  } catch (e) {
    set(problem(e));
  }
}

/** Deletes a team from the account. The team this device mirrors goes with its data; the page reloads onto another. */
export async function deleteTeam(id: string): Promise<void> {
  if (!state.user) return;
  set({ status: "busy", message: null });
  try {
    await api.deleteTeam(id);
    if (id === state.teamId) {
      clearDevice();
      window.location.reload();
      return;
    }
    set({ teams: state.teams.filter((t) => t.id !== id), status: readMarker()?.dirty ? "pending" : "saved" });
  } catch (e) {
    set(problem(e));
  }
}

/** Signs out, after the last push, and clears the device (A11). */
export async function signOut(): Promise<void> {
  if (!state.user) return;
  if (!(await flushed())) return;
  set({ status: "busy", message: null });
  try {
    clearDevice();
    if (state.mode === "fixture") await api.fixtureSignOut();
    else await bridge?.signOut();
    // a full load on purpose (A17): the designer starts over with nothing of the account on the device
    window.location.assign(new URL("/", window.location.origin).href);
  } catch (e) {
    set(problem(e));
  }
}

/** Where sign-in lives. */
export const SIGN_IN_PATH = "/sign-in";
