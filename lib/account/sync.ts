/**
 * The device's side of a coach's account (docs/adr/012-coach-accounts.md, docs/adr/014-whole-desk-in-account.md):
 * the plays, playbooks, team settings and lineups on this device mirror one of the account's teams,
 * and with them the rest of the desk (the draft on the chalkboard, the playbook picked in the
 * designer, where each book was last read, the share links made here) and the coach's look (theme,
 * field, end zone, Deep field, the ball's spot, touchdowns, the guide seen). Every write to any of them
 * goes up to the account; another device signed in brings them down, so a coach picks up exactly
 * where they left off. The library (lib/play/library.ts) and storage are unchanged: this engine reads
 * what they wrote and writes what the account sends, so every screen keeps working signed out,
 * offline, or with accounts off. An organization's team (docs/adr/013-organizations.md) is
 * lib/org/sync.ts's: this engine hands it the marker that names one and steps back.
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
 * - A16 (ADR 014 supersedes) the draft and the pick are the team's now: see A19.
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
 * - A29 the device is cleared at the moment the page leaves, not before: a page still open redraws on
 *   any key it watches (the chalkboard follows the board's spot) and would write the draft straight back.
 * - A30 an organization's team is open: its plays and books go up record by record (lib/org/sync.ts);
 *   the desk and the look stay on the device, and go up with the coach's own team next time one is open.
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
import { subscribeDeviceWrites } from "@/lib/device-writes";
import { subscribe } from "@/lib/play/library";
import * as api from "./api";
import { ApiError } from "./api";
import { UNNAMED_TEAM, canonical, devicePrefsOf, emptyTeamData, hasLook, hasWork, mergePrefs, mergeTeamData } from "./data";
import { devicePrefs } from "./prefs";
import {
  applyDesk, applyLook, clearDeviceOnLeave, currentTeam, deviceData, deviceDesk, getAccountState, getLastSynced, hashOf, isApplying, problem,
  readMarker, set, setLastSynced, writeMarker, type AccountState, type Desk, type Marker,
} from "./state";
import type { AccountPrefs, AccountResponse, CoachPrefs, TeamData, TeamRecord, TeamSummary } from "./types";
import * as orgApi from "@/lib/org/api";
import * as org from "@/lib/org/sync";
import type { Grants, OrgSummary, OrgTeamSummary } from "@/lib/org/types";

export {
  MARKER_KEY, ORG_KEY, currentOrgTeam, currentTeam, deviceDesk, getAccountState, getServerAccountState, hashOf, readMarker, subscribeAccount,
  subscribePulls, type AccountState, type Desk, type Marker, type SyncStatus,
} from "./state";

const state = (): AccountState => getAccountState();

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
  const c = canonical(deviceDesk());
  setLastSynced(c);
  writeMarker({ teamId, rev, dirty: false, hash: hashOf(c), prefsRev });
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
  if (isApplying()) return;
  const m = readMarker();
  if (m?.org) { org.noteWrite(); return; }
  const s = state();
  if (!s.user || !s.teamId) {
    // signed out (A2) or not settled yet: a change to a mirrored team is remembered for the next sign-in (A5)
    if (m && !m.dirty && !s.user && changedSinceMarker(m)) writeMarker({ ...m, dirty: true });
    return;
  }
  const last = getLastSynced();
  if (last !== null && canonical(deviceDesk()) === last) return;
  markDirty();
  set({ status: "pending", message: null });
  schedule(delay);
}

/** The session is gone (A12): the device keeps its marker, dirty, for the next sign-in. */
function signedOutElsewhere(): void {
  set({ user: null, teams: [], teamId: null, status: "idle", message: "You were signed out. Sign in again to keep saving to your account." });
}

/** Pushes the device's desk to its team. Resolves true when the account has it. */
export function push(): Promise<boolean> {
  if (state().org) return org.push();
  if (pushing) { pushAgain = true; return pushing; }
  pushing = (async () => {
    window.clearTimeout(pushTimer);
    pushTimer = 0;
    pushDue = Number.POSITIVE_INFINITY;
    const m = readMarker();
    const s = state();
    if (!s.user || !m || m.teamId !== s.teamId) return false;
    let desk: Desk = deviceDesk();
    // nothing new since the last push or pull (A18): a resume or a second go is no write
    const last = getLastSynced();
    if (!m.dirty && last !== null && canonical(desk) === last) { set({ status: "saved" }); return true; }
    set({ status: "saving", message: null });
    try {
      let rev = m.rev;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const written = await api.writeTeam(m.teamId, desk.data, rev, desk.prefs);
          // the account may hold more touchdowns than this device counted (A25)
          applyLook(devicePrefsOf(written.prefs));
          synced(m.teamId, written.rev, written.prefs.rev);
          set({ status: "saved", message: null, teams: state().teams.map((t) => (t.id === written.id ? summaryOf(written) : t)) });
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
          set({ status: "saved", message: "That team was deleted elsewhere, so this device's work is now a new team.", teams: [...state().teams, summaryOf(record)], teamId: record.id });
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
  org.release();
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
  // a touch on the board, a look picked: a coach's own team carries them (A19); an organization's keeps them on the device (A30)
  subscribeDeviceWrites(() => { if (!readMarker()?.org) noteWrite(DESK_DELAY); });
  const resume = (always: boolean) => {
    const s = state();
    if (s.mode === "unknown" || (s.mode !== "off" && !s.user && s.status === "offline")) { started = false; void start(); return; }
    if (!s.user) return;
    if (s.org) {
      if (readMarker()?.dirty) void push();
      if (s.level !== null && s.level > 0) org.startPolling();
      return;
    }
    if (readMarker()?.dirty) { void push(); return; }
    if (always || Date.now() - lastCheck >= CHECK_EVERY) void check();
  };
  window.addEventListener("online", () => { resume(true); });
  window.addEventListener("focus", () => { resume(false); });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") { resume(false); return; }
    // A20: the board goes up now, before the tab is forgotten
    const s = state();
    if (s.user && !s.org && readMarker()?.dirty) void push();
  });
  window.addEventListener("pagehide", () => {
    const s = state();
    if (s.user && !s.org && readMarker()?.dirty) void push();
  });
}

/** The coach's organizations and every team of theirs the coach sees (ADR 013). Nothing when they are off. */
export async function loadOrgs(): Promise<void> {
  let res;
  try {
    res = await orgApi.orgs();
  } catch (e) {
    if (e instanceof ApiError && (e.status === 404 || e.status === 503)) { set({ orgMode: "off", orgs: [], orgTeams: [] }); return; }
    throw e;
  }
  if (res.mode === "off") { set({ orgMode: "off", orgs: [], orgTeams: [] }); return; }
  const orgTeams: OrgTeamSummary[] = [];
  for (const o of res.orgs) {
    try {
      orgTeams.push(...(await orgApi.readOrg(o.id)).teams);
    } catch {
      /* an organization that can't be read right now lists no teams; the next visit tries again */
    }
  }
  set({ orgMode: "on", orgs: res.orgs, orgTeams });
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
    const m = readMarker();
    set({ ...problem(e), mode: state().mode, teamId: m?.teamId ?? null, org: m?.org ?? null, level: m?.level ?? null });
    return;
  }
  const invite = inviteInUrl();
  if (res.mode === "off") { set({ mode: "off", user: null, teams: [], teamId: null, status: "idle", message: null, orgMode: "off" }); return; }
  if (!res.user) {
    set({ mode: res.mode, user: null, teams: [], teamId: null, status: "idle", message: null });
    if (invite) window.location.replace(`${SIGN_IN_PATH}?invite=${encodeURIComponent(invite)}`);
    return;
  }
  set({ mode: res.mode, user: res.user, teams: res.teams, teamId: null, status: "checking", message: null });
  try {
    await loadOrgs();
    if (invite) await acceptInvite(invite);
    const m = readMarker();
    if (m?.org) await org.settle({ teamId: m.teamId, org: m.org, level: m.level, rev: m.rev, dirty: m.dirty });
    else await settle(res.teams, res.current, res.prefs);
  } catch (e) {
    set(problem(e));
  }
}

/** The invite token a link carried here (`?invite=`), taken off the URL; the sign-in page keeps its own, to carry on after sign-in. */
function inviteInUrl(): string | null {
  const url = new URL(window.location.href);
  const token = url.searchParams.get("invite");
  if (!token || url.pathname.startsWith(SIGN_IN_PATH) || url.pathname.startsWith("/sign-up")) return null;
  url.searchParams.delete("invite");
  window.history.replaceState(null, "", url.pathname + url.search + url.hash);
  return token;
}

/** Joins the organization an invite names, and says so (rule 4). */
export async function acceptInvite(token: string): Promise<void> {
  try {
    const joined = await orgApi.join(token);
    await loadOrgs();
    set({ notice: `You're in ${joined.name}.` });
  } catch (e) {
    set({ message: e instanceof ApiError ? e.message : "That invite couldn't be used." });
  }
}

/**
 * The device mirrors one of the account's teams (A5): what was written here goes up; what was written
 * elsewhere, to the team or the look, comes down.
 */
async function settleMirrored(marker: Marker, mine: TeamSummary, prefs: AccountPrefs): Promise<void> {
  set({ teamId: mine.id });
  if (changedSinceMarker(marker)) {
    // written here since the device last agreed with the account (signed out, offline, another tab)
    writeMarker({ ...marker, dirty: true });
    setLastSynced(null);
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
  setLastSynced(canonical(deviceDesk()));
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
  const first = state().orgTeams[0];
  if (first) {
    // an account with no team of its own but an organization's to see: that one opens
    await org.open(first.org, first.id);
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

/** Asks the account whether the team or the look changed elsewhere, and brings it down (A21). Once at a time; a coach's own team only. */
export function check(): Promise<void> {
  if (checking) return checking;
  lastCheck = Date.now();
  checking = (async () => {
    const m = readMarker();
    const s = state();
    if (!s.user || !m || m.org || m.teamId !== s.teamId) return;
    let res: AccountResponse;
    try {
      res = await api.account();
    } catch (e) {
      if (e instanceof ApiError && e.status === 0 && !navigator.onLine) set({ status: "offline", message: null });
      return;
    }
    if (res.mode === "off" || !res.user) { if (res.mode !== "off") signedOutElsewhere(); return; }
    const me = state().user;
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
  if (state().org) return org.flushed();
  const last = getLastSynced();
  if (!readMarker()?.dirty && last !== null && canonical(deviceDesk()) === last) return true;
  if (await push()) return true;
  set({ message: "Your latest changes aren't in your account yet. Connect and try again." });
  return false;
}

/** Makes another team the one this device mirrors, the coach's own or an organization's, and reloads (A17). */
export async function switchTeam(id: string, orgId: string | null = null): Promise<void> {
  const s = state();
  if (!s.user || (id === s.teamId && (orgId ?? null) === s.org)) return;
  if (orgId ? !s.orgTeams.some((t) => t.id === id && t.org === orgId) : !s.teams.some((t) => t.id === id)) return;
  if (!(await flushed())) return;
  if (orgId) { await org.open(orgId, id); return; }
  set({ status: "busy", message: null });
  try {
    adopt(await api.readTeam(id));
    await api.setCurrent(id).catch(() => undefined);
    window.location.reload();
  } catch (e) {
    set(problem(e));
  }
}

/** Makes an empty team, the coach's own or in an organization, and switches to it. */
export async function createTeam(name: string, orgId: string | null = null): Promise<void> {
  if (!state().user) return;
  if (!(await flushed())) return;
  set({ status: "busy", message: null });
  try {
    if (orgId) {
      const made = await orgApi.createTeam(orgId, name.trim() || UNNAMED_TEAM);
      await org.open(orgId, made.id);
      return;
    }
    const record = await api.createTeam({ name: name.trim() || UNNAMED_TEAM, prefs: devicePrefs() });
    adopt(record);
    window.location.reload();
  } catch (e) {
    set(problem(e));
  }
}

/** Deletes a team, the coach's own from the account or an organization's for everyone. The team this device mirrors goes with its data; the page reloads onto another. */
export async function deleteTeam(id: string, orgId: string | null = null): Promise<void> {
  const s = state();
  if (!s.user) return;
  set({ status: "busy", message: null });
  try {
    if (orgId) await orgApi.deleteTeam(orgId, id);
    else await api.deleteTeam(id);
    if (id === s.teamId && (orgId ?? null) === s.org) {
      org.release();
      clearDeviceOnLeave();
      window.location.reload();
      return;
    }
    set({ teams: orgId ? s.teams : s.teams.filter((t) => t.id !== id), orgTeams: orgId ? s.orgTeams.filter((t) => !(t.id === id && t.org === orgId)) : s.orgTeams, status: readMarker()?.dirty ? "pending" : "saved" });
  } catch (e) {
    set(problem(e));
  }
}

/** Moves the coach's own team this device has open into an organization, where the coach heads it (ADR 013, tier 3). */
export async function moveTeamToOrg(orgId: string): Promise<void> {
  const s = state();
  const team = currentTeam(s);
  if (!s.user || !team || s.org) return;
  if (!(await flushed())) return;
  set({ status: "busy", message: null });
  try {
    await orgApi.moveTeam(orgId, team.id);
    set({ teams: s.teams.filter((t) => t.id !== team.id) });
    await loadOrgs();
    await org.open(orgId, team.id);
  } catch (e) {
    set(problem(e));
  }
}

/** Makes an organization with the coach as its owner. */
export async function createOrg(name: string): Promise<OrgSummary | null> {
  try {
    const made = await orgApi.createOrg(name);
    await loadOrgs();
    return made;
  } catch (e) {
    set({ message: e instanceof ApiError ? e.message : "Couldn't make the organization." });
    return null;
  }
}

/** Runs one of the organization's management calls and reads the organizations again; the panel gets the error line. */
export async function manage(run: () => Promise<unknown>): Promise<boolean> {
  try {
    await run();
    await loadOrgs();
    return true;
  } catch (e) {
    set({ message: e instanceof ApiError ? e.message : "Something went wrong with your organization." });
    return false;
  }
}

export const invite = (orgId: string, body: Partial<Grants> & { email?: string }) => orgApi.createInvite(orgId, body);
export const readOrg = (orgId: string) => orgApi.readOrg(orgId);

/** Leaves an organization; the device drops its team when it was the organization's. */
export async function leaveOrg(orgId: string): Promise<void> {
  const s = state();
  const ok = await manage(() => orgApi.leave(orgId));
  if (ok && s.org === orgId) { org.release(); clearDeviceOnLeave(); window.location.reload(); }
}

/** Deletes an organization and its teams; the owner only. The device reloads when it had one of them open. */
export async function deleteOrg(orgId: string): Promise<void> {
  const s = state();
  const ok = await manage(() => orgApi.deleteOrg(orgId));
  if (ok && s.org === orgId) { org.release(); clearDeviceOnLeave(); window.location.reload(); }
}

/** Signs out, after the last push, and clears the device as the page leaves (A11, A28, A29). */
export async function signOut(): Promise<void> {
  const s = state();
  if (!s.user) return;
  if (!(await flushed())) return;
  set({ status: "busy", message: null });
  org.release();
  const standDown = clearDeviceOnLeave();
  try {
    if (s.mode === "fixture") await api.fixtureSignOut();
    else await bridge?.signOut();
    // a full load on purpose (A17): the designer starts over with nothing of the account on the device
    window.location.assign(new URL("/", window.location.origin).href);
  } catch (e) {
    standDown();
    set(problem(e));
  }
}

// ---- what the playbooks page does ----------------------------------------------------------------------------------

/** How a send ended: what the other team gained, or one line on why it gained nothing. */
export type SendResult =
  | { ok: true; team: TeamSummary; added: number; copied: number; reused: number; /** S1: it was already there, so nothing was written */ unchanged: boolean }
  | { ok: false; message: string };

/** The other teams of this account, once the device has settled on one of them: where a playbook or a play can be sent (S7: never the one this device mirrors). */
export const sendTargets = (s: AccountState = state()): TeamSummary[] => (s.user && s.teamId ? s.teams.filter((t) => t.id !== s.teamId) : []);

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
        set({ teams: state().teams.map((t) => (t.id === team.id ? team : t)) });
        return { ok: true, team, ...counts, unchanged: true };
      }
      const data: TeamData = {
        ...record.data,
        plays: [...record.data.plays, ...plan.plays],
        playbooks: plan.book ? [...record.data.playbooks, plan.book] : record.data.playbooks,
      };
      try {
        // the look is this device's business, not the send's: the write carries none, and the account's stays (ADR 014)
        const team = summaryOf(await api.writeTeam(teamId, data, record.rev));
        set({ teams: state().teams.map((t) => (t.id === team.id ? team : t)) });
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
      set({ teams: state().teams.filter((t) => t.id !== teamId) });
      return { ok: false, message: `${target.name} isn't in your account any more.` };
    }
    if (e instanceof ApiError) return { ok: false, message: e.status === 0 && !navigator.onLine ? "You're offline. Sending needs a connection." : e.message };
    return { ok: false, message: "Something went wrong with your account. Nothing was sent." };
  }
}

/** Where sign-in lives. */
export const SIGN_IN_PATH = "/sign-in";
