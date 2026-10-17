import { readJson } from "@/lib/account/http";
import { limit } from "@/lib/account/store";
import { NOT_YOURS, OrgError, checkedId, idList, isRecord, orgFailure, orgHeaders, requireCoach, sameOrigin } from "@/lib/org/http";
import { grantsFrom, removeMember, setMember } from "@/lib/org/store";

export const runtime = "nodejs";
type Context = { params: Promise<{ org: string; coach: string }> };
const COACH = /^[A-Za-z0-9_]{1,64}$/;

async function ids(context: Context): Promise<{ org: string; coach: string }> {
  const { org, coach } = await context.params;
  if (!COACH.test(coach)) throw new OrgError(404, "That coach isn't in the organization.");
  return { org: checkedId(org, NOT_YOURS), coach };
}

/** Re-scopes a member (`teams`, `heads`, `assists`) and, with `role`, makes them an admin or a member. Admins only. */
export async function PUT(request: Request, context: Context) {
  try {
    sameOrigin(request);
    const user = await requireCoach(request);
    await limit(user.id, true);
    const { org, coach } = await ids(context);
    const body = await readJson(request, 16_384);
    const raw = isRecord(body) ? body : {};
    const role = raw.role === "admin" || raw.role === "member" ? raw.role : null;
    if (raw.role !== undefined && !role) throw new OrgError(400, "A member is an admin or a member.");
    return Response.json(await setMember(user, org, coach, grantsFrom(raw, idList), role), { headers: orgHeaders });
  } catch (error) { return orgFailure(error); }
}

/** Removes a coach from the organization; admins only, never the owner. */
export async function DELETE(request: Request, context: Context) {
  try {
    sameOrigin(request);
    const user = await requireCoach(request);
    await limit(user.id, true);
    const { org, coach } = await ids(context);
    await removeMember(user, org, coach);
    return new Response(null, { status: 204, headers: orgHeaders });
  } catch (error) { return orgFailure(error); }
}
