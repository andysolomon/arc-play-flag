import { AccountError } from "@/lib/account/store";
import { accountMode, signedIn } from "@/lib/account/session";
import type { AccountUser } from "@/lib/account/types";
import { DbError, databaseUrl } from "@/lib/db/sql";
import type { OrgMode } from "./types";

export const orgHeaders = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow", "Referrer-Policy": "no-referrer" };

/** A request the organization refused, with the status and one line for the coach. */
export class OrgError extends Error {
  constructor(public status: number, message: string, public body?: Record<string, unknown>) { super(message); }
}

export const UNAVAILABLE = "Your organization is temporarily unavailable. Your work stays on this device.";
export const UNCONFIGURED = "Organizations aren't set up on this deployment yet.";
/** every "that isn't yours" is the same 404, so an outsider can't tell an organization that exists from one that doesn't */
export const NOT_YOURS = "That organization isn't one you're in.";
export const NOT_A_TEAM = "That team isn't in an organization you're in.";
export const readOnly = (org: string): string => `You can look at this team but not change it. Ask an admin of ${org}.`;

/** Organizations need accounts and a database; the fixture coaches count as accounts (ADR 012). */
export function orgMode(): OrgMode {
  return accountMode() !== "off" && databaseUrl() ? "on" : "off";
}

export function orgFailure(error: unknown): Response {
  if (error instanceof OrgError) return Response.json({ error: error.message, ...error.body }, { status: error.status, headers: orgHeaders });
  if (error instanceof AccountError) return Response.json({ error: error.message }, { status: error.status, headers: orgHeaders });
  if (error instanceof DbError) return Response.json({ error: error.reason === "unconfigured" ? UNCONFIGURED : UNAVAILABLE }, { status: 503, headers: orgHeaders });
  return Response.json({ error: UNAVAILABLE }, { status: 503, headers: orgHeaders });
}

/** Writes come only from the app itself: the session is a cookie, so another site's page must not drive it. */
export function sameOrigin(request: Request): void {
  if (request.headers.get("origin") !== new URL(request.url).origin) throw new OrgError(403, "Open the app to change your organization.");
}

/** The signed-in coach, with organizations on; 404 when they are off, 401 when nobody is signed in. */
export async function requireCoach(request: Request): Promise<AccountUser> {
  if (orgMode() === "off") throw new OrgError(404, UNCONFIGURED);
  const user = await signedIn(request);
  if (!user) throw new OrgError(401, "Sign in to use your organization.");
  return user;
}

export const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
export const ID = /^[a-z0-9]{1,40}$/;
/** a play's or a book's id: whatever the device saved it under, as long as it is a URL path segment */
export const RECORD_ID = /^[A-Za-z0-9._~-]{1,80}$/;
export const TOKEN = /^[A-Za-z0-9_-]{16,64}$/;

/** A path segment that is an id, or the 404 for its kind. */
export function checkedId(id: string | undefined, message: string, pattern: RegExp = ID): string {
  if (!id || !pattern.test(id)) throw new OrgError(404, message);
  return id;
}

/** A list of ids from a request body: strings that are ids, each once; anything else is an empty list. */
export function idList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return [...new Set(v.filter((x): x is string => typeof x === "string" && ID.test(x)))];
}

/** A coach's time of a change: their clock, but never ahead of ours, and never missing. */
export function changeTime(v: unknown): string {
  const now = Date.now();
  const at = typeof v === "string" ? Date.parse(v) : NaN;
  return new Date(Number.isFinite(at) && at < now ? at : now).toISOString();
}
