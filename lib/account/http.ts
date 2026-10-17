import { MAX_TEAM_BYTES, lacksDesk, readPrefs, readTeamData } from "./data";
import { AccountError } from "./store";
import { signedIn } from "./session";
import type { AccountUser, CoachPrefs, TeamData } from "./types";

export const accountHeaders = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow", "Referrer-Policy": "no-referrer" };

export function accountFailure(error: unknown): Response {
  if (error instanceof AccountError) {
    return Response.json({ error: error.message, ...(error.record ? { record: error.record } : {}) }, { status: error.status, headers: accountHeaders });
  }
  return Response.json({ error: "Your account is temporarily unavailable. Your work stays on this device." }, { status: 503, headers: accountHeaders });
}

/** Writes come only from the app itself: the session is a cookie, so another site's page must not drive it. */
export function sameOrigin(request: Request): void {
  if (request.headers.get("origin") !== new URL(request.url).origin) throw new AccountError(403, "Open the app to change your account.");
}

/** The signed-in coach, or a 401 the panel reads as "sign in again" (A12). */
export async function requireUser(request: Request): Promise<AccountUser> {
  const user = await signedIn(request);
  if (!user) throw new AccountError(401, "Sign in to use your account.");
  return user;
}

/** The body as JSON, bounded on the stream itself, including requests without Content-Length. */
export async function readJson(request: Request, max = MAX_TEAM_BYTES + 4096): Promise<unknown> {
  if (!request.headers.get("content-type")?.startsWith("application/json")) throw new AccountError(415, "Expected JSON.");
  if (Number(request.headers.get("content-length")) > max) throw new AccountError(413, "That team is too big to keep in an account.");
  const reader = request.body?.getReader();
  if (!reader) throw new AccountError(400, "The request is empty.");
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > max) { await reader.cancel(); throw new AccountError(413, "That team is too big to keep in an account."); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new AccountError(400, "That request isn't readable.");
  }
}

/** A team's data from a request body, or a 400. */
export function teamDataFrom(raw: unknown): TeamData {
  const data = readTeamData(raw);
  if (!data) throw new AccountError(400, "That isn't a team's data.");
  if (JSON.stringify(data).length > MAX_TEAM_BYTES) throw new AccountError(413, "That team is too big to keep in an account.");
  return data;
}

/**
 * A team's data from a request body, as `teamDataFrom`, except that a body from a build before the desk
 * went up (ADR 014, A24) names none of the desk's keys, and the account's own desk is kept instead.
 */
export function teamDataOver(raw: unknown, stored: TeamData): TeamData {
  const data = teamDataFrom(raw);
  if (!lacksDesk(raw)) return data;
  return { ...data, draft: stored.draft, currentBook: stored.currentBook, reader: stored.reader, shares: stored.shares };
}

/** The coach's look from a request body, when it carries one; undefined leaves the account's alone. */
export function prefsFrom(raw: unknown): CoachPrefs | undefined {
  return raw === undefined || raw === null ? undefined : readPrefs(raw);
}
