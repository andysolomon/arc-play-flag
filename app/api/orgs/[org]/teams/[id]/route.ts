import { limit } from "@/lib/account/store";
import { NOT_A_TEAM, NOT_YOURS, checkedId, orgFailure, orgHeaders, requireCoach, sameOrigin } from "@/lib/org/http";
import { deleteOrgTeam, readOrgTeam } from "@/lib/org/teams";

export const runtime = "nodejs";
type Context = { params: Promise<{ org: string; id: string }> };
export async function teamIds(context: Context): Promise<{ org: string; team: string }> {
  const { org, id } = await context.params;
  return { org: checkedId(org, NOT_YOURS), team: checkedId(id, NOT_A_TEAM) };
}

/** The team whole, as a device opens it. */
export async function GET(request: Request, context: Context) {
  try {
    const user = await requireCoach(request);
    await limit(user.id, false);
    const { org, team } = await teamIds(context);
    return Response.json(await readOrgTeam(user, org, team), { headers: orgHeaders });
  } catch (error) { return orgFailure(error); }
}

/** Deletes the team for everyone; head coaches and admins. */
export async function DELETE(request: Request, context: Context) {
  try {
    sameOrigin(request);
    const user = await requireCoach(request);
    await limit(user.id, true);
    const { org, team } = await teamIds(context);
    await deleteOrgTeam(user, org, team);
    return new Response(null, { status: 204, headers: orgHeaders });
  } catch (error) { return orgFailure(error); }
}
