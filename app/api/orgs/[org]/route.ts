import { readJson } from "@/lib/account/http";
import { limit } from "@/lib/account/store";
import { NOT_YOURS, checkedId, isRecord, orgFailure, orgHeaders, requireCoach, sameOrigin } from "@/lib/org/http";
import { deleteOrg, orgName, readOrg, renameOrg } from "@/lib/org/store";

export const runtime = "nodejs";
type Context = { params: Promise<{ org: string }> };
const orgId = async (context: Context): Promise<string> => checkedId((await context.params).org, NOT_YOURS);

/** The organization as the coach sees it: for an admin, everyone and every open invite too. */
export async function GET(request: Request, context: Context) {
  try {
    const user = await requireCoach(request);
    await limit(user.id, false);
    return Response.json(await readOrg(user, await orgId(context)), { headers: orgHeaders });
  } catch (error) { return orgFailure(error); }
}

/** Renames the organization; admins only. */
export async function PATCH(request: Request, context: Context) {
  try {
    sameOrigin(request);
    const user = await requireCoach(request);
    await limit(user.id, true);
    const body = await readJson(request, 4096);
    await renameOrg(user, await orgId(context), orgName(isRecord(body) ? body.name : undefined));
    return new Response(null, { status: 204, headers: orgHeaders });
  } catch (error) { return orgFailure(error); }
}

/** Deletes the organization and its teams; the owner only. */
export async function DELETE(request: Request, context: Context) {
  try {
    sameOrigin(request);
    const user = await requireCoach(request);
    await limit(user.id, true);
    await deleteOrg(user, await orgId(context));
    return new Response(null, { status: 204, headers: orgHeaders });
  } catch (error) { return orgFailure(error); }
}
