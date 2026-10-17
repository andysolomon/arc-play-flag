import { readJson } from "@/lib/account/http";
import { limit } from "@/lib/account/store";
import { OrgError, TOKEN, isRecord, orgFailure, orgHeaders, orgMode, requireCoach, sameOrigin } from "@/lib/org/http";
import { joinByToken, previewInvite } from "@/lib/org/store";

export const runtime = "nodejs";

const tokenOf = (v: unknown): string => {
  if (typeof v !== "string" || !TOKEN.test(v)) throw new OrgError(404, "This invite has expired. Ask an admin of the organization for a new one.");
  return v;
};

/** What a link says before sign-in: `?token=`, the organization's name and when the link stops working. */
export async function GET(request: Request) {
  try {
    if (orgMode() === "off") throw new OrgError(404, "Organizations aren't set up on this deployment yet.");
    return Response.json(await previewInvite(tokenOf(new URL(request.url).searchParams.get("token"))), { headers: orgHeaders });
  } catch (error) { return orgFailure(error); }
}

/** Joins the organization an invite names, as a signed-in coach. */
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const user = await requireCoach(request);
    await limit(user.id, true);
    const body = await readJson(request, 4096);
    return Response.json(await joinByToken(user, tokenOf(isRecord(body) ? body.token : undefined)), { headers: orgHeaders });
  } catch (error) { return orgFailure(error); }
}
