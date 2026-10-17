import type { EndZoneId } from "@/lib/endzone";
import type { DraftRecord } from "@/lib/play/storage";
import type { Lineups, Playbook, SavedPlay, TeamSettings } from "@/lib/play/types";
import type { Shares } from "@/lib/sharing/shares";
import type { FieldChoice, ThemeChoice } from "@/lib/theme";

/** Who is signed in, as the account panel shows them. */
export interface AccountUser {
  id: string;
  name: string;
  email: string | null;
  imageUrl: string | null;
}

/**
 * Everything a team keeps in the account (ADR 012, ADR 013): what a device backup carries
 * (lib/export/backup.ts), the draft on the chalkboard included, and the rest of the desk that goes
 * with the team: the playbook picked in the designer, where each book was last read, and the share
 * links made for its plays and books.
 */
export interface TeamData {
  plays: SavedPlay[];
  playbooks: Playbook[];
  team: TeamSettings;
  lineups: Lineups;
  /** the play on the chalkboard, saved or not; null when the board is clear */
  draft: DraftRecord | null;
  /** the playbook the designer works in (lib/play/current-book.ts): one of `playbooks`, or null for the first */
  currentBook: string | null;
  /** the game-day reader's place in each book, by book id (lib/play/reader.ts) */
  reader: Record<string, number>;
  /** the share links the coach can still revoke, by what they share (lib/sharing/shares.ts) */
  shares: Shares;
}

/**
 * How the app looks to the coach, the same on every team (ADR 013): the choices Play tools and the
 * playbooks' settings offer, the touchdowns that open the end zones, and whether the getting-started
 * guide has been seen.
 */
export interface CoachPrefs {
  theme: ThemeChoice;
  field: FieldChoice;
  endZone: EndZoneId;
  deepField: boolean;
  touchdowns: number;
  /** the getting-started guide was dismissed or taken */
  firstUseDone: boolean;
}

/** The coach's look as the account holds it: with the count of times it has changed, so a device knows when to bring it down. */
export interface AccountPrefs extends CoachPrefs {
  rev: number;
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

/** A team with its data, and the coach's look as it stands, so a device adopting the team has both. */
export interface TeamRecord extends TeamSummary {
  data: TeamData;
  prefs: AccountPrefs;
}

/** What a write gives back: the team as listed now, and the look as the account holds it after the write. */
export interface TeamWritten extends TeamSummary {
  prefs: AccountPrefs;
}

/** How sign-in works on this deployment: Clerk, the journeys' fixture coaches, or not at all. */
export type AccountMode = "clerk" | "fixture" | "off";

/** What GET /api/account says: whether accounts are on, who is signed in, their teams and their look. */
export type AccountResponse =
  | { mode: "off" }
  | { mode: Exclude<AccountMode, "off">; user: null }
  | { mode: Exclude<AccountMode, "off">; user: AccountUser; teams: TeamSummary[]; current: string | null; prefs: AccountPrefs };

/** What a device writes to a team: the data, the rev it was reading, and the coach's look as it stands on the device. */
export interface TeamWrite {
  data: TeamData;
  rev: number;
  prefs?: CoachPrefs;
}
