import { readJson } from "@/lib/account/http";
import { limit } from "@/lib/account/store";
import { normalizeSavedPlay } from "@/lib/play/storage";
import { NOT_A_TEAM, NOT_YOURS, OrgError, RECORD_ID, changeTime, checkedId, isRecord, orgFailure, orgHeaders, requireCoach, sameOrigin } from "@/lib/org/http";
import { deletePlay, writePlay } from "@/lib/org/teams";
import { MAX_RECORD_BYTES } from "@/lib/org/types";

export const runtime = "nodejs";
type Context = { params: Promise<{ org: string; id: string; play: string }> };

async function ids(context: Context): Promise<{ org: string; team: string; play: string }> {
  const { org, id, play } = await context.params;
  return { org: checkedId(org, NOT_YOURS), team: checkedId(id, NOT_A_TEAM), play: checkedId(play, "That play isn't in the team.", RECORD_ID) };
}

/** Writes the play (`{ play, at }`, `at` the coach's time of the change); head coaches and assistants. */
export async function PUT(request: Request, context: Context) {
  try {
    sameOrigin(request);
    const user = await requireCoach(request);
    await limit(user.id, true);
    const { org, team, play: id } = await ids(context);
    const body = await readJson(request, MAX_RECORD_BYTES + 4096);
    const raw = isRecord(body) ? body : {};
    const play = normalizeSavedPlay(raw.play, id);
    if (!play) throw new OrgError(400, "That isn't a play.");
    return Response.json(await writePlay(user, org, team, { ...play, id }, new Date(changeTime(raw.at))), { headers: orgHeaders });
  } catch (error) { return orgFailure(error); }
}

/** Deletes the play as of `?at=`; an older delete over another coach's newer change is ignored and the play returned. */
export async function DELETE(request: Request, context: Context) {
  try {
    sameOrigin(request);
    const user = await requireCoach(request);
    await limit(user.id, true);
    const { org, team, play } = await ids(context);
    const at = new Date(changeTime(new URL(request.url).searchParams.get("at")));
    return Response.json(await deletePlay(user, org, team, play, at), { headers: orgHeaders });
  } catch (error) { return orgFailure(error); }
}
