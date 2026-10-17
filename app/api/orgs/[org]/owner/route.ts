import { readJson } from "@/lib/account/http";
import { limit } from "@/lib/account/store";
import { NOT_YOURS, OrgError, checkedId, isRecord, orgFailure, orgHeaders, requireCoach, sameOrigin } from "@/lib/org/http";
import { transferOwner } from "@/lib/org/store";

export const runtime = "nodejs";
type Context = { params: Promise<{ org: string }> };

/** Hands the organization to another member (`{ coach }`); the owner only, who becomes an admin. */
export async function POST(request: Request, context: Context) {
  try {
    sameOrigin(request);
    const user = await requireCoach(request);
    await limit(user.id, true);
    const body = await readJson(request, 4096);
    const coach = isRecord(body) && typeof body.coach === "string" ? body.coach : "";
    if (!/^[A-Za-z0-9_]{1,64}$/.test(coach)) throw new OrgError(404, "That coach isn't in the organization.");
    await transferOwner(user, checkedId((await context.params).org, NOT_YOURS), coach);
    return new Response(null, { status: 204, headers: orgHeaders });
  } catch (error) { return orgFailure(error); }
}
