/**
 * The organizations' store, server-only (docs/adr/013-organizations.md): organizations, who is in
 * them with what role and grants, and the invites that bring coaches in. Teams and what is in them
 * are lib/org/teams.ts. Every change is one transaction that reads the caller's membership first, so
 * a coach removed a moment ago is refused (O1, O13).
 *
 * Ways this could go wrong, written down before the code:
 *
 * - S1 a coach asks about an organization they're not in, or one that doesn't exist: the same 404
 *   either way, so nothing about the organization leaks.
 * - S2 a member does an admin's thing (invite, remove, re-scope, delete a team), or an admin does the
 *   owner's (delete the organization, hand it on): 403, read on the server from the membership.
 * - S3 an admin re-scopes or removes the owner, or themselves: refused; an owner hands on, a member leaves.
 * - S4 the owner leaves with others in: refused until they hand on (O8); the owner alone leaving
 *   deletes the organization with its teams.
 * - S5 an invite past its expiry, or revoked: "This invite has expired", not who sent it.
 * - S6 an email invite claimed by a coach whose address differs only in case, or who has it as a
 *   second verified address (O6): matched lower-cased against every verified address.
 * - S7 a coach joins by a link twice, or by a link and an email invite: one membership, the first
 *   grants kept; the email invite is used up either way.
 * - S8 an email invite's address is held by a coach already in the organization: used up, nothing changes.
 * - S9 the caps: a coach in 10 organizations, 50 members, 20 open invites: refused and say so.
 * - S10 an invite made for a team that is later deleted: joining still works; the grant names
 *   nothing and is dropped when read.
 * - S11 the database is down or missing: 503 with one line, and nothing half-written, since every
 *   change is one transaction.
 * - S12 a name that is blank or absurdly long: trimmed, 40 characters at most, a blank refused.
 */
import { randomBytes } from "node:crypto";
import type { Sql } from "postgres";
import type { AccountUser } from "@/lib/account/types";
import { newId } from "@/lib/play/storage";
import { query, transact } from "@/lib/db/sql";
import { isAdmin } from "./access";
import { NOT_YOURS, OrgError, isRecord } from "./http";
import { listOrgTeams } from "./teams";
import {
  INVITE_DAYS, MAX_MEMBERS, MAX_OPEN_INVITES, MAX_ORGS_PER_COACH,
  type Grants, type Invite, type InvitePreview, type Membership, type OrgDetail, type OrgRole, type OrgSummary, type Organization,
} from "./types";

export interface OrgRow { id: string; name: string; owner: string; created: Date }
export interface MemberRow { org: string; coach: string; name: string; role: OrgRole; teams: string[] | null; heads: string[]; assists: string[]; invited_by: string | null; joined: Date }
interface InviteRow { token: string; org: string; by: string; email: string | null; teams: string[] | null; heads: string[]; assists: string[]; created: Date; expires: Date }

const orgOf = (r: OrgRow): Organization => ({ id: r.id, name: r.name, owner: r.owner, created: r.created.toISOString() });
export const memberOf = (r: MemberRow): Membership => ({ coach: r.coach, name: r.name, role: r.role, teams: r.teams, heads: r.heads, assists: r.assists, joined: r.joined.toISOString() });
const inviteOf = (r: InviteRow): Invite => ({ token: r.token, org: r.org, by: r.by, email: r.email, teams: r.teams, heads: r.heads, assists: r.assists, created: r.created.toISOString(), expires: r.expires.toISOString() });

/** A name as the organization keeps it: trimmed, at most 40 characters, never blank (S12). */
export function orgName(v: unknown): string {
  const name = typeof v === "string" ? v.trim().slice(0, 40) : "";
  if (!name) throw new OrgError(400, "Give the organization a name.");
  return name;
}

/** Grants from a request body: a list of teams or every team, and the teams headed and assisted. */
export function grantsFrom(raw: unknown, idList: (v: unknown) => string[]): Grants {
  const r = isRecord(raw) ? raw : {};
  return { teams: r.teams === null || r.teams === undefined || r.teams === "all" ? null : idList(r.teams), heads: idList(r.heads), assists: idList(r.assists) };
}

/** The caller's membership in an organization, or the 404 (S1). Inside a transaction when given one. */
export async function membership(db: Sql, coach: string, org: string): Promise<MemberRow> {
  const [m] = await db<MemberRow[]>`select * from memberships where org = ${org} and coach = ${coach}`;
  if (!m) throw new OrgError(404, NOT_YOURS);
  return m;
}

async function requireAdmin(db: Sql, coach: string, org: string): Promise<MemberRow> {
  const m = await membership(db, coach, org);
  if (!isAdmin(m.role)) throw new OrgError(403, "Only an admin of the organization can do that.");
  return m;
}

/** The coach's organizations, after any email invite waiting for them is claimed (rule 4). */
export async function listOrgs(user: AccountUser): Promise<OrgSummary[]> {
  await claimInvites(user);
  return query(async (db) => {
    const rows = await db<(OrgRow & { role: OrgRole; members: number; teams: number })[]>`
      select o.*, m.role,
        (select count(*)::int from memberships x where x.org = o.id) as members,
        (select count(*)::int from org_teams t where t.org = o.id) as teams
      from memberships m join orgs o on o.id = m.org
      where m.coach = ${user.id}
      order by o.created`;
    return rows.map((r) => ({ ...orgOf(r), role: r.role, members: r.members, teams: r.teams }));
  });
}

/** Makes an organization with the coach as its owner (S9 for the coach's count). */
export async function createOrg(user: AccountUser, name: string): Promise<OrgSummary> {
  return transact(async (tx) => {
    const [{ n }] = await tx<[{ n: number }]>`select count(*)::int as n from memberships where coach = ${user.id}`;
    if (n >= MAX_ORGS_PER_COACH) throw new OrgError(409, `A coach can be in up to ${String(MAX_ORGS_PER_COACH)} organizations.`);
    const id = newId();
    const [row] = await tx<OrgRow[]>`insert into orgs (id, name, owner) values (${id}, ${name}, ${user.id}) returning *`;
    await tx`insert into memberships (org, coach, name, role, teams) values (${id}, ${user.id}, ${user.name}, 'owner', null)`;
    if (!row) throw new OrgError(503, "Couldn't make the organization.");
    return { ...orgOf(row), role: "owner" as const, members: 1, teams: 0 };
  });
}

/** The organization as the coach sees it: for an admin, everyone and every open invite too. */
export async function readOrg(user: AccountUser, org: string): Promise<OrgDetail> {
  return query(async (db) => {
    const me = await membership(db, user.id, org);
    const [row] = await db<OrgRow[]>`select * from orgs where id = ${org}`;
    if (!row) throw new OrgError(404, NOT_YOURS);
    const teams = await listOrgTeams(db, me);
    const detail: OrgDetail = { org: orgOf(row), me: memberOf(me), teams };
    if (isAdmin(me.role)) {
      await db`delete from invites where org = ${org} and expires <= now()`;
      detail.members = (await db<MemberRow[]>`select * from memberships where org = ${org} order by joined`).map(memberOf);
      detail.invites = (await db<InviteRow[]>`select * from invites where org = ${org} order by created`).map(inviteOf);
    }
    return detail;
  });
}

export async function renameOrg(user: AccountUser, org: string, name: string): Promise<void> {
  await transact(async (tx) => {
    await requireAdmin(tx, user.id, org);
    await tx`update orgs set name = ${name} where id = ${org}`;
  });
}

/** Deletes the organization and, by cascade, its teams, memberships and invites (rule 1). Owner only (S2). */
export async function deleteOrg(user: AccountUser, org: string): Promise<void> {
  await transact(async (tx) => {
    const me = await membership(tx, user.id, org);
    if (me.role !== "owner") throw new OrgError(403, "Only the owner can delete the organization.");
    await tx`delete from orgs where id = ${org}`;
  });
}

/** An invite: a link until it expires, or for one email address (rule 4). Admins only; at most 20 open (S9). */
export async function createInvite(user: AccountUser, org: string, email: string | null, grants: Grants): Promise<Invite> {
  return transact(async (tx) => {
    await requireAdmin(tx, user.id, org);
    await tx`delete from invites where org = ${org} and expires <= now()`;
    const [{ n }] = await tx<[{ n: number }]>`select count(*)::int as n from invites where org = ${org}`;
    if (n >= MAX_OPEN_INVITES) throw new OrgError(409, `An organization has up to ${String(MAX_OPEN_INVITES)} open invites. Revoke one to make another.`);
    const token = randomBytes(18).toString("base64url");
    const expires = new Date(Date.now() + INVITE_DAYS * 86_400_000);
    const [row] = await tx<InviteRow[]>`
      insert into invites (token, org, by, email, teams, heads, assists, expires)
      values (${token}, ${org}, ${user.id}, ${email}, ${grants.teams}, ${grants.heads}, ${grants.assists}, ${expires})
      returning *`;
    if (!row) throw new OrgError(503, "Couldn't make the invite.");
    return inviteOf(row);
  });
}

export async function revokeInvite(user: AccountUser, org: string, token: string): Promise<void> {
  await transact(async (tx) => {
    await requireAdmin(tx, user.id, org);
    await tx`delete from invites where org = ${org} and token = ${token}`;
  });
}

const EXPIRED = "This invite has expired. Ask an admin of the organization for a new one.";

/** What a link says before sign-in: the organization's name and when the link stops working (S5). */
export async function previewInvite(token: string): Promise<InvitePreview> {
  return query(async (db) => {
    const [row] = await db<{ name: string; expires: Date }[]>`
      select o.name, i.expires from invites i join orgs o on o.id = i.org where i.token = ${token} and i.email is null and i.expires > now()`;
    if (!row) throw new OrgError(404, EXPIRED);
    return { org: row.name, expires: row.expires.toISOString() };
  });
}

/** Joins by a link, or by an email invite for one of the coach's addresses (S6, S7, S8, S9). */
export async function joinByToken(user: AccountUser, token: string): Promise<OrgSummary> {
  return transact(async (tx) => {
    const [invite] = await tx<InviteRow[]>`select * from invites where token = ${token} and expires > now() for update`;
    if (!invite || (invite.email !== null && !emailsOf(user).includes(invite.email))) throw new OrgError(404, EXPIRED);
    return join(tx, user, invite);
  });
}

const emailsOf = (user: AccountUser): string[] => (user.emails ?? (user.email ? [user.email] : [])).map((e) => e.trim().toLowerCase());

/** Email invites waiting for this coach, claimed on their next visit (rule 4); nothing when they have none. */
export async function claimInvites(user: AccountUser): Promise<void> {
  const emails = emailsOf(user);
  if (!emails.length) return;
  await transact(async (tx) => {
    const waiting = await tx<InviteRow[]>`select * from invites where email = any(${emails}) and expires > now() for update`;
    for (const invite of waiting) await join(tx, user, invite);
  });
}

async function join(tx: Sql, user: AccountUser, invite: InviteRow): Promise<OrgSummary> {
  const [org] = await tx<OrgRow[]>`select * from orgs where id = ${invite.org} for update`;
  if (!org) throw new OrgError(404, EXPIRED);
  const [already] = await tx<MemberRow[]>`select * from memberships where org = ${invite.org} and coach = ${user.id}`;
  let role: OrgRole = "member";
  if (already) {
    role = already.role;
  } else {
    const [{ members, mine }] = await tx<[{ members: number; mine: number }]>`
      select (select count(*)::int from memberships where org = ${invite.org}) as members,
             (select count(*)::int from memberships where coach = ${user.id}) as mine`;
    if (members >= MAX_MEMBERS) throw new OrgError(409, `${org.name} is full: an organization holds up to ${String(MAX_MEMBERS)} coaches.`);
    if (mine >= MAX_ORGS_PER_COACH) throw new OrgError(409, `A coach can be in up to ${String(MAX_ORGS_PER_COACH)} organizations.`);
    await tx`insert into memberships (org, coach, name, role, teams, heads, assists, invited_by)
      values (${invite.org}, ${user.id}, ${user.name}, 'member', ${invite.teams}, ${invite.heads}, ${invite.assists}, ${invite.by})`;
  }
  if (invite.email !== null) await tx`delete from invites where token = ${invite.token}`;
  const [{ members, teams }] = await tx<[{ members: number; teams: number }]>`
    select (select count(*)::int from memberships where org = ${invite.org}) as members,
           (select count(*)::int from org_teams where org = ${invite.org}) as teams`;
  return { ...orgOf(org), role, members, teams };
}

/** An admin re-scopes a member, or makes a member an admin or an admin a member; never the owner, never themselves (S3). */
export async function setMember(user: AccountUser, org: string, coach: string, grants: Grants, role: "admin" | "member" | null): Promise<Membership> {
  return transact(async (tx) => {
    await requireAdmin(tx, user.id, org);
    if (coach === user.id) throw new OrgError(403, "Ask another admin to change your own membership.");
    const [target] = await tx<MemberRow[]>`select * from memberships where org = ${org} and coach = ${coach} for update`;
    if (!target) throw new OrgError(404, "That coach isn't in the organization.");
    if (target.role === "owner") throw new OrgError(403, "The owner runs every team; hand the organization on to change that.");
    const [row] = await tx<MemberRow[]>`
      update memberships set teams = ${grants.teams}, heads = ${grants.heads}, assists = ${grants.assists}, role = ${role ?? target.role}
      where org = ${org} and coach = ${coach} returning *`;
    if (!row) throw new OrgError(503, "Couldn't change the membership.");
    return memberOf(row);
  });
}

/** An admin removes a coach; the owner can't be removed, and nobody removes themselves (they leave) (S3). */
export async function removeMember(user: AccountUser, org: string, coach: string): Promise<void> {
  await transact(async (tx) => {
    await requireAdmin(tx, user.id, org);
    if (coach === user.id) throw new OrgError(403, "Leave the organization instead.");
    const [target] = await tx<MemberRow[]>`select * from memberships where org = ${org} and coach = ${coach}`;
    if (!target) throw new OrgError(404, "That coach isn't in the organization.");
    if (target.role === "owner") throw new OrgError(403, "The owner can't be removed.");
    await tx`delete from memberships where org = ${org} and coach = ${coach}`;
  });
}

/** The owner hands the organization to another member, and becomes an admin (O8). */
export async function transferOwner(user: AccountUser, org: string, coach: string): Promise<void> {
  await transact(async (tx) => {
    const me = await membership(tx, user.id, org);
    if (me.role !== "owner") throw new OrgError(403, "Only the owner can hand the organization on.");
    if (coach === user.id) throw new OrgError(400, "That's you.");
    const [target] = await tx<MemberRow[]>`select * from memberships where org = ${org} and coach = ${coach}`;
    if (!target) throw new OrgError(404, "That coach isn't in the organization.");
    await tx`update memberships set role = 'admin' where org = ${org} and coach = ${user.id}`;
    await tx`update memberships set role = 'owner' where org = ${org} and coach = ${coach}`;
    await tx`update orgs set owner = ${coach} where id = ${org}`;
  });
}

/** A member leaves. The owner leaves last: alone, the organization goes with them (S4). Returns true when it did. */
export async function leaveOrg(user: AccountUser, org: string): Promise<boolean> {
  return transact(async (tx) => {
    const me = await membership(tx, user.id, org);
    if (me.role === "owner") {
      const [{ n }] = await tx<[{ n: number }]>`select count(*)::int as n from memberships where org = ${org}`;
      if (n > 1) throw new OrgError(409, "Hand the organization to another coach before you leave it.");
      await tx`delete from orgs where id = ${org}`;
      return true;
    }
    await tx`delete from memberships where org = ${org} and coach = ${user.id}`;
    return false;
  });
}

/** Keeps the member's name as the account shows it now, so plays they touch and the members list read right. */
export async function rememberName(db: Sql, user: AccountUser, org: string): Promise<void> {
  await db`update memberships set name = ${user.name} where org = ${org} and coach = ${user.id} and name <> ${user.name}`;
}
