import { readJson } from "@/lib/account/http";
import { limit, TEAM_ID } from "@/lib/account/store";
import { DEFAULT_TEAM, normalizeTeam } from "@/lib/play/storage";
import { defaultLineups } from "@/lib/play/lineup";
import { NOT_YOURS, OrgError, checkedId, isRecord, orgFailure, orgHeaders, requireCoach, sameOrigin } from "@/lib/org/http";
import { createOrgTeam, moveTeam } from "@/lib/org/teams";

export const runtime = "nodejs";
type Context = { params: Promise<{ org: string }> };

/** Makes an empty team (`{ name, color? }`) or moves one of the coach's own in (`{ move: <team id> }`). The coach heads it. */
export async function POST(request: Request, context: Context) {
  try {
    sameOrigin(request);
    const user = await requireCoach(request);
    await limit(user.id, true);
    const org = checkedId((await context.params).org, NOT_YOURS);
    const body = await readJson(request, 4096);
    const raw = isRecord(body) ? body : {};
    if (raw.move !== undefined) {
      if (typeof raw.move !== "string" || !TEAM_ID.test(raw.move)) throw new OrgError(404, "That team isn't one of yours to move.");
      return Response.json(await moveTeam(user, org, raw.move), { status: 201, headers: orgHeaders });
    }
    const team = normalizeTeam({ name: typeof raw.name === "string" ? raw.name.slice(0, 40) : "", color: typeof raw.color === "string" ? raw.color : DEFAULT_TEAM.color }) ?? DEFAULT_TEAM;
    return Response.json(await createOrgTeam(user, org, team, defaultLineups()), { status: 201, headers: orgHeaders });
  } catch (error) { return orgFailure(error); }
}
