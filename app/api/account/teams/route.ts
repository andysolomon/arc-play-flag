import { accountFailure, accountHeaders, readJson, requireUser, sameOrigin, teamDataFrom } from "@/lib/account/http";
import { emptyTeamData, UNNAMED_TEAM } from "@/lib/account/data";
import { createTeam, limit } from "@/lib/account/store";

export const runtime = "nodejs";
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

/** Makes a team: from a device's data when given, else empty with a name and colour. It becomes the current one. */
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const user = await requireUser(request);
    await limit(user.id, true);
    const body = await readJson(request);
    const raw = isRecord(body) ? body : {};
    const data = raw.data !== undefined
      ? teamDataFrom(raw.data)
      : emptyTeamData(typeof raw.name === "string" ? raw.name.slice(0, 40) : UNNAMED_TEAM, typeof raw.color === "string" ? raw.color : undefined);
    const record = await createTeam(user.id, data);
    return Response.json(record, { status: 201, headers: accountHeaders });
  } catch (error) { return accountFailure(error); }
}
