import { expect, request, type APIRequestContext, type APIResponse } from "@playwright/test";
import { defaultLineups } from "../../lib/play/lineup";
import type { Playbook, SavedPlay, TeamSettings } from "../../lib/play/types";
import type { TeamRecord } from "../../lib/account/types";
import type { Changes, Level, OrgDetail, OrgSummary, OrgTeamRecord, OrgTeamSummary, PlayWrite } from "../../lib/org/types";

/**
 * An organization as its coaches drive it over the API (docs/adr/013-organizations.md), one request
 * context per fixture coach, signed in through the fixture cookie as the sign-in page does. Writes
 * carry the app's own Origin, since the server refuses any other (O13). A run id keeps each test's
 * coaches apart from every other's.
 */
export type Coach = "otter" | "heron" | "ibis";
export const BASE = "http://localhost:3123";

export async function coach(name: Coach, run: string): Promise<APIRequestContext> {
  const ctx = await request.newContext({ baseURL: BASE, extraHTTPHeaders: { Origin: BASE } });
  const r = await ctx.post("/api/account/fixture", { data: { coach: name, run } });
  expect(r.status(), `sign in as ${name}`).toBe(204);
  return ctx;
}

/** A response's JSON, after the status a step expects. */
export async function body<T>(r: APIResponse, status: number, what: string): Promise<T> {
  const text = await r.text();
  expect(r.status(), `${what}: ${text}`).toBe(status);
  return (text ? JSON.parse(text) : null) as T;
}

/** One of a coach's own teams (ADR 012), made from fixtures, as a move's starting point. */
export async function ownTeam(c: APIRequestContext, plays: SavedPlay[], playbooks: Playbook[], team: TeamSettings): Promise<TeamRecord> {
  return body<TeamRecord>(await c.post("/api/account/teams", { data: { data: { plays, playbooks, team, lineups: defaultLineups() } } }), 201, "own team");
}

export const createOrg = (c: APIRequestContext, name: string) => c.post("/api/orgs", { data: { name } }).then((r) => body<OrgSummary>(r, 201, "create org"));
export const listOrgs = (c: APIRequestContext) => c.get("/api/orgs").then((r) => body<{ mode: "on"; orgs: OrgSummary[] } | { mode: "off" }>(r, 200, "list orgs"));
export const readOrg = (c: APIRequestContext, org: string) => c.get(`/api/orgs/${org}`).then((r) => body<OrgDetail>(r, 200, "read org"));
export const moveTeam = (c: APIRequestContext, org: string, team: string) => c.post(`/api/orgs/${org}/teams`, { data: { move: team } }).then((r) => body<OrgTeamSummary>(r, 201, "move team"));
export const invite = (c: APIRequestContext, org: string, grants: Record<string, unknown>) => c.post(`/api/orgs/${org}/invites`, { data: grants }).then((r) => body<{ token: string; email: string | null; expires: string }>(r, 201, "invite"));
export const join = (c: APIRequestContext, token: string) => c.post("/api/orgs/join", { data: { token } }).then((r) => body<OrgSummary>(r, 200, "join"));
export const readTeam = (c: APIRequestContext, org: string, team: string) => c.get(`/api/orgs/${org}/teams/${team}`).then((r) => body<OrgTeamRecord>(r, 200, "read team"));
export const writePlay = (c: APIRequestContext, org: string, team: string, play: SavedPlay, at: string) => c.put(`/api/orgs/${org}/teams/${team}/plays/${play.id}`, { data: { play, at } });
export const poll = (c: APIRequestContext, org: string, team: string, since: number, play: string | null = null) =>
  c.post(`/api/orgs/${org}/teams/${team}/poll`, { data: { since, play } }).then((r) => body<Changes & { level: Level }>(r, 200, "poll"));

export const ago = (seconds: number): string => new Date(Date.now() - seconds * 1000).toISOString();
export const names = (t: OrgTeamRecord): string[] => t.plays.map((p) => p.name).sort();
export const applied = (w: PlayWrite): string => ("deleted" in w.play ? "deleted" : w.play.changed.name) + (w.sideline ? ` + sideline "${w.sideline.name}"` : "");
