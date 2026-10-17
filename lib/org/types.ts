import type { Lineups, Playbook, SavedPlay, TeamSettings } from "@/lib/play/types";

/**
 * An organization that owns teams shared by its coaches (docs/adr/013-organizations.md). These are the
 * shapes the API speaks; the tables are db/migrations/001-organizations.sql.
 */
export type OrgRole = "owner" | "admin" | "member";

/** Whether organizations are on here: they need accounts (ADR 012) and a database. */
export type OrgMode = "on" | "off";

export interface Organization {
  id: string;
  name: string;
  owner: string;
  created: string;
}

/** What a member may see and do: every team (`teams: null`) or a list, and the teams they head or assist. */
export interface Grants {
  teams: string[] | null;
  heads: string[];
  assists: string[];
}

export interface Membership extends Grants {
  coach: string;
  name: string;
  role: OrgRole;
  joined: string;
}

export interface Invite extends Grants {
  token: string;
  org: string;
  by: string;
  /** lower-cased; null for a link anyone may use until it expires */
  email: string | null;
  created: string;
  expires: string;
}

/** What a coach may do on a team: nothing, look, draw plays and books, or everything. */
export type Level = 0 | 1 | 2 | 3;
export const VIEW: Level = 1;
export const ASSIST: Level = 2;
export const HEAD: Level = 3;

/** Who touched a record and when; `at` is the coach's own time of the change (rule 5). */
export interface Stamp {
  by: string;
  name: string;
  at: string;
}

export interface OrgPlay extends SavedPlay {
  rev: number;
  made: Stamp;
  changed: Stamp;
  from?: { team: string; play: string };
}

export interface OrgPlaybook extends Playbook {
  rev: number;
  made: Stamp;
  changed: Stamp;
  from?: { team: string; book: string };
}

/** A record as a poll reports it: the record, or its id and when it was deleted. */
export type PlayChange = OrgPlay | { id: string; rev: number; deleted: string; changed: Stamp };
export type BookChange = OrgPlaybook | { id: string; rev: number; deleted: string; changed: Stamp };

/** A team as the organization lists it. */
export interface OrgTeamSummary {
  id: string;
  org: string;
  name: string;
  color: string;
  plays: number;
  playbooks: number;
  rev: number;
  updated: string;
  /** what the coach asking may do on it */
  level: Level;
}

/** A team whole, as a device opens it: no tombstones, every book's reference to a play that isn't there dropped. */
export interface OrgTeamRecord extends Omit<OrgTeamSummary, "plays" | "playbooks"> {
  team: TeamSettings;
  lineups: Lineups;
  settingsRev: number;
  plays: OrgPlay[];
  playbooks: OrgPlaybook[];
}

/** What changed since the rev a device last read, and who else is on the team. */
export interface Changes {
  rev: number;
  plays: PlayChange[];
  playbooks: BookChange[];
  settings: { team: TeamSettings; lineups: Lineups; rev: number } | null;
  presence: Presence[];
}

export interface Presence {
  coach: string;
  name: string;
  /** the play they are on, or null for the playbooks screen */
  play: string | null;
  at: string;
}

/** The answer to a write of a play: applied, or set aside beside the newer play as a sideline version (rule 5). */
export interface PlayWrite {
  rev: number;
  /** the play as the team now has it: the device's, or the newer one that stood (a tombstone when it was deleted since) */
  play: PlayChange;
  /** the device's version, saved as a new play, when the play was changed by another coach since */
  sideline?: OrgPlay;
}

export interface BookWrite {
  rev: number;
  book: BookChange;
  sideline?: OrgPlaybook;
}

export interface OrgSummary extends Organization {
  role: OrgRole;
  members: number;
  teams: number;
}

/** What GET /api/orgs says: whether organizations are on, and the coach's. */
export type OrgsResponse = { mode: "off" } | { mode: "on"; orgs: OrgSummary[] };

/** What GET /api/orgs/<id> says: the organization, the coach's own membership, the teams they see, and for an admin everyone and every open invite. */
export interface OrgDetail {
  org: Organization;
  me: Membership;
  teams: OrgTeamSummary[];
  members?: Membership[];
  invites?: Invite[];
}

/** Everything a sign-in page needs to say about an invite before the coach is signed in. */
export interface InvitePreview {
  org: string;
  expires: string;
}

export const MAX_ORGS_PER_COACH = 10;
export const MAX_MEMBERS = 50;
export const MAX_ORG_TEAMS = 24;
export const MAX_OPEN_INVITES = 20;
export const INVITE_DAYS = 7;
export const TOMBSTONE_DAYS = 30;
/** a play or a book as JSON, at most */
export const MAX_RECORD_BYTES = 256_000;
/** a team's settings and lineups as JSON, at most */
export const MAX_SETTINGS_BYTES = 1_000_000;
/** presence older than this is nobody */
export const PRESENCE_SECONDS = 30;
