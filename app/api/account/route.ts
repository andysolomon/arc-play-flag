import { accountFailure, accountHeaders } from "@/lib/account/http";
import { accountMode, signedIn } from "@/lib/account/session";
import { limit, listTeams } from "@/lib/account/store";
import type { AccountResponse } from "@/lib/account/types";

export const runtime = "nodejs";

/** Whether accounts are on here, who is signed in, and their teams. */
export async function GET(request: Request) {
  try {
    const mode = accountMode();
    if (mode === "off") return Response.json({ mode } satisfies AccountResponse, { headers: accountHeaders });
    const user = await signedIn(request);
    if (!user) return Response.json({ mode, user: null } satisfies AccountResponse, { headers: accountHeaders });
    await limit(user.id, false);
    const { teams, current } = await listTeams(user.id);
    return Response.json({ mode, user, teams, current } satisfies AccountResponse, { headers: accountHeaders });
  } catch (error) { return accountFailure(error); }
}
