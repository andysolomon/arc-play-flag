import { accountFailure, accountHeaders, prefsFrom, readJson, requireUser, sameOrigin, teamDataFrom, teamDataOver } from "@/lib/account/http";
import { AccountError, TEAM_ID, deleteTeam, limit, readTeam, writeTeam } from "@/lib/account/store";
import { lacksDesk } from "@/lib/account/data";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

async function checkedId(context: Context): Promise<string> {
  const { id } = await context.params;
  if (!TEAM_ID.test(id)) throw new AccountError(404, "That team isn't in your account.");
  return id;
}

export async function GET(request: Request, context: Context) {
  try {
    const user = await requireUser(request);
    const id = await checkedId(context);
    await limit(user.id, false);
    return Response.json(await readTeam(user.id, id), { headers: accountHeaders });
  } catch (error) { return accountFailure(error); }
}

/**
 * Writes the team over the rev the device read, and the coach's look when the body carries one; 409 with
 * the account's copy when another device wrote since. A body from a build before the desk went up (A24)
 * keeps the account's desk: the stored team is read first, and the rev check still refuses a stale write.
 */
export async function PUT(request: Request, context: Context) {
  try {
    sameOrigin(request);
    const user = await requireUser(request);
    const id = await checkedId(context);
    await limit(user.id, true);
    const body = await readJson(request);
    if (!isRecord(body) || typeof body.rev !== "number" || !Number.isInteger(body.rev)) throw new AccountError(400, "A write names the rev it read.");
    const data = lacksDesk(body.data) ? teamDataOver(body.data, (await readTeam(user.id, id)).data) : teamDataFrom(body.data);
    const written = await writeTeam(user.id, id, data, body.rev, prefsFrom(body.prefs));
    return Response.json(written, { headers: accountHeaders });
  } catch (error) { return accountFailure(error); }
}

export async function DELETE(request: Request, context: Context) {
  try {
    sameOrigin(request);
    const user = await requireUser(request);
    const id = await checkedId(context);
    await limit(user.id, true);
    await deleteTeam(user.id, id);
    return new Response(null, { status: 204, headers: accountHeaders });
  } catch (error) { return accountFailure(error); }
}
