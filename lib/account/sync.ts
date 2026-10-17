/**
 * The device's side of a coach's account (docs/adr/012-coach-accounts.md, docs/adr/013-whole-desk-in-account.md):
 * the plays, playbooks, team settings and lineups on this device mirror one of the account's teams,
 * and with them the rest of the desk (the draft on the chalkboard, the playbook picked in the
 * designer, where each book was last read, the share links made here) and the coach's look (theme,
 * field, end zone, Deep field, touchdowns, the guide seen). Every write to any of them goes up to the
 * account; another device signed in brings them down, so a coach picks up exactly where they left
 * off. The library (lib/play/library.ts) and storage are unchanged: this engine reads what they
 * wrote and writes what the account sends, so every screen keeps working signed out, offline, or
 * with accounts off.
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
 * - A16 (ADR 013 supersedes) the draft and the pick are the team's now: see A19.
 * - A17 a switch to another team reloads the page, so every screen reads the new team from the start.
 * - A18 one write that changes nothing (a pick remembered, a refresh): compared with what was last
 *   pushed or pulled, and not pushed.
 * - A19 the board, the pick, the reader's places and the share links go up with the team and come
 *   down with it; the look goes up with every write and comes down whenever the account's is newer,
 *   whichever team was open when it changed.
 * - A20 the board changes on every touch: a touch goes up after a longer quiet than a save does, and
 *   at once when the page is hidden (a tab switched, a phone pocketed), so the next device has it.
 * - A21 a device left open: on focus or coming back online, with nothing pending, it asks the account
 *   whether the team or the look changed elsewhere and brings it down; the board redraws from the
 *   pulled draft (components/App.tsx listens through subscribePulls). A tap mid-pull is lost to the pull.
 * - A22 two devices' boards: when a push is refused as changed elsewhere, this device's board wins
 *   when it has anything on it, since its coach touched it last; the other's is gone.
 * - A23 signing in on a device with a sketch on the board and no saved work: the account's team
 *   comes down, and the sketch stays on the board when the team has none, and goes up.
 * - A24 a build from before the desk went up, still cached by the browser, pushes without it: the
 *   server keeps the desk it has (lib/account/http.ts, teamDataOver).
 * - A25 touchdowns never go backwards: the account keeps the higher count, so an end zone opened on
 *   any device stays open everywhere.
 * - A26 signing in with a look picked on this device: it wins over the account's and goes up; a device
 *   that never picked anything takes the account's look.
 * - A27 the pick names a book that isn't in the team: read as none, and the first book stands in (C1).
 * - A28 signing out clears the look too: the next coach on this device starts with the defaults.
 *
 * Sending a playbook or a play to another of the account's teams (`sendToTeam`), from the playbooks
 * page, writes that team through the same API and leaves this device alone. Its own ways to go wrong:
 *
 * - S1 the other team already has the book, or the play, as it is: nothing is written, and the coach
 *   is told it is already there.
 * - S2 the other team has a play under the same id that differs: it comes in as a copy under a new
 *   id, as a file import would, and the other team's version stands.
 * - S3 the other team was written by one of its devices between the read and the write: the write is
 *   refused with the account's copy, the plan is made again over that copy, and the write goes again.
 * - S4 the other team is gone from the account: the coach is told, and it leaves the list.
 * - S5 the session ended: the coach is told to sign in again; nothing is written.
 * - S6 the other team would be bigger than an account holds, or the account is busy: the coach is
 *   told what the account said; nothing is written.
 * - S7 the team this device mirrors is never a target, and nothing on this device changes: the source
 *   stays, the marker stays, and no push is started.
 */
import { planTransfer, type Transfer } from "@/lib/export/transfer";
import { reread, subscribe } from "@/lib/play/library";
import { CURRENT_BOOK_KEY, readCurrentBook } from "@/lib/play/current-book";
import { subscribeDeviceWrites } from "@/lib/device-writes";
import { READER_KEY, readPlaces } from "@/lib/play/reader";
import {
  DRAFT_KEY, LINEUPS_KEY, PLAYBOOKS_KEY, PLAYS_KEY, StorageError, TEAM_KEY, failureMessage, readAll, readDraft, readLineups, readPlaybooks,
  readTeam, writeMany,
} from "@/lib/play/storage";
import { SHARES_EVENT, SHARES_KEY, readShares } from "@/lib/sharing/shares";
import * as api from "./api";
import { ApiError } from "./api";
import { UNNAMED_TEAM, canonical, devicePrefsOf, emptyTeamData, hasLook, hasWork, mergePrefs, mergeTeamData } from "./data";
import { applyPrefs, clearPrefs, devicePrefs } from "./prefs";
import type { AccountMode, AccountPrefs, AccountResponse, AccountUser, CoachPrefs, TeamData, TeamRecord, TeamSummary } from "./types";

/**
 * Which team this device mirrors, the rev it last agreed with the account on, the rev of the look it
 * last agreed on, whether anything written since has not gone up, and a hash of the desk as it was
 * then, so a write made signed out (A5) or in another tab is seen for what it is on the next sign-in.
 */
export const MARKER_KEY = "ffpd.account.v1";
export interface Marker {
  teamId: string;
  rev: number;
  dirty: boolean;
  hash?: string;
  prefsRev?: number;
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

/** Screens that hold a copy of the device (the chalkboard) hear when the account's desk has landed on it (A21). */
const pullListeners = new Set<() => void>();
export function subscribePulls(cb: () => void): () => void {
  pullListeners.add(cb);
  return () => { pullListeners.delete(cb); };
}
function pulled(): void {
  for (const cb of pullListeners) {
    try { cb(); } catch { /* a listener's failure is its own */ }
  }
}

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
      ...(typeof m.prefsRev === "number" ? { prefsRev: m.prefsRev } : {}),
    };
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

/** What the device holds, as a team's data: the library and the desk (A19). */
export function deviceData(): TeamData {
  return {
    plays: Object.values(readAll()), playbooks: Object.values(readPlaybooks()), team: readTeam(), lineups: readLineups(),
    draft: readDraft(), currentBook: readCurrentBook(), reader: readPlaces(), shares: readShares(),
  };
}

/** The team's data and the coach's look, as the device holds them: what a push carries, and what a hash covers. */
export interface Desk { data: TeamData; prefs: CoachPrefs }
export const deviceDesk = (): Desk => ({ data: deviceData(), prefs: devicePrefs() });

/** True while this engine is writing the device, so its own writes are not taken for the coach's. */
let applying = false;
/** The desk as last pushed or pulled, canonical; null while unknown. */
let lastSynced: string | null = null;

/** Runs a write of the device under the guard, and tells the library and the share counters it was rewritten whole. */
function writing(fn: () => void): void {
  applying = true;
  try {
    fn();
  } finally {
    applying = false;
  }
}

/** Writes a team's data and a look to the device as one change (A13: a failed write lands nothing and throws). */
function applyDesk(data: TeamData, prefs: CoachPrefs): void {
  writing(() => {
    writeMany([
      [PLAYS_KEY, Object.fromEntries(data.plays.map((p) => [p.id, p]))],
      [PLAYBOOKS_KEY, Object.fromEntries(data.playbooks.map((b) => [b.id, b]))],
      [TEAM_KEY, data.team],
      [LINEUPS_KEY, data.lineups],
      [DRAFT_KEY, data.draft],
      [CURRENT_BOOK_KEY, data.currentBook],
      [READER_KEY, data.reader],
      [SHARES_KEY, data.shares],
    ]);
    applyPrefs(prefs);
    lastSynced = canonical(deviceDesk());
    reread();
    window.dispatchEvent(new Event(SHARES_EVENT));
  });
  pulled();
}

/** Puts a look on the device without touching the team (the account's look changed from another team, A19). */
function applyLook(prefs: CoachPrefs): void {
  writing(() => {
    applyPrefs(prefs);
    lastSynced = canonical(deviceDesk());
  });
}

/** Takes the team's data and the look off the device (A11, A28): the account has them. */
function clearDevice(): void {
  writing(() => {
    for (const k of [PLAYS_KEY, PLAYBOOKS_KEY, TEAM_KEY, LINEUPS_KEY, DRAFT_KEY, CURRENT_BOOK_KEY, READER_KEY, SHARES_KEY, MARKER_KEY]) {
      try { localStorage.removeItem(k); } catch { /* nothing to keep */ }
    }
    clearPrefs();
    lastSynced = null;
    reread();
    window.dispatchEvent(new Event(SHARES_EVENT));
  });
}

// ---- pushing ----------------------------------------------------------------------------------

/** A save goes up soon; a touch on the board, a pick of a theme, waits for a longer quiet (A20). */
const PUSH_DELAY = 1_200;
const DESK_DELAY = 5_000;
let pushTimer = 0;
let pushDue = Number.POSITIVE_INFINITY;
let pushing: Promise<boolean> | null = null;
let pushAgain = false;

/** Records that the device and the account agree on the desk at `rev` and the look at `prefsRev`. */
function synced(teamId: string, rev: number, prefsRev: number): void {
  lastSynced = canonical(deviceDesk());
  writeMarker({ teamId, rev, dirty: false, hash: hashOf(lastSynced), prefsRev });
}

/** Marks the device as holding a write the account hasn't got; without a marker there is nothing to mark. */
function markDirty(): void {
  const m = readMarker();
  if (m && !m.dirty) writeMarker({ ...m, dirty: true });
}

/** True when the device holds something other than what its marker says the account last had. */
function changedSinceMarker(m: Marker): boolean {
  return m.dirty || (m.hash !== undefined && m.hash !== hashOf(canonical(deviceDesk())));
}

/** Schedules the push, no later than it already is. */
function schedule(delay: number): void {
  const due = Date.now() + delay;
  if (pushTimer && due >= pushDue) return;
  window.clearTimeout(pushTimer);
  pushDue = due;
  pushTimer = window.setTimeout(() => { pushTimer = 0; pushDue = Number.POSITIVE_INFINITY; void push(); }, delay);
}

/** A write landed on the device: it goes up shortly, with any that follow (A7, A18, A20). */
function noteWrite(delay: number): void {
  if (applying) return;
  const m = readMarker();
  if (!state.user || !state.teamId) {
    // signed out (A2) or not settled yet: a change to a mirrored team is remembered for the next sign-in (A5)
    if (m && !m.dirty && !state.user && changedSinceMarker(m)) writeMarker({ ...m, dirty: true });
    return;
  }
  if (lastSynced !== null && canonical(deviceDesk()) === lastSynced) return;
  markDirty();
  set({ status: "pending", message: null });
  schedule(delay);
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

/** The session is gone (A12): the device keeps its marker, dirty, for the next sign-in. */
function signedOutElsewhere(): void {
  set({ user: null, teams: [], teamId: null, status: "idle", message: "You were signed out. Sign in again to keep saving to your account." });
}

/** Pushes the device's desk to its team. Resolves true when the account has it. */
export function push(): Promise<boolean> {
  if (pushing) { pushAgain = true; return pushing; }
  pushing = (async () => {
    window.clearTimeout(pushTimer);
    pushTimer = 0;
    pushDue = Number.POSITIVE_INFINITY;
    const m = readMarker();
    if (!state.user || !m || m.teamId !== state.teamId) return false;
    let desk = deviceDesk();
    // nothing new since the last push or pull (A18): a resume or a second go is no write
    if (!m.dirty && lastSynced !== null && canonical(desk) === lastSynced) { set({ status: "saved" }); return true; }
    set({ status: "saving", message: null });
    try {
      let rev = m.rev;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const written = await api.writeTeam(m.teamId, desk.data, rev, desk.prefs);
          // the account may hold more touchdowns than this device counted (A25)
          applyLook(devicePrefsOf(written.prefs));
          synced(m.teamId, written.rev, written.prefs.rev);
          set({ status: "saved", message: null, teams: state.teams.map((t) => (t.id === written.id ? summaryOf(written) : t)) });
          return true;
        } catch (e) {
          if (!(e instanceof ApiError) || e.status !== 409 || !e.record || attempt === 1) throw e;
          // A8, A22: the account's copy comes in under this device's, and the whole goes up over its rev
          desk = { data: mergeTeamData(desk.data, e.record.data), prefs: mergePrefs(desk.prefs, devicePrefsOf(e.record.prefs)) };
          rev = e.record.rev;
          applyDesk(desk.data, desk.prefs);
          writeMarker({ teamId: m.teamId, rev, dirty: true });
        }
      }
      return false;
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        signedOutElsewhere();
        return false;
      }
      if (e instanceof ApiError && e.status === 404) {
        // A9: the team is gone from the account; the device's work becomes a new one
        try {
          const record = await api.createTeam({ data: deviceData(), prefs: devicePrefs() });
          adopt(record);
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

const summaryOf = (r: TeamSummary): TeamSummary => ({ id: r.id, name: r.name, color: r.color, plays: r.plays, playbooks: r.playbooks, updated: r.updated, rev: r.rev });

/** Makes the device mirror a team just read or made, with its data and the account's look on the device as read. */
function adopt(record: TeamRecord, prefs: CoachPrefs = devicePrefsOf(record.prefs)): void {
  applyDesk(record.data, prefs);
  synced(record.id, record.rev, record.prefs.rev);
}

// ---- starting ----------------------------------------------------------------------------------

let started = false;
let wired = false;
let checking: Promise<void> | null = null;
let lastCheck = 0;
/** Focus and visibility come in bursts; a check for the other device's work is worth one every so often. */
const CHECK_EVERY = 3_000;

function wire(): void {
  if (wired) return;
  wired = true;
  subscribe(() => { noteWrite(PUSH_DELAY); });
  subscribeDeviceWrites(() => { noteWrite(DESK_DELAY); });
  const resume = (always: boolean) => {
    if (state.mode === "unknown" || (state.mode !== "off" && !state.user && state.status === "offline")) { started = false; void start(); return; }
    if (!state.user) return;
    if (readMarker()?.dirty) { void push(); return; }
    if (always || Date.now() - lastCheck >= CHECK_EVERY) void check();
  };
  window.addEventListener("online", () => { resume(true); });
  window.addEventListener("focus", () => { resume(false); });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") { resume(false); return; }
    // A20: the board goes up now, before the tab is forgotten
    if (state.user && readMarker()?.dirty) void push();
  });
  window.addEventListener("pagehide", () => { if (state.user && readMarker()?.dirty) void push(); });
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
    await settle(res.teams, res.current, res.prefs);
  } catch (e) {
    set(problem(e));
  }
}

/**
 * The device mirrors one of the account's teams (A5): what was written here goes up; what was written
 * elsewhere, to the team or the look, comes down. True when the device was settled; false when the
 * marker names no team of this account's.
 */
async function settleMirrored(marker: Marker, mine: TeamSummary, prefs: AccountPrefs): Promise<void> {
  set({ teamId: mine.id });
  if (changedSinceMarker(marker)) {
    // written here since the device last agreed with the account (signed out, offline, another tab)
    writeMarker({ ...marker, dirty: true });
    lastSynced = null;
    await push();
    return;
  }
  if (mine.rev !== marker.rev) {
    // written elsewhere since this device last agreed with it
    adopt(await api.readTeam(mine.id));
    set({ status: "saved", message: null });
    return;
  }
  if (prefs.rev !== (marker.prefsRev ?? 0)) {
    // the look changed elsewhere, on this team or another (A19)
    applyLook(devicePrefsOf(prefs));
    synced(mine.id, mine.rev, prefs.rev);
    set({ status: "saved", message: null });
    return;
  }
  lastSynced = canonical(deviceDesk());
  set({ status: "saved", message: null });
}

async function settle(teams: readonly TeamSummary[], current: string | null, prefs: AccountPrefs): Promise<void> {
  const marker = readMarker();
  const mine = marker ? teams.find((t) => t.id === marker.teamId) : undefined;
  if (marker && mine) { await settleMirrored(marker, mine, prefs); return; }
  const device = deviceDesk();
  // A26: a look picked on this device is the coach's latest word; a device that picked nothing takes the account's
  const look = hasLook(device.prefs) ? device.prefs : undefined;
  if (hasWork(device.data)) {
    // A3, A6: the device's work becomes a team of this account
    const record = await api.createTeam({ data: device.data, prefs: look });
    adopt(record);
    set({ teams: [...teams, summaryOf(record)], teamId: record.id, status: "saved", message: null });
    return;
  }
  const target = (current && teams.find((t) => t.id === current)) ?? teams[0];
  if (target) {
    // A4: the account's team comes down onto the empty device; a sketch on its board stays when the team has none (A23)
    const record = await api.readTeam(target.id);
    const draft = record.data.draft ?? device.data.draft;
    const merged = look ? mergePrefs(look, devicePrefsOf(record.prefs)) : devicePrefsOf(record.prefs);
    adopt({ ...record, data: { ...record.data, draft } }, merged);
    set({ teamId: target.id, status: "saved", message: null });
    if (target.id !== current) void api.setCurrent(target.id).catch(() => undefined);
    if (draft !== record.data.draft || canonical(merged) !== canonical(devicePrefsOf(record.prefs))) {
      markDirty();
      await push();
    }
    return;
  }
  const record = await api.createTeam({ data: emptyTeamData(UNNAMED_TEAM), prefs: look });
  adopt({ ...record, data: { ...record.data, draft: device.data.draft } });
  set({ teams: [summaryOf(record)], teamId: record.id, status: "saved", message: null });
  if (device.data.draft) {
    markDirty();
    await push();
  }
}

/** Asks the account whether the team or the look changed elsewhere, and brings it down (A21). Once at a time. */
export function check(): Promise<void> {
  if (checking) return checking;
  lastCheck = Date.now();
  checking = (async () => {
    const m = readMarker();
    if (!state.user || !m || m.teamId !== state.teamId) return;
    let res: AccountResponse;
    try {
      res = await api.account();
    } catch (e) {
      if (e instanceof ApiError && e.status === 0 && !navigator.onLine) set({ status: "offline", message: null });
      return;
    }
    if (res.mode === "off" || !res.user) { if (res.mode !== "off") signedOutElsewhere(); return; }
    const me = state.user;
    if (!me) return;
    if (res.user.id !== me.id) { accountChanged(); return; }
    set({ user: res.user, teams: res.teams });
    const mine = res.teams.find((t) => t.id === m.teamId);
    if (!mine) return; // A9: the next push makes a new team of the device's work
    if (readMarker()?.dirty || pushing) return; // a write here since: it goes up, and a 409 brings the rest down
    try {
      await settleMirrored(m, mine, res.prefs);
    } catch (e) {
      set(problem(e));
    }
  })().finally(() => { checking = null; });
  return checking;
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
  if (!readMarker()?.dirty && lastSynced !== null && canonical(deviceDesk()) === lastSynced) return true;
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
    adopt(await api.readTeam(id));
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
    const record = await api.createTeam({ name: name.trim() || UNNAMED_TEAM, prefs: devicePrefs() });
    adopt(record);
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

/** Signs out, after the last push, and clears the device (A11, A28). */
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

// ---- what the playbooks page does ----------------------------------------------------------------------------------

/** How a send ended: what the other team gained, or one line on why it gained nothing. */
export type SendResult =
  | { ok: true; team: TeamSummary; added: number; copied: number; reused: number; /** S1: it was already there, so nothing was written */ unchanged: boolean }
  | { ok: false; message: string };

/** The other teams of this account, once the device has settled on one of them: where a playbook or a play can be sent (S7: never the one this device mirrors). */
export const sendTargets = (s: AccountState = state): TeamSummary[] => (s.user && s.teamId ? s.teams.filter((t) => t.id !== s.teamId) : []);

/**
 * Copies a playbook (with its plays) or a play into another of the account's teams, as importing a
 * file of it there would: what that team already has is reused, a differing play under the same id
 * comes in as a copy (S2), and a write refused as changed elsewhere is planned again (S3).
 */
export async function sendToTeam(transfer: Transfer, teamId: string): Promise<SendResult> {
  const target = sendTargets().find((t) => t.id === teamId);
  if (!target) return { ok: false, message: "That team isn't one you can send to." };
  try {
    let record = await api.readTeam(teamId);
    for (let attempt = 0; attempt < 3; attempt++) {
      const plan = planTransfer(transfer, record.data.plays, record.data.playbooks);
      const counts = { added: plan.added, copied: plan.copied, reused: plan.reused };
      if (plan.plays.length === 0 && plan.book === null) {
        // S1: the team has it already; the summary it carries is the account's latest
        const team = summaryOf(record);
        set({ teams: state.teams.map((t) => (t.id === team.id ? team : t)) });
        return { ok: true, team, ...counts, unchanged: true };
      }
      const data: TeamData = {
        ...record.data,
        plays: [...record.data.plays, ...plan.plays],
        playbooks: plan.book ? [...record.data.playbooks, plan.book] : record.data.playbooks,
      };
      try {
        // the look is this device's business, not the send's: the write carries none, and the account's stays (ADR 013)
        const team = summaryOf(await api.writeTeam(teamId, data, record.rev));
        set({ teams: state.teams.map((t) => (t.id === team.id ? team : t)) });
        return { ok: true, team, ...counts, unchanged: false };
      } catch (e) {
        if (!(e instanceof ApiError) || e.status !== 409 || !e.record) throw e;
        record = e.record;
      }
    }
    return { ok: false, message: `${target.name} is being changed on another device. Try again in a moment.` };
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) {
      signedOutElsewhere();
      return { ok: false, message: "You were signed out. Sign in again, then send it." };
    }
    if (e instanceof ApiError && e.status === 404) {
      set({ teams: state.teams.filter((t) => t.id !== teamId) });
      return { ok: false, message: `${target.name} isn't in your account any more.` };
    }
    if (e instanceof ApiError) return { ok: false, message: e.status === 0 && !navigator.onLine ? "You're offline. Sending needs a connection." : e.message };
    return { ok: false, message: "Something went wrong with your account. Nothing was sent." };
  }
}

/** Where sign-in lives. */
export const SIGN_IN_PATH = "/sign-in";
