import { readJson } from "@/lib/account/http";
import { MAX_TEAM_BYTES } from "@/lib/account/data";
import { limit, TEAM_ID } from "@/lib/account/store";
import { normalizePlaybook, normalizeSavedPlay } from "@/lib/play/storage";
import type { Playbook, SavedPlay } from "@/lib/play/types";
import { NOT_A_TEAM, NOT_YOURS, OrgError, checkedId, isRecord, orgFailure, orgHeaders, requireCoach, sameOrigin } from "@/lib/org/http";
import { copyInto } from "@/lib/org/teams";

export const runtime = "nodejs";
type Context = { params: Promise<{ org: string; id: string }> };

/** Copies plays and books into the team (`{ plays, playbooks, from? }`, `from` the team they came from); head coaches and assistants. */
export async function POST(request: Request, context: Context) {
  try {
    sameOrigin(request);
    const user = await requireCoach(request);
    await limit(user.id, true);
    const { org, id } = await context.params;
    const body = await readJson(request, MAX_TEAM_BYTES + 4096);
    const raw = isRecord(body) ? body : {};
    const plays: SavedPlay[] = [];
    const seen = new Set<string>();
    for (const v of Array.isArray(raw.plays) ? raw.plays : []) {
      const p = normalizeSavedPlay(v);
      if (p && !seen.has(p.id)) { seen.add(p.id); plays.push(p); }
    }
    const books: Playbook[] = [];
    for (const v of Array.isArray(raw.playbooks) ? raw.playbooks : []) {
      const b = normalizePlaybook(v);
      if (b) books.push(b);
    }
    if (!plays.length && !books.length) throw new OrgError(400, "Nothing to copy.");
    const from = typeof raw.from === "string" && TEAM_ID.test(raw.from) ? raw.from : null;
    return Response.json(await copyInto(user, checkedId(org, NOT_YOURS), checkedId(id, NOT_A_TEAM), plays, books, from), { status: 201, headers: orgHeaders });
  } catch (error) { return orgFailure(error); }
}
