import { ApiError } from "@/lib/account/api";
import type { Lineups, Playbook, SavedPlay, TeamSettings } from "@/lib/play/types";
import type {
  BookWrite, Changes, Grants, Invite, InvitePreview, Level, Membership, OrgDetail, OrgPlay, OrgPlaybook, OrgSummary, OrgTeamRecord, OrgTeamSummary, OrgsResponse, PlayWrite,
} from "./types";

/** The organization's API as the device calls it (docs/adr/013-organizations.md); every failure is an ApiError the panel can read. */
const OFFLINE = "Couldn't reach your organization.";

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, { credentials: "same-origin", cache: "no-store", ...init });
  } catch {
    throw new ApiError(0, OFFLINE);
  }
  if (response.status === 204) return null as T;
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new ApiError(response.ok ? 0 : response.status, OFFLINE);
  }
  if (!response.ok) {
    const b = body as { error?: unknown };
    throw new ApiError(response.status, typeof b.error === "string" ? b.error : OFFLINE);
  }
  return body as T;
}

const json = (method: string, body: unknown): RequestInit => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const q = encodeURIComponent;

export const orgs = (): Promise<OrgsResponse> => call("/api/orgs");
export const createOrg = (name: string): Promise<OrgSummary> => call("/api/orgs", json("POST", { name }));
export const readOrg = (org: string): Promise<OrgDetail> => call(`/api/orgs/${q(org)}`);
export const renameOrg = (org: string, name: string): Promise<null> => call(`/api/orgs/${q(org)}`, json("PATCH", { name }));
export const deleteOrg = (org: string): Promise<null> => call(`/api/orgs/${q(org)}`, { method: "DELETE" });
export const previewInvite = (token: string): Promise<InvitePreview> => call(`/api/orgs/join?token=${q(token)}`);
export const join = (token: string): Promise<OrgSummary> => call("/api/orgs/join", json("POST", { token }));
export const createInvite = (org: string, body: Partial<Grants> & { email?: string }): Promise<Invite> => call(`/api/orgs/${q(org)}/invites`, json("POST", body));
export const revokeInvite = (org: string, token: string): Promise<null> => call(`/api/orgs/${q(org)}/invites/${q(token)}`, { method: "DELETE" });
export const setMember = (org: string, coach: string, body: Partial<Grants> & { role?: "admin" | "member" }): Promise<Membership> =>
  call(`/api/orgs/${q(org)}/members/${q(coach)}`, json("PUT", body));
export const removeMember = (org: string, coach: string): Promise<null> => call(`/api/orgs/${q(org)}/members/${q(coach)}`, { method: "DELETE" });
export const transferOwner = (org: string, coach: string): Promise<null> => call(`/api/orgs/${q(org)}/owner`, json("POST", { coach }));
export const leave = (org: string): Promise<{ deleted: boolean }> => call(`/api/orgs/${q(org)}/leave`, { method: "POST" });
export const createTeam = (org: string, name: string, color?: string): Promise<OrgTeamSummary> => call(`/api/orgs/${q(org)}/teams`, json("POST", { name, color }));
export const moveTeam = (org: string, team: string): Promise<OrgTeamSummary> => call(`/api/orgs/${q(org)}/teams`, json("POST", { move: team }));
export const readTeam = (org: string, team: string): Promise<OrgTeamRecord> => call(`/api/orgs/${q(org)}/teams/${q(team)}`);
export const deleteTeam = (org: string, team: string): Promise<null> => call(`/api/orgs/${q(org)}/teams/${q(team)}`, { method: "DELETE" });
export const poll = (org: string, team: string, since: number, play: string | null): Promise<Changes & { level: Level }> =>
  call(`/api/orgs/${q(org)}/teams/${q(team)}/poll`, json("POST", { since, play }));
export const writePlay = (org: string, team: string, play: SavedPlay, at: string): Promise<PlayWrite> =>
  call(`/api/orgs/${q(org)}/teams/${q(team)}/plays/${q(play.id)}`, json("PUT", { play, at }));
export const deletePlay = (org: string, team: string, id: string, at: string): Promise<{ rev: number }> =>
  call(`/api/orgs/${q(org)}/teams/${q(team)}/plays/${q(id)}?at=${q(at)}`, { method: "DELETE" });
export const writeBook = (org: string, team: string, book: Playbook, at: string): Promise<BookWrite> =>
  call(`/api/orgs/${q(org)}/teams/${q(team)}/books/${q(book.id)}`, json("PUT", { book, at }));
export const deleteBook = (org: string, team: string, id: string, at: string): Promise<{ rev: number }> =>
  call(`/api/orgs/${q(org)}/teams/${q(team)}/books/${q(id)}?at=${q(at)}`, { method: "DELETE" });
export const writeSettings = (org: string, team: string, settings: TeamSettings, lineups: Lineups): Promise<{ rev: number }> =>
  call(`/api/orgs/${q(org)}/teams/${q(team)}/settings`, json("PUT", { team: settings, lineups }));
export const copyInto = (org: string, team: string, plays: SavedPlay[], playbooks: Playbook[], from: string | null): Promise<{ rev: number; plays: OrgPlay[]; playbooks: OrgPlaybook[] }> =>
  call(`/api/orgs/${q(org)}/teams/${q(team)}/copy`, json("POST", { plays, playbooks, from }));
