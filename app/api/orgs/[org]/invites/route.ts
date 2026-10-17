import { readJson } from "@/lib/account/http";
import { limit } from "@/lib/account/store";
import { NOT_YOURS, OrgError, checkedId, idList, isRecord, orgFailure, orgHeaders, requireCoach, sameOrigin } from "@/lib/org/http";
import { createInvite, grantsFrom } from "@/lib/org/store";

export const runtime = "nodejs";
type Context = { params: Promise<{ org: string }> };

/** An invite: `{ email?, teams?, heads?, assists? }`; a link when there is no email. Admins only. */
export async function POST(request: Request, context: Context) {
  try {
    sameOrigin(request);
    const user = await requireCoach(request);
    await limit(user.id, true);
    const org = checkedId((await context.params).org, NOT_YOURS);
    const body = await readJson(request, 16_384);
    const raw = isRecord(body) ? body : {};
    let email: string | null = null;
    if (raw.email !== undefined && raw.email !== null) {
      email = typeof raw.email === "string" ? raw.email.trim().toLowerCase() : "";
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) throw new OrgError(400, "That isn't an email address.");
    }
    return Response.json(await createInvite(user, org, email, grantsFrom(raw, idList)), { status: 201, headers: orgHeaders });
  } catch (error) { return orgFailure(error); }
}
