import { accountFailure, accountHeaders, readJson, requireUser, sameOrigin, teamDataFrom } from "@/lib/account/http";
import { AccountError, TEAM_ID, deleteTeam, limit, readTeam, writeTeam } from "@/lib/account/store";

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

/** Writes the team over the rev the device read; 409 with the account's copy when another device wrote since. */
export async function PUT(request: Request, context: Context) {
  try {
    sameOrigin(request);
    const user = await requireUser(request);
    const id = await checkedId(context);
    await limit(user.id, true);
    const body = await readJson(request);
    if (!isRecord(body) || typeof body.rev !== "number" || !Number.isInteger(body.rev)) throw new AccountError(400, "A write names the rev it read.");
    const summary = await writeTeam(user.id, id, teamDataFrom(body.data), body.rev);
    return Response.json(summary, { headers: accountHeaders });
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
