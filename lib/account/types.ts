import type { Lineups, Playbook, SavedPlay, TeamSettings } from "@/lib/play/types";

/** Who is signed in, as the account panel shows them. */
export interface AccountUser {
  id: string;
  name: string;
  email: string | null;
  imageUrl: string | null;
}

/**
 * Everything a team keeps in the account: what a device backup carries (lib/export/backup.ts), less
 * the draft and the playbook picked in the designer, which stay the device's (ADR 010, A16).
 */
export interface TeamData {
  plays: SavedPlay[];
  playbooks: Playbook[];
  team: TeamSettings;
  lineups: Lineups;
}

/** A team as the account lists it, without its data. */
export interface TeamSummary {
  id: string;
  name: string;
  color: string;
  plays: number;
  playbooks: number;
  /** when the team was last written, ISO 8601 */
  updated: string;
  /** the write count: a device writes against the rev it last read, so two devices never overwrite each other blind (A8) */
  rev: number;
}

export interface TeamRecord extends TeamSummary {
  data: TeamData;
}

/** How sign-in works on this deployment: Clerk, the journeys' fixture coaches, or not at all. */
export type AccountMode = "clerk" | "fixture" | "off";

/** What GET /api/account says: whether accounts are on, who is signed in, and their teams. */
export type AccountResponse =
  | { mode: "off" }
  | { mode: Exclude<AccountMode, "off">; user: null }
  | { mode: Exclude<AccountMode, "off">; user: AccountUser; teams: TeamSummary[]; current: string | null };

/** What a device writes to a team: the data and the rev it was reading. */
export interface TeamWrite {
  data: TeamData;
  rev: number;
}
