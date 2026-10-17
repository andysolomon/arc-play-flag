/**
 * The device's side of an organization's team (docs/adr/013-organizations.md, tier 3). The device
 * mirrors one team, as for a coach's own (lib/account/sync.ts); the difference is that every play and
 * playbook goes up on its own with the time the coach changed it, and that the device asks every few
 * seconds for what changed since the rev it read, and who else is here. The library and storage are
 * unchanged: this engine reads what they wrote and writes what the organization sends.
 *
 * Ways this could go wrong, written down before the code:
 *
 * - D1 a change made here while offline, or with the poll behind: it is pending with the time it was
 *   made, goes up with that time, and comes back applied or as a sideline version (rule 5); the
 *   device shows the sideline version beside the newer play and says so.
 * - D2 the poll brings a change to a play this device has a pending change to: the device's goes up
 *   first and the server decides; nothing the poll brings overwrites a pending change.
 * - D3 the poll brings a change to the play on the board: the library changes under the board, the
 *   board keeps its draft, and the notice says who changed it; the next Save is this coach's newer
 *   change and wins, as rule 5 says.
 * - D4 a viewer's write (a stale page, a restore from backup): refused on the server, the team is read
 *   again whole and the device's copy put back, and the panel says why.
 * - D5 an assistant's write to the settings or roster: refused the same way, the settings only.
 * - D6 access lost (removed, the team or the organization deleted): every request is 404; the device
 *   keeps a read-only copy, says so, and stops polling; the next switch drops it (O1).
 * - D7 the session ended: 401; the device keeps its marker and pending changes for the next sign-in.
 * - D8 the tab hidden: polling stops; it resumes on focus with everything since the rev it read (O10).
 * - D9 the store down or offline: pending changes stay pending and go up on the next try; presence is
 *   nobody; the panel says offline or unavailable.
 * - D10 a play deleted elsewhere while on the board here: it leaves the library; the board keeps its
 *   draft, and a Save makes it a play again (a newer change over a tombstone revives it, T5).
 * - D11 two tabs on one device: each pushes what it sees; the server's rule decides, as for two coaches.
 * - D12 the device's record of the team (ffpd.org.v1) blocked or lost: the team is read again whole on
 *   the next visit, and any change the marker says is pending goes up as the whole difference.
 */
import { ApiError } from "@/lib/account/api";
import * as account from "@/lib/account/api";
import { EMPTY_DESK, canonical, mergeTeamData } from "@/lib/account/data";
import {
  ORG_KEY, applied, applyData, deviceData, getAccountState, hashOf, readMarker, set, writeMarker, problem,
} from "@/lib/account/state";
import type { TeamData } from "@/lib/account/types";
import { refresh, setGuard } from "@/lib/play/library";
import { LINEUPS_KEY, PLAYBOOKS_KEY, PLAYS_KEY, TEAM_KEY, newId, normalizePlaybook, normalizeSavedPlay, readAll, readLineups, readPlaybooks, readTeam, settleBook, writeMany } from "@/lib/play/storage";
import type { Playbook, SavedPlay } from "@/lib/play/types";
import * as api from "./api";
import { ASSIST, HEAD, VIEW, type Level, type OrgPlay, type OrgPlaybook, type OrgTeamRecord, type Stamp } from "./types";

/** The device's record of the organization's team: what the organization last had of each record, what is pending here, and who touched what. */
interface Device {
  org: string;
  orgName: string;
  teamId: string;
  rev: number;
  level: Level;
  hashes: { plays: Record<string, string>; books: Record<string, string>; settings: string };
  /** pending changes, by id, with the time the coach made them (D1) */
  pending: { plays: Record<string, string>; books: Record<string, string>; settings: string | null };
  stamps: { plays: Record<string, Stamp>; books: Record<string, Stamp> };
}

export const POLL_MS = 4_000;
const PUSH_DELAY = 1_200;
const LOST = "You no longer have access to this team. What's here stays on this device until you switch teams.";
export const readOnlyWords = (org: string): string => `You can look at this team but not change it. Ask an admin of ${org}.`;
export const settingsWords = "Only a head coach of this team can change its settings and roster.";

let device: Device | null = null;
function readDevice(): Device | null {
  if (device) return device;
  try {
    const v: unknown = JSON.parse(localStorage.getItem(ORG_KEY) ?? "null");
    if (typeof v !== "object" || v === null) return null;
    const d = v as Device;
    if (typeof d.org !== "string" || typeof d.teamId !== "string" || typeof d.rev !== "number") return null;
    device = {
      org: d.org, orgName: typeof d.orgName === "string" ? d.orgName : "the organization", teamId: d.teamId, rev: d.rev, level: levelOf(d.level),
      hashes: { plays: { ...d.hashes?.plays }, books: { ...d.hashes?.books }, settings: typeof d.hashes?.settings === "string" ? d.hashes.settings : "" },
      pending: { plays: { ...d.pending?.plays }, books: { ...d.pending?.books }, settings: typeof d.pending?.settings === "string" ? d.pending.settings : null },
      stamps: { plays: { ...d.stamps?.plays }, books: { ...d.stamps?.books } },
    };
    return device;
  } catch {
    return null;
  }
}
const levelOf = (v: unknown): Level => (v === 1 || v === 2 || v === 3 ? v : 0);
function writeDevice(d: Device | null): void {
  device = d;
  try {
    if (d) localStorage.setItem(ORG_KEY, JSON.stringify(d));
    else localStorage.removeItem(ORG_KEY);
  } catch {
    /* D12: the team is read whole on the next visit */
  }
  set({});
}

const hashRecord = (v: unknown): string => hashOf(canonical(v));
/** Takes a key off a record kept as JSON (a map would not survive the trip to storage). */
const drop = (o: Record<string, unknown>, k: string): void => { Reflect.deleteProperty(o, k); };
/** A play as the device keeps it: the organization's stamps left off. */
const plain = (p: OrgPlay): SavedPlay => normalizeSavedPlay(p, p.id) ?? { id: p.id, name: p.name, notes: p.notes, side: p.side, players: p.players };
const plainBook = (b: OrgPlaybook): Playbook => normalizePlaybook(b, b.id) ?? { id: b.id, name: b.name, plays: b.plays };

/** What the coach may do here, as the library's writes are told (rule 9; D4, D5). */
function guardFor(level: Level, orgName: string, lost = false): void {
  if (lost) { setGuard({ all: LOST, settings: null }); return; }
  setGuard({ all: level < ASSIST ? readOnlyWords(orgName) : null, settings: level < HEAD ? settingsWords : null });
}

/** The stamp on a play or a book, for the card that shows who changed it. */
export const stampOf = (kind: "plays" | "books", id: string): Stamp | null => readDevice()?.stamps[kind][id] ?? null;

/** Makes the device mirror an organization's team, with its data on the device as read. */
export function adopt(record: OrgTeamRecord, orgName: string, clear: boolean): void {
  const plays = record.plays.map(plain);
  const playbooks = record.playbooks.map(plainBook);
  applyData({ plays, playbooks, team: record.team, lineups: record.lineups }, clear);
  writeDevice({
    org: record.org, orgName, teamId: record.id, rev: record.rev, level: record.level,
    hashes: {
      plays: Object.fromEntries(plays.map((p) => [p.id, hashRecord(p)])),
      books: Object.fromEntries(playbooks.map((b) => [b.id, hashRecord(b)])),
      settings: hashRecord({ team: record.team, lineups: record.lineups }),
    },
    pending: { plays: {}, books: {}, settings: null },
    stamps: {
      plays: Object.fromEntries(record.plays.map((p) => [p.id, p.changed])),
      books: Object.fromEntries(record.playbooks.map((b) => [b.id, b.changed])),
    },
  });
  writeMarker({ teamId: record.id, rev: record.rev, dirty: false, org: record.org, level: record.level });
  set({ teamId: record.id, org: record.org, level: record.level, status: "saved", message: null, presence: [] });
  guardFor(record.level, orgName);
}

/** Takes the organization's team off this engine's hands (a switch to a coach's own team, a sign-out). */
export function release(): void {
  stopPolling();
  writeDevice(null);
  setGuard({ all: null, settings: null });
  set({ org: null, level: null, presence: [], notice: null });
}

// ---- what is pending ----------------------------------------------------------------------------------

/** The difference between the device and what the organization last had of it, noted as pending with the time (D1). */
function notePending(d: Device): boolean {
  const now = new Date().toISOString();
  let any = false;
  const plays = readAll();
  for (const [id, p] of Object.entries(plays)) {
    if (d.hashes.plays[id] !== hashRecord(p) && !d.pending.plays[id]) { d.pending.plays[id] = now; any = true; }
  }
  for (const id of Object.keys(d.hashes.plays)) {
    if (!(id in plays) && !d.pending.plays[id]) { d.pending.plays[id] = now; any = true; }
  }
  const books = readPlaybooks();
  for (const [id, b] of Object.entries(books)) {
    if (d.hashes.books[id] !== hashRecord(b) && !d.pending.books[id]) { d.pending.books[id] = now; any = true; }
  }
  for (const id of Object.keys(d.hashes.books)) {
    if (!(id in books) && !d.pending.books[id]) { d.pending.books[id] = now; any = true; }
  }
  if (d.hashes.settings !== hashRecord({ team: readTeam(), lineups: readLineups() }) && !d.pending.settings) { d.pending.settings = now; any = true; }
  return any;
}

const hasPending = (d: Device): boolean => Object.keys(d.pending.plays).length > 0 || Object.keys(d.pending.books).length > 0 || d.pending.settings !== null;

let pushTimer = 0;
/** A write landed on the device: it goes up shortly, with any that follow. */
export function noteWrite(): void {
  const d = readDevice();
  if (!d) return;
  const s = getAccountState();
  const any = notePending(d);
  if (!any && !hasPending(d)) return;
  writeDevice(d);
  const m = readMarker();
  if (m && !m.dirty) writeMarker({ ...m, dirty: true });
  if (!s.user) return;
  set({ status: "pending", message: null });
  window.clearTimeout(pushTimer);
  pushTimer = window.setTimeout(() => { void push(); }, PUSH_DELAY);
}

let pushing: Promise<boolean> | null = null;
let pushAgain = false;

/** Pushes every pending change, one record at a time. Resolves true when the organization has them all. */
export function push(): Promise<boolean> {
  if (pushing) { pushAgain = true; return pushing; }
  pushing = (async () => {
    window.clearTimeout(pushTimer);
    const d = readDevice();
    const s = getAccountState();
    if (!d || !s.user) return false;
    notePending(d);
    if (!hasPending(d)) { writeDevice(d); set({ status: "saved" }); return true; }
    set({ status: "saving", message: null });
    try {
      const plays = readAll();
      for (const [id, at] of Object.entries(d.pending.plays)) {
        const p = plays[id];
        if (p) {
          const w = await api.writePlay(d.org, d.teamId, p, at);
          land(d, "plays", id, w.rev, "deleted" in w.play ? null : w.play, w.sideline ?? null, p.name);
        } else {
          const w = await api.deletePlay(d.org, d.teamId, id, at);
          drop(d.hashes.plays, id); drop(d.stamps.plays, id);
          d.rev = Math.max(d.rev, w.rev);
        }
        drop(d.pending.plays, id);
        writeDevice(d);
      }
      const books = readPlaybooks();
      for (const [id, at] of Object.entries(d.pending.books)) {
        const b = books[id];
        if (b) {
          const w = await api.writeBook(d.org, d.teamId, b, at);
          land(d, "books", id, w.rev, "deleted" in w.book ? null : w.book, w.sideline ?? null, b.name);
        } else {
          const w = await api.deleteBook(d.org, d.teamId, id, at);
          drop(d.hashes.books, id); drop(d.stamps.books, id);
          d.rev = Math.max(d.rev, w.rev);
        }
        drop(d.pending.books, id);
        writeDevice(d);
      }
      if (d.pending.settings) {
        try {
          const w = await api.writeSettings(d.org, d.teamId, readTeam(), readLineups());
          d.rev = Math.max(d.rev, w.rev);
          d.hashes.settings = hashRecord({ team: readTeam(), lineups: readLineups() });
        } catch (e) {
          if (!(e instanceof ApiError) || e.status !== 403) throw e;
          // D5: the settings are the head coach's; the organization's come back
          await reread(d, settingsWords);
          return false;
        }
        d.pending.settings = null;
        writeDevice(d);
      }
      writeMarker({ teamId: d.teamId, rev: d.rev, dirty: false, org: d.org, level: d.level });
      set({ status: "saved", message: null });
      return true;
    } catch (e) {
      if (e instanceof ApiError && e.status === 403) { await reread(d, e.message); return false; }
      if (e instanceof ApiError && e.status === 404) { lost(d); return false; }
      if (e instanceof ApiError && e.status === 401) {
        set({ user: null, teams: [], teamId: null, status: "idle", message: "You were signed out. Sign in again to keep saving to your organization." });
        return false;
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

/** A record's write came back: the organization's version lands (the device's, or the newer one that stood), and a sideline version beside it (D1). */
function land(d: Device, kind: "plays" | "books", id: string, rev: number, stood: OrgPlay | OrgPlaybook | null, sideline: OrgPlay | OrgPlaybook | null, name: string): void {
  d.rev = Math.max(d.rev, rev);
  const stamps = d.stamps[kind];
  const hashes = d.hashes[kind];
  if (sideline) {
    applied(() => {
      if (kind === "plays") {
        const plays = readAll();
        const side = plain(sideline as OrgPlay);
        plays[side.id] = side;
        if (stood) plays[id] = plain(stood as OrgPlay); else drop(plays, id);
        writeMany([[PLAYS_KEY, plays]]);
      } else {
        const books = readPlaybooks();
        const side = plainBook(sideline as OrgPlaybook);
        books[side.id] = side;
        if (stood) books[id] = plainBook(stood as OrgPlaybook); else drop(books, id);
        writeMany([[PLAYBOOKS_KEY, books]]);
      }
      refresh();
    });
    hashes[sideline.id] = hashRecord(kind === "plays" ? plain(sideline as OrgPlay) : plainBook(sideline as OrgPlaybook));
    stamps[sideline.id] = sideline.changed;
    const who = stood?.changed.name ?? "Another coach";
    set({ notice: `${who} changed “${name}” after you. Your version is kept as “${sideline.name}”.` });
  }
  if (stood) {
    hashes[id] = hashRecord(kind === "plays" ? plain(stood as OrgPlay) : plainBook(stood as OrgPlaybook));
    stamps[id] = stood.changed;
  } else {
    drop(hashes, id); drop(stamps, id);
  }
}

/** Reads the team again whole and puts the organization's copy back on the device (D4, D5). */
async function reread(d: Device, why: string): Promise<void> {
  try {
    const record = await api.readTeam(d.org, d.teamId);
    adopt(record, d.orgName, false);
    set({ status: "saved", message: why });
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) { lost(d); return; }
    set(problem(e));
  }
}

/** Access is gone (D6): the copy stays, read-only, and the polling stops. */
function lost(d: Device): void {
  stopPolling();
  d.level = 0;
  writeDevice(d);
  writeMarker({ teamId: d.teamId, rev: d.rev, dirty: false, org: d.org, level: 0 });
  set({ level: 0, status: "error", message: LOST, presence: [] });
  guardFor(0, d.orgName, true);
}

// ---- the poll ----------------------------------------------------------------------------------

let pollTimer = 0;
let polling = false;
let presencePlay: string | null = null;

/** The play on the board, for the other coaches to see (rule 8). */
export function setPresencePlay(id: string | null): void {
  presencePlay = id;
}

export function startPolling(): void {
  if (pollTimer) return;
  const tick = () => {
    pollTimer = window.setTimeout(() => { void poll().finally(tick); }, POLL_MS);
  };
  pollTimer = window.setTimeout(() => { void poll().finally(tick); }, 0);
}
export function stopPolling(): void {
  window.clearTimeout(pollTimer);
  pollTimer = 0;
}

/** Asks for what changed since the rev the device read, applies it, and shows who else is here. */
export async function poll(): Promise<void> {
  const d = readDevice();
  const s = getAccountState();
  if (!d || !s.user || polling || document.visibilityState === "hidden" || d.level < VIEW) return;
  if (hasPending(d) && !pushing) { void push(); return; }
  polling = true;
  try {
    const c = await api.poll(d.org, d.teamId, d.rev, presencePlay);
    const touched: string[] = [];
    if (c.plays.length || c.playbooks.length || c.settings) {
      applied(() => {
        const plays = readAll();
        for (const p of c.plays) {
          if (d.pending.plays[p.id]) continue; // D2
          if ("deleted" in p) { drop(plays, p.id); drop(d.hashes.plays, p.id); drop(d.stamps.plays, p.id); }
          else { const v = plain(p); plays[p.id] = v; d.hashes.plays[p.id] = hashRecord(v); d.stamps.plays[p.id] = p.changed; }
          if (p.changed.by !== s.user?.id && p.id === presencePlay) touched.push(`${p.changed.name} changed “${"deleted" in p ? "this play" : p.name}” just now`);
        }
        const books = readPlaybooks();
        const ids = new Set(Object.keys(plays));
        for (const b of c.playbooks) {
          if (d.pending.books[b.id]) continue;
          if ("deleted" in b) { drop(books, b.id); drop(d.hashes.books, b.id); drop(d.stamps.books, b.id); }
          else { const v = plainBook(b); books[b.id] = settleBook({ ...v, plays: v.plays.filter((id) => ids.has(id)) }); d.hashes.books[b.id] = hashRecord(v); d.stamps.books[b.id] = b.changed; }
        }
        const entries: (readonly [string, unknown])[] = [[PLAYS_KEY, plays], [PLAYBOOKS_KEY, books]];
        if (c.settings && !d.pending.settings) {
          entries.push([TEAM_KEY, c.settings.team], [LINEUPS_KEY, c.settings.lineups]);
          d.hashes.settings = hashRecord({ team: c.settings.team, lineups: c.settings.lineups });
        }
        writeMany(entries);
        refresh();
      });
    }
    d.rev = Math.max(d.rev, c.rev);
    const levelChanged = d.level !== c.level;
    d.level = c.level;
    writeDevice(d);
    writeMarker({ teamId: d.teamId, rev: d.rev, dirty: hasPending(d), org: d.org, level: d.level });
    if (levelChanged) guardFor(d.level, d.orgName);
    // the same coaches in the same places is no change: nothing re-renders for a quiet poll
    const presence = canonical(c.presence) === canonical(s.presence) ? s.presence : c.presence;
    set({
      presence, level: d.level,
      ...(touched.length ? { notice: touched[0] ?? null } : {}),
      ...(s.status === "offline" || s.status === "error" ? { status: hasPending(d) ? "pending" : "saved", message: null } : {}),
    });
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) { lost(d); return; }
    if (e instanceof ApiError && e.status === 401) { set({ user: null, status: "idle", message: "You were signed out. Sign in again to keep up with your organization." }); stopPolling(); return; }
    if (e instanceof ApiError && e.status === 0) set({ presence: [], ...(hasPending(d) ? problem(e) : {}) });
  } finally {
    polling = false;
  }
}

/** Clears the notice, once the panel has shown it. */
export function clearNotice(): void {
  set({ notice: null });
}

// ---- starting ----------------------------------------------------------------------------------

/** Settles the device against the organization's team its marker names: pending changes go up, the rest comes down (D1, D6, D12). */
export async function settle(marker: { teamId: string; org: string; level?: Level; rev: number; dirty: boolean }): Promise<void> {
  const s = getAccountState();
  const team = s.orgTeams.find((t) => t.id === marker.teamId && t.org === marker.org);
  const orgName = s.orgs.find((o) => o.id === marker.org)?.name ?? "the organization";
  let d = readDevice();
  if (!d || d.teamId !== marker.teamId) {
    // D12: nothing of the team's records here; the whole difference goes up, then the team is read whole
    d = { org: marker.org, orgName, teamId: marker.teamId, rev: 0, level: marker.level ?? 0, hashes: { plays: {}, books: {}, settings: "" }, pending: { plays: {}, books: {}, settings: null }, stamps: { plays: {}, books: {} } };
  }
  d.orgName = orgName;
  set({ teamId: marker.teamId, org: marker.org, level: d.level });
  if (!team) { lost(d); return; }
  d.level = team.level;
  writeDevice(d);
  guardFor(d.level, orgName);
  if (marker.dirty || hasPending(d)) {
    notePending(d);
    writeDevice(d);
    if (!(await push())) return;
  }
  if (d.rev === 0) {
    adopt(await api.readTeam(d.org, d.teamId), orgName, false);
  } else {
    set({ status: "saved", message: null });
  }
  startPolling();
}

/** The pending push, done; false (with the panel told why) when it can't be. */
export async function flushed(): Promise<boolean> {
  const d = readDevice();
  if (!d) return true;
  notePending(d);
  if (!hasPending(d)) return true;
  if (await push()) return true;
  set({ message: "Your latest changes aren't in your organization yet. Connect and try again." });
  return false;
}

/** Opens an organization's team on this device, whole, and reloads so every screen starts on it. */
export async function open(org: string, teamId: string): Promise<void> {
  const s = getAccountState();
  const orgName = s.orgs.find((o) => o.id === org)?.name ?? "the organization";
  set({ status: "busy", message: null });
  try {
    stopPolling();
    const record = await api.readTeam(org, teamId);
    adopt(record, orgName, true);
    window.location.reload();
  } catch (e) {
    set(problem(e));
  }
}

// ---- copies ----------------------------------------------------------------------------------

export type CopyTarget = { kind: "org"; org: string; team: string } | { kind: "own"; team: string };

/** Copies plays (and books, renamed to the copies) into another team the coach can draw on (rule 10). */
export async function copyTo(target: CopyTarget, plays: readonly SavedPlay[], books: readonly Playbook[]): Promise<void> {
  const from = getAccountState().teamId;
  if (target.kind === "org") {
    await api.copyInto(target.org, target.team, plays.map((p) => normalizeSavedPlay(p, p.id) ?? p), books.map((b) => normalizePlaybook(b, b.id) ?? b), from);
    return;
  }
  const ids = new Map(plays.map((p) => [p.id, newId()] as const));
  const copies: SavedPlay[] = plays.map((p) => ({ ...(normalizeSavedPlay(p, p.id) ?? p), id: ids.get(p.id) ?? newId() }));
  const copiedBooks: Playbook[] = books.map((b) => settleBook({ ...(normalizePlaybook(b, b.id) ?? b), id: newId(), plays: b.plays.flatMap((id) => { const c = ids.get(id); return c ? [c] : []; }) }));
  let record = await account.readTeam(target.team);
  for (let attempt = 0; attempt < 2; attempt++) {
    // the copies carry no desk: the team's own board, pick, places and links stand (ADR 015)
    const data: TeamData = mergeTeamData({ plays: copies, playbooks: copiedBooks, team: record.data.team, lineups: record.data.lineups, ...EMPTY_DESK }, record.data);
    try {
      await account.writeTeam(target.team, data, record.rev);
      return;
    } catch (e) {
      if (!(e instanceof ApiError) || e.status !== 409 || !e.record || attempt === 1) throw e;
      record = e.record;
    }
  }
}

/** The teams a coach may copy into, other than the one this device has open. */
export function copyTargets(): { label: string; group: string; target: CopyTarget }[] {
  const s = getAccountState();
  const out: { label: string; group: string; target: CopyTarget }[] = [];
  for (const t of s.teams) if (t.id !== s.teamId) out.push({ label: t.name, group: "Your teams", target: { kind: "own", team: t.id } });
  for (const t of s.orgTeams) {
    if (t.level < ASSIST || (t.id === s.teamId && t.org === s.org)) continue;
    out.push({ label: t.name, group: s.orgs.find((o) => o.id === t.org)?.name ?? "Organization", target: { kind: "org", org: t.org, team: t.id } });
  }
  return out;
}

/** The whole device, as a team's data, for a move or a copy. */
export const whole = (): TeamData => deviceData();
