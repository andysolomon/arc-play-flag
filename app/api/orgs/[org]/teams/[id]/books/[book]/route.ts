import { readJson } from "@/lib/account/http";
import { limit } from "@/lib/account/store";
import { normalizePlaybook } from "@/lib/play/storage";
import { NOT_A_TEAM, NOT_YOURS, OrgError, RECORD_ID, changeTime, checkedId, isRecord, orgFailure, orgHeaders, requireCoach, sameOrigin } from "@/lib/org/http";
import { deleteBook, writeBook } from "@/lib/org/teams";
import { MAX_RECORD_BYTES } from "@/lib/org/types";

export const runtime = "nodejs";
type Context = { params: Promise<{ org: string; id: string; book: string }> };

async function ids(context: Context): Promise<{ org: string; team: string; book: string }> {
  const { org, id, book } = await context.params;
  return { org: checkedId(org, NOT_YOURS), team: checkedId(id, NOT_A_TEAM), book: checkedId(book, "That playbook isn't in the team.", RECORD_ID) };
}

/** Writes the playbook (`{ book, at }`); head coaches and assistants. */
export async function PUT(request: Request, context: Context) {
  try {
    sameOrigin(request);
    const user = await requireCoach(request);
    await limit(user.id, true);
    const { org, team, book: id } = await ids(context);
    const body = await readJson(request, MAX_RECORD_BYTES + 4096);
    const raw = isRecord(body) ? body : {};
    const book = normalizePlaybook(raw.book, id);
    if (!book) throw new OrgError(400, "That isn't a playbook.");
    return Response.json(await writeBook(user, org, team, { ...book, id }, new Date(changeTime(raw.at))), { headers: orgHeaders });
  } catch (error) { return orgFailure(error); }
}

export async function DELETE(request: Request, context: Context) {
  try {
    sameOrigin(request);
    const user = await requireCoach(request);
    await limit(user.id, true);
    const { org, team, book } = await ids(context);
    const at = new Date(changeTime(new URL(request.url).searchParams.get("at")));
    return Response.json(await deleteBook(user, org, team, book, at), { headers: orgHeaders });
  } catch (error) { return orgFailure(error); }
}
