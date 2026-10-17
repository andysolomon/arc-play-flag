import { accountFailure, accountHeaders, readJson, requireUser, sameOrigin } from "@/lib/account/http";
import { AccountError, TEAM_ID, limit, setCurrent } from "@/lib/account/store";

export const runtime = "nodejs";
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

/** Remembers the team this device opened, so the next device opens it too. */
export async function PUT(request: Request) {
  try {
    sameOrigin(request);
    const user = await requireUser(request);
    await limit(user.id, true);
    const body = await readJson(request, 4096);
    if (!isRecord(body) || typeof body.id !== "string" || !TEAM_ID.test(body.id)) throw new AccountError(404, "That team isn't in your account.");
    await setCurrent(user.id, body.id);
    return new Response(null, { status: 204, headers: accountHeaders });
  } catch (error) { return accountFailure(error); }
}
