import { limit } from "@/lib/account/store";
import { NOT_YOURS, OrgError, TOKEN, checkedId, orgFailure, orgHeaders, requireCoach, sameOrigin } from "@/lib/org/http";
import { revokeInvite } from "@/lib/org/store";

export const runtime = "nodejs";
type Context = { params: Promise<{ org: string; token: string }> };

/** Revokes an invite; admins only. */
export async function DELETE(request: Request, context: Context) {
  try {
    sameOrigin(request);
    const user = await requireCoach(request);
    await limit(user.id, true);
    const { org, token } = await context.params;
    if (!TOKEN.test(token)) throw new OrgError(404, "That invite is gone.");
    await revokeInvite(user, checkedId(org, NOT_YOURS), token);
    return new Response(null, { status: 204, headers: orgHeaders });
  } catch (error) { return orgFailure(error); }
}
