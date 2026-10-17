import { readJson } from "@/lib/account/http";
import { NOT_A_TEAM, NOT_YOURS, OrgError, checkedId, isRecord, orgFailure, orgHeaders, requireCoach, sameOrigin, RECORD_ID } from "@/lib/org/http";
import { pollAllowed, touch } from "@/lib/org/presence";
import { changesSince } from "@/lib/org/teams";
import type { Changes, Level } from "@/lib/org/types";

export const runtime = "nodejs";
type Context = { params: Promise<{ org: string; id: string }> };

/**
 * The poll (ADR 013, rule 8): `{ since, play }` says the rev the device read and the play it is on;
 * the answer is what changed since, who else is here, and what the coach may do (so a device learns
 * it has become read-only). Limited per coach per team, not against the account's reads.
 */
export async function POST(request: Request, context: Context) {
  try {
    sameOrigin(request);
    const user = await requireCoach(request);
    const { org, id } = await context.params;
    const orgId = checkedId(org, NOT_YOURS);
    const team = checkedId(id, NOT_A_TEAM);
    if (!(await pollAllowed(team, user.id))) throw new OrgError(429, "Too many requests. The team will catch up in a moment.");
    const body = await readJson(request, 4096);
    const raw = isRecord(body) ? body : {};
    const since = typeof raw.since === "number" && Number.isInteger(raw.since) && raw.since >= 0 ? raw.since : 0;
    const play = typeof raw.play === "string" && RECORD_ID.test(raw.play) ? raw.play : null;
    const changes = await changesSince(user, orgId, team, since);
    const presence = await touch(team, { coach: user.id, name: user.name, play, at: new Date().toISOString() });
    return Response.json({ ...changes, presence } satisfies Changes & { level: Level }, { headers: orgHeaders });
  } catch (error) { return orgFailure(error); }
}
