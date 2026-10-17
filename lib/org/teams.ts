/**
 * An organization's teams and what is in them, server-only (docs/adr/013-organizations.md, tier 3):
 * each play and playbook a row with its own rev and stamps, the team's rev bumped by every write, so a
 * device asks for what changed since the rev it read. Every write is one transaction that reads the
 * caller's membership and locks the team row, so writes to one team are applied one at a time.
 *
 * Ways this could go wrong, written down before the code:
 *
 * - T1 a viewer writes (a stale page, a hand-made request): 403 by role on the server (O13).
 * - T2 two coaches save the same play within a poll: the later change (by the coach's own clock) wins;
 *   the earlier one, arriving second, is set aside as a sideline version (rule 5, O2).
 * - T3 a change that comes back from being offline over a play another coach changed since: set aside
 *   as "<name> (your sideline version)", a new play beside the newer one; nothing of either is lost (O3).
 * - T4 a coach's own newer change over their own older one (two devices, a slow clock): applied; the
 *   sideline rule is only ever about another coach's work.
 * - T5 a play deleted here and changed there: the later of the two by the coaches' clocks wins; an
 *   older delete is ignored, an older change over a newer delete is a sideline version (O4).
 * - T6 a device pushes a play the team deleted more than 30 days ago (its tombstone gone): it is a new
 *   play again, as rule 6 says.
 * - T7 a book names a play that isn't there (deleted, or still on its way from another device): kept as
 *   written, and the reference is dropped on every read, as a device's own storage does.
 * - T8 the caps: 1,000 plays or books, a record over 256 KB, settings over 1 MB, 24 teams: refused and say so.
 * - T9 a team moved in twice (the first move's Redis delete failed): the second finds it here already
 *   and only finishes the delete; a team moved into one organization can't be moved into another.
 * - T10 a team deleted while a device still polls it: 404, and the device keeps a read-only copy (O1).
 * - T11 two writes to one team at once: the team row is locked for update, so revs never collide.
 * - T12 a coach's clock ahead of ours: their change time is clamped to now, so no change is "from the
 *   future" and un-overwritable.
 */
import type { Sql } from "postgres";
import { AccountError, deleteTeam as deleteOwnTeam, readTeam as readOwnTeam } from "@/lib/account/store";
import { MAX_TEAM_PLAYBOOKS, MAX_TEAM_PLAYS } from "@/lib/account/data";
import type { AccountUser } from "@/lib/account/types";
import { newId, settleBook } from "@/lib/play/storage";
import type { Lineups, Playbook, SavedPlay, TeamSettings } from "@/lib/play/types";
import { transact } from "@/lib/db/sql";
import { levelOf } from "./access";
import { NOT_A_TEAM, OrgError, readOnly } from "./http";
import { membership, rememberName, type MemberRow } from "./store";
import {
  ASSIST, HEAD, MAX_ORG_TEAMS, MAX_RECORD_BYTES, MAX_SETTINGS_BYTES, TOMBSTONE_DAYS, VIEW,
  type BookChange, type BookWrite, type Changes, type Level, type OrgPlay, type OrgPlaybook, type OrgTeamRecord, type OrgTeamSummary, type PlayChange, type PlayWrite, type Stamp,
} from "./types";

interface TeamRow {
  id: string; org: string; name: string; color: string; settings: TeamSettings; lineups: Lineups; rev: number; settings_rev: number;
  made_by: string; made_name: string; made_at: Date; changed_by: string; changed_name: string; changed_at: Date;
}
interface Stamped { made_by: string; made_name: string; made_at: Date; changed_by: string; changed_name: string; changed_at: Date; deleted: Date | null; rev: number }
interface PlayRow extends Stamped { team: string; id: string; play: SavedPlay | null; from_team: string | null; from_play: string | null }
interface BookRow extends Stamped { team: string; id: string; book: Playbook | null; from_team: string | null; from_book: string | null }
type Counted = TeamRow & { plays: number; playbooks: number };

const made = (r: Stamped): Stamp => ({ by: r.made_by, name: r.made_name, at: r.made_at.toISOString() });
const changed = (r: Stamped): Stamp => ({ by: r.changed_by, name: r.changed_name, at: r.changed_at.toISOString() });

function playOf(r: PlayRow): PlayChange {
  if (!r.play || r.deleted) return { id: r.id, rev: r.rev, deleted: (r.deleted ?? r.changed_at).toISOString(), changed: changed(r) };
  return { ...r.play, id: r.id, rev: r.rev, made: made(r), changed: changed(r), ...(r.from_team && r.from_play ? { from: { team: r.from_team, play: r.from_play } } : {}) };
}
function bookOf(r: BookRow): BookChange {
  if (!r.book || r.deleted) return { id: r.id, rev: r.rev, deleted: (r.deleted ?? r.changed_at).toISOString(), changed: changed(r) };
  return { ...r.book, id: r.id, rev: r.rev, made: made(r), changed: changed(r), ...(r.from_team && r.from_book ? { from: { team: r.from_team, book: r.from_book } } : {}) };
}
const live = (p: PlayChange): p is OrgPlay => !("deleted" in p);
const liveBook = (b: BookChange): b is OrgPlaybook => !("deleted" in b);

function summaryOf(r: Counted, level: Level): OrgTeamSummary {
  return { id: r.id, org: r.org, name: r.name, color: r.color, plays: r.plays, playbooks: r.playbooks, rev: r.rev, updated: r.changed_at.toISOString(), level };
}

const COUNTED = (db: Sql) => db`
  (select count(*)::int from org_plays p where p.team = t.id and p.deleted is null) as plays,
  (select count(*)::int from org_books b where b.team = t.id and b.deleted is null) as playbooks`;

/** The teams a member sees, with what they may do on each (rule 2 and 3). */
export async function listOrgTeams(db: Sql, me: MemberRow): Promise<OrgTeamSummary[]> {
  const rows = await db<Counted[]>`select t.*, ${COUNTED(db)} from org_teams t where t.org = ${me.org} order by t.made_at`;
  return rows.map((r) => summaryOf(r, levelOf(me, r.id))).filter((t) => t.level >= VIEW);
}

/** The team row, locked for the transaction, with what the coach may do on it: 404 unseen, 403 under `min` (T1, T10, T11). */
async function withTeam(tx: Sql, user: AccountUser, org: string, team: string, min: Level): Promise<{ row: Counted; level: Level; orgName: string }> {
  const me = await membership(tx, user.id, org);
  const rows = await tx<(Counted & { org_name: string })[]>`
    select t.*, o.name as org_name, ${COUNTED(tx)} from org_teams t join orgs o on o.id = t.org where t.id = ${team} and t.org = ${org} for update of t`;
  const row = rows[0];
  const level = row ? levelOf(me, team) : 0;
  if (!row || level < VIEW) throw new OrgError(404, NOT_A_TEAM);
  if (level < min) throw new OrgError(403, readOnly(row.org_name));
  await rememberName(tx, user, org);
  return { row, level, orgName: row.org_name };
}

/** The team's write count, one more. */
async function bump(tx: Sql, user: AccountUser, team: string): Promise<number> {
  const [r] = await tx<[{ rev: number }]>`update org_teams set rev = rev + 1, changed_by = ${user.id}, changed_name = ${user.name}, changed_at = now() where id = ${team} returning rev`;
  return r.rev;
}

const tooBig = (v: unknown, max: number, what: string): void => {
  if (JSON.stringify(v).length > max) throw new OrgError(413, `That ${what} is too big to keep in an organization.`);
};

/** Makes an empty team in the organization; any member may, and heads it (rule 3, T8). */
export async function createOrgTeam(user: AccountUser, org: string, team: TeamSettings, lineups: Lineups): Promise<OrgTeamSummary> {
  return transact(async (tx) => {
    const me = await membership(tx, user.id, org);
    const [{ n }] = await tx<[{ n: number }]>`select count(*)::int as n from org_teams where org = ${org}`;
    if (n >= MAX_ORG_TEAMS) throw new OrgError(409, `An organization holds up to ${String(MAX_ORG_TEAMS)} teams. Delete one to make another.`);
    const id = newId();
    const [row] = await tx<TeamRow[]>`
      insert into org_teams (id, org, name, color, settings, lineups, made_by, made_name, changed_by, changed_name)
      values (${id}, ${org}, ${team.name.trim() || "My team"}, ${team.color}, ${tx.json(team as never)}, ${tx.json(lineups as never)}, ${user.id}, ${user.name}, ${user.id}, ${user.name})
      returning *`;
    if (!row) throw new OrgError(503, "Couldn't make the team.");
    await tx`update memberships set heads = array_append(heads, ${id}) where org = ${org} and coach = ${user.id} and not (${id} = any(heads))`;
    return summaryOf({ ...row, plays: 0, playbooks: 0 }, levelOf({ ...me, heads: [...me.heads, id] }, id));
  });
}

/**
 * Moves one of the coach's own teams (ADR 012) into the organization: its plays and books become rows
 * here, it leaves the account, and the coach heads it. Not atomic across the two stores, so a move
 * whose last step failed finishes on the next try (T9).
 */
export async function moveTeam(user: AccountUser, org: string, team: string): Promise<OrgTeamSummary> {
  const summary = await transact(async (tx) => {
    const me = await membership(tx, user.id, org);
    const [here] = await tx<Counted[]>`select t.*, ${COUNTED(tx)} from org_teams t where t.id = ${team}`;
    if (here) {
      if (here.org !== org) throw new OrgError(409, "That team is already in another organization.");
      return summaryOf(here, levelOf(me, team));
    }
    let own;
    try {
      own = await readOwnTeam(user.id, team);
    } catch (e) {
      if (e instanceof AccountError && e.status === 404) throw new OrgError(404, "That team isn't one of yours to move.");
      throw e;
    }
    const [{ n }] = await tx<[{ n: number }]>`select count(*)::int as n from org_teams where org = ${org}`;
    if (n >= MAX_ORG_TEAMS) throw new OrgError(409, `An organization holds up to ${String(MAX_ORG_TEAMS)} teams. Delete one to make another.`);
    const now = new Date();
    const [row] = await tx<TeamRow[]>`
      insert into org_teams (id, org, name, color, settings, lineups, made_by, made_name, made_at, changed_by, changed_name, changed_at)
      values (${team}, ${org}, ${own.name}, ${own.color}, ${tx.json(own.data.team as never)}, ${tx.json(own.data.lineups as never)}, ${user.id}, ${user.name}, ${now}, ${user.id}, ${user.name}, ${now})
      returning *`;
    if (!row) throw new OrgError(503, "Couldn't move the team.");
    for (const p of own.data.plays) {
      await tx`insert into org_plays (team, id, play, rev, made_by, made_name, made_at, changed_by, changed_name, changed_at)
        values (${team}, ${p.id}, ${tx.json(p as never)}, 1, ${user.id}, ${user.name}, ${now}, ${user.id}, ${user.name}, ${now})`;
    }
    for (const b of own.data.playbooks) {
      await tx`insert into org_books (team, id, book, rev, made_by, made_name, made_at, changed_by, changed_name, changed_at)
        values (${team}, ${b.id}, ${tx.json(b as never)}, 1, ${user.id}, ${user.name}, ${now}, ${user.id}, ${user.name}, ${now})`;
    }
    await tx`update memberships set heads = array_append(heads, ${team}) where org = ${org} and coach = ${user.id} and not (${team} = any(heads))`;
    return summaryOf({ ...row, plays: own.data.plays.length, playbooks: own.data.playbooks.length }, levelOf({ ...me, heads: [...me.heads, team] }, team));
  });
  try {
    await deleteOwnTeam(user.id, team);
  } catch (e) {
    if (!(e instanceof AccountError && e.status === 404)) throw e;
  }
  return summary;
}

/** The team whole, as a device opens it (T7); tombstones past their 30 days are swept on the way. */
export async function readOrgTeam(user: AccountUser, org: string, team: string): Promise<OrgTeamRecord> {
  return transact(async (tx) => {
    const { row, level } = await withTeam(tx, user, org, team, VIEW);
    await tx`delete from org_plays where team = ${team} and deleted < now() - make_interval(days => ${TOMBSTONE_DAYS})`;
    await tx`delete from org_books where team = ${team} and deleted < now() - make_interval(days => ${TOMBSTONE_DAYS})`;
    const plays = (await tx<PlayRow[]>`select * from org_plays where team = ${team} and deleted is null order by made_at, id`).map(playOf).filter(live);
    const ids = new Set(plays.map((p) => p.id));
    const playbooks = (await tx<BookRow[]>`select * from org_books where team = ${team} and deleted is null order by made_at, id`).map(bookOf).filter(liveBook)
      .map((b) => ({ ...b, ...settleBook({ ...b, plays: b.plays.filter((id) => ids.has(id)) }) }));
    return { ...summaryOf(row, level), team: row.settings, lineups: row.lineups, settingsRev: row.settings_rev, plays, playbooks };
  });
}

/** Deletes the team and everything in it, for everyone (rule 14); head coaches and admins only. */
export async function deleteOrgTeam(user: AccountUser, org: string, team: string): Promise<void> {
  await transact(async (tx) => {
    await withTeam(tx, user, org, team, HEAD);
    await tx`delete from org_teams where id = ${team}`;
  });
}

/** What changed since the rev the device read: plays and books (tombstones included), settings when they did (rule 8). */
export async function changesSince(user: AccountUser, org: string, team: string, since: number): Promise<Omit<Changes, "presence"> & { level: Level }> {
  return transact(async (tx) => {
    const { row, level } = await withTeam(tx, user, org, team, VIEW);
    const plays = (await tx<PlayRow[]>`select * from org_plays where team = ${team} and rev > ${since} order by rev`).map(playOf);
    const playbooks = (await tx<BookRow[]>`select * from org_books where team = ${team} and rev > ${since} order by rev`).map(bookOf);
    const settings = row.settings_rev > since ? { team: row.settings, lineups: row.lineups, rev: row.settings_rev } : null;
    return { rev: row.rev, plays, playbooks, settings, level };
  });
}

/** True when the stored record is another coach's and newer than this change (rule 5: T2, T3, T4, T5). */
const outranks = (r: Stamped, user: AccountUser, at: Date): boolean => r.changed_by !== user.id && r.changed_at > at;

async function countLive(tx: Sql, table: "org_plays" | "org_books", team: string, max: number, what: string): Promise<void> {
  const [{ n }] = table === "org_plays"
    ? await tx<[{ n: number }]>`select count(*)::int as n from org_plays where team = ${team} and deleted is null`
    : await tx<[{ n: number }]>`select count(*)::int as n from org_books where team = ${team} and deleted is null`;
  if (n >= max) throw new OrgError(409, `A team holds up to ${String(max)} ${what}.`);
}

const SIDELINE = " (your sideline version)";

/** Writes a play as the coach's change at `at`; sets it aside as a sideline version when another coach's newer change is there (rule 5). */
export async function writePlay(user: AccountUser, org: string, team: string, play: SavedPlay, at: Date): Promise<PlayWrite> {
  tooBig(play, MAX_RECORD_BYTES, "play");
  return transact(async (tx) => {
    await withTeam(tx, user, org, team, ASSIST);
    const [current] = await tx<PlayRow[]>`select * from org_plays where team = ${team} and id = ${play.id} for update`;
    const rev = await bump(tx, user, team);
    if (current && outranks(current, user, at)) {
      await countLive(tx, "org_plays", team, MAX_TEAM_PLAYS, "plays");
      const side: SavedPlay = { ...play, id: newId(), name: `${play.name}${SIDELINE}` };
      const [row] = await tx<PlayRow[]>`
        insert into org_plays (team, id, play, rev, made_by, made_name, made_at, changed_by, changed_name, changed_at)
        values (${team}, ${side.id}, ${tx.json(side as never)}, ${rev}, ${user.id}, ${user.name}, ${at}, ${user.id}, ${user.name}, ${at}) returning *`;
      if (!row) throw new OrgError(503, "Couldn't save the play.");
      await tx`update org_plays set rev = ${rev} where team = ${team} and id = ${play.id}`;
      const kept = playOf({ ...current, rev });
      return { rev, play: kept, sideline: playOf(row) as OrgPlay };
    }
    if (!current || current.deleted) await countLive(tx, "org_plays", team, MAX_TEAM_PLAYS, "plays");
    const [row] = current
      ? await tx<PlayRow[]>`update org_plays set play = ${tx.json(play as never)}, rev = ${rev}, changed_by = ${user.id}, changed_name = ${user.name}, changed_at = ${at}, deleted = null
          where team = ${team} and id = ${play.id} returning *`
      : await tx<PlayRow[]>`insert into org_plays (team, id, play, rev, made_by, made_name, made_at, changed_by, changed_name, changed_at)
          values (${team}, ${play.id}, ${tx.json(play as never)}, ${rev}, ${user.id}, ${user.name}, ${at}, ${user.id}, ${user.name}, ${at}) returning *`;
    if (!row) throw new OrgError(503, "Couldn't save the play.");
    return { rev, play: playOf(row) };
  });
}

/** Deletes a play as the coach's change at `at`; an older delete over another coach's newer change is ignored (T5). */
export async function deletePlay(user: AccountUser, org: string, team: string, id: string, at: Date): Promise<{ rev: number; play: PlayChange | null }> {
  return transact(async (tx) => {
    const { row: t } = await withTeam(tx, user, org, team, ASSIST);
    const [current] = await tx<PlayRow[]>`select * from org_plays where team = ${team} and id = ${id} for update`;
    if (!current || current.deleted) return { rev: t.rev, play: current ? playOf(current) : null };
    if (outranks(current, user, at)) return { rev: t.rev, play: playOf(current) };
    const rev = await bump(tx, user, team);
    const [row] = await tx<PlayRow[]>`update org_plays set play = null, deleted = now(), rev = ${rev}, changed_by = ${user.id}, changed_name = ${user.name}, changed_at = ${at}
      where team = ${team} and id = ${id} returning *`;
    return { rev, play: row ? playOf(row) : null };
  });
}

export async function writeBook(user: AccountUser, org: string, team: string, book: Playbook, at: Date): Promise<BookWrite> {
  tooBig(book, MAX_RECORD_BYTES, "playbook");
  return transact(async (tx) => {
    await withTeam(tx, user, org, team, ASSIST);
    const [current] = await tx<BookRow[]>`select * from org_books where team = ${team} and id = ${book.id} for update`;
    const rev = await bump(tx, user, team);
    if (current && outranks(current, user, at)) {
      await countLive(tx, "org_books", team, MAX_TEAM_PLAYBOOKS, "playbooks");
      const side: Playbook = { ...book, id: newId(), name: `${book.name}${SIDELINE}` };
      const [row] = await tx<BookRow[]>`
        insert into org_books (team, id, book, rev, made_by, made_name, made_at, changed_by, changed_name, changed_at)
        values (${team}, ${side.id}, ${tx.json(side as never)}, ${rev}, ${user.id}, ${user.name}, ${at}, ${user.id}, ${user.name}, ${at}) returning *`;
      if (!row) throw new OrgError(503, "Couldn't save the playbook.");
      await tx`update org_books set rev = ${rev} where team = ${team} and id = ${book.id}`;
      return { rev, book: bookOf({ ...current, rev }), sideline: bookOf(row) as OrgPlaybook };
    }
    if (!current || current.deleted) await countLive(tx, "org_books", team, MAX_TEAM_PLAYBOOKS, "playbooks");
    const [row] = current
      ? await tx<BookRow[]>`update org_books set book = ${tx.json(book as never)}, rev = ${rev}, changed_by = ${user.id}, changed_name = ${user.name}, changed_at = ${at}, deleted = null
          where team = ${team} and id = ${book.id} returning *`
      : await tx<BookRow[]>`insert into org_books (team, id, book, rev, made_by, made_name, made_at, changed_by, changed_name, changed_at)
          values (${team}, ${book.id}, ${tx.json(book as never)}, ${rev}, ${user.id}, ${user.name}, ${at}, ${user.id}, ${user.name}, ${at}) returning *`;
    if (!row) throw new OrgError(503, "Couldn't save the playbook.");
    return { rev, book: bookOf(row) };
  });
}

export async function deleteBook(user: AccountUser, org: string, team: string, id: string, at: Date): Promise<{ rev: number; book: BookChange | null }> {
  return transact(async (tx) => {
    const { row: t } = await withTeam(tx, user, org, team, ASSIST);
    const [current] = await tx<BookRow[]>`select * from org_books where team = ${team} and id = ${id} for update`;
    if (!current || current.deleted) return { rev: t.rev, book: current ? bookOf(current) : null };
    if (outranks(current, user, at)) return { rev: t.rev, book: bookOf(current) };
    const rev = await bump(tx, user, team);
    const [row] = await tx<BookRow[]>`update org_books set book = null, deleted = now(), rev = ${rev}, changed_by = ${user.id}, changed_name = ${user.name}, changed_at = ${at}
      where team = ${team} and id = ${id} returning *`;
    return { rev, book: row ? bookOf(row) : null };
  });
}

/** The team's settings and lineups, head coaches only (rule 3); the last write wins outright, as a device's own do. */
export async function writeSettings(user: AccountUser, org: string, team: string, settings: TeamSettings, lineups: Lineups): Promise<{ rev: number }> {
  tooBig({ settings, lineups }, MAX_SETTINGS_BYTES, "team's settings and roster");
  return transact(async (tx) => {
    await withTeam(tx, user, org, team, HEAD);
    const rev = await bump(tx, user, team);
    await tx`update org_teams set settings = ${tx.json(settings as never)}, lineups = ${tx.json(lineups as never)}, name = ${settings.name.trim() || "My team"}, color = ${settings.color}, settings_rev = ${rev} where id = ${team}`;
    return { rev };
  });
}

/**
 * Copies plays and books into the team as new records that say where they came from (rule 10): new
 * ids, each book's plays renamed to the copies made with it, references to plays not copied dropped.
 */
export async function copyInto(user: AccountUser, org: string, team: string, plays: SavedPlay[], books: Playbook[], from: string | null): Promise<{ rev: number; plays: OrgPlay[]; playbooks: OrgPlaybook[] }> {
  for (const p of plays) tooBig(p, MAX_RECORD_BYTES, "play");
  for (const b of books) tooBig(b, MAX_RECORD_BYTES, "playbook");
  return transact(async (tx) => {
    const { row } = await withTeam(tx, user, org, team, ASSIST);
    if (row.plays + plays.length > MAX_TEAM_PLAYS) throw new OrgError(409, `A team holds up to ${String(MAX_TEAM_PLAYS)} plays.`);
    if (row.playbooks + books.length > MAX_TEAM_PLAYBOOKS) throw new OrgError(409, `A team holds up to ${String(MAX_TEAM_PLAYBOOKS)} playbooks.`);
    const rev = await bump(tx, user, team);
    const now = new Date();
    const ids = new Map(plays.map((p) => [p.id, newId()] as const));
    const outPlays: OrgPlay[] = [];
    for (const p of plays) {
      const copy: SavedPlay = { ...p, id: ids.get(p.id) ?? newId() };
      const [r] = await tx<PlayRow[]>`insert into org_plays (team, id, play, rev, made_by, made_name, made_at, changed_by, changed_name, changed_at, from_team, from_play)
        values (${team}, ${copy.id}, ${tx.json(copy as never)}, ${rev}, ${user.id}, ${user.name}, ${now}, ${user.id}, ${user.name}, ${now}, ${from}, ${from ? p.id : null}) returning *`;
      if (r) { const o = playOf(r); if (live(o)) outPlays.push(o); }
    }
    const outBooks: OrgPlaybook[] = [];
    for (const b of books) {
      const copy = settleBook({ ...b, id: newId(), plays: b.plays.flatMap((id) => { const c = ids.get(id); return c ? [c] : []; }) });
      const [r] = await tx<BookRow[]>`insert into org_books (team, id, book, rev, made_by, made_name, made_at, changed_by, changed_name, changed_at, from_team, from_book)
        values (${team}, ${copy.id}, ${tx.json(copy as never)}, ${rev}, ${user.id}, ${user.name}, ${now}, ${user.id}, ${user.name}, ${now}, ${from}, ${from ? b.id : null}) returning *`;
      if (r) { const o = bookOf(r); if (liveBook(o)) outBooks.push(o); }
    }
    return { rev, plays: outPlays, playbooks: outBooks };
  });
}
