import { readJson } from "@/lib/account/http";
import { limit } from "@/lib/account/store";
import { isRecord, orgFailure, orgHeaders, orgMode, requireCoach, sameOrigin } from "@/lib/org/http";
import { createOrg, listOrgs, orgName } from "@/lib/org/store";
import type { OrgsResponse } from "@/lib/org/types";

export const runtime = "nodejs";

/** Whether organizations are on here, and the coach's, after any email invite waiting for them is claimed. */
export async function GET(request: Request) {
  try {
    if (orgMode() === "off") return Response.json({ mode: "off" } satisfies OrgsResponse, { headers: orgHeaders });
    const user = await requireCoach(request);
    await limit(user.id, false);
    return Response.json({ mode: "on", orgs: await listOrgs(user) } satisfies OrgsResponse, { headers: orgHeaders });
  } catch (error) { return orgFailure(error); }
}

/** Makes an organization with the coach as its owner. */
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const user = await requireCoach(request);
    await limit(user.id, true);
    const body = await readJson(request, 4096);
    const org = await createOrg(user, orgName(isRecord(body) ? body.name : undefined));
    return Response.json(org, { status: 201, headers: orgHeaders });
  } catch (error) { return orgFailure(error); }
}
