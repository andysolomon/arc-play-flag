import { readJson } from "@/lib/account/http";
import { limit } from "@/lib/account/store";
import { normalizeLineups, normalizeTeam } from "@/lib/play/storage";
import { NOT_A_TEAM, NOT_YOURS, OrgError, checkedId, isRecord, orgFailure, orgHeaders, requireCoach, sameOrigin } from "@/lib/org/http";
import { writeSettings } from "@/lib/org/teams";
import { MAX_SETTINGS_BYTES } from "@/lib/org/types";

export const runtime = "nodejs";
type Context = { params: Promise<{ org: string; id: string }> };

/** The team's settings and lineups (`{ team, lineups }`); head coaches only. */
export async function PUT(request: Request, context: Context) {
  try {
    sameOrigin(request);
    const user = await requireCoach(request);
    await limit(user.id, true);
    const { org, id } = await context.params;
    const body = await readJson(request, MAX_SETTINGS_BYTES + 4096);
    const raw = isRecord(body) ? body : {};
    const team = normalizeTeam(raw.team);
    const lineups = normalizeLineups(raw.lineups);
    if (!team || !lineups) throw new OrgError(400, "That isn't a team's settings and roster.");
    return Response.json(await writeSettings(user, checkedId(org, NOT_YOURS), checkedId(id, NOT_A_TEAM), team, lineups), { headers: orgHeaders });
  } catch (error) { return orgFailure(error); }
}
