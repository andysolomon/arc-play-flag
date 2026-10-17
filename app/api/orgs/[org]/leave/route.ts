import { limit } from "@/lib/account/store";
import { NOT_YOURS, checkedId, orgFailure, orgHeaders, requireCoach, sameOrigin } from "@/lib/org/http";
import { leaveOrg } from "@/lib/org/store";

export const runtime = "nodejs";
type Context = { params: Promise<{ org: string }> };

/** Leaves the organization. The owner alone takes it with them: `{ deleted: true }`. */
export async function POST(request: Request, context: Context) {
  try {
    sameOrigin(request);
    const user = await requireCoach(request);
    await limit(user.id, true);
    const deleted = await leaveOrg(user, checkedId((await context.params).org, NOT_YOURS));
    return Response.json({ deleted }, { headers: orgHeaders });
  } catch (error) { return orgFailure(error); }
}
