import type { AccountResponse, TeamData, TeamRecord, TeamSummary } from "./types";

/** A request that didn't do what was asked: the status (0 for no answer at all), one line for the coach, and the account's copy on a 409. */
export class ApiError extends Error {
  constructor(public status: number, message: string, public record?: TeamRecord) { super(message); }
}

const OFFLINE = "Couldn't reach your account.";

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
    const b = body as { error?: unknown; record?: TeamRecord };
    throw new ApiError(response.status, typeof b.error === "string" ? b.error : OFFLINE, b.record);
  }
  return body as T;
}

const json = (method: string, body: unknown): RequestInit => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

export const account = (): Promise<AccountResponse> => call("/api/account");
export const readTeam = (id: string): Promise<TeamRecord> => call(`/api/account/teams/${id}`);
export const createTeam = (body: { data: TeamData } | { name: string; color?: string }): Promise<TeamRecord> => call("/api/account/teams", json("POST", body));
export const writeTeam = (id: string, data: TeamData, rev: number): Promise<TeamSummary> => call(`/api/account/teams/${id}`, json("PUT", { data, rev }));
export const deleteTeam = (id: string): Promise<null> => call(`/api/account/teams/${id}`, { method: "DELETE" });
export const setCurrent = (id: string): Promise<null> => call("/api/account/current", json("PUT", { id }));
export const fixtureSignIn = (coach: string, run: string): Promise<null> => call("/api/account/fixture", json("POST", { coach, run }));
export const fixtureSignOut = (): Promise<null> => call("/api/account/fixture", { method: "DELETE" });
