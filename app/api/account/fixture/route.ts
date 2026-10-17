import { accountFailure, accountHeaders, readJson, sameOrigin } from "@/lib/account/http";
import { FIXTURE_COOKIE, accountMode, fixtureSession } from "@/lib/account/session";
import { AccountError } from "@/lib/account/store";

export const runtime = "nodejs";
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

/** The journeys' sign-in: a fictional coach in a run, kept in a cookie. 404 unless the fixture is on (never on Vercel). */
export async function POST(request: Request) {
  try {
    if (accountMode() !== "fixture") throw new AccountError(404, "Not found.");
    sameOrigin(request);
    const body = await readJson(request, 4096);
    const session = isRecord(body) ? fixtureSession(body.coach, body.run) : null;
    if (!session) throw new AccountError(400, "Pick a coach.");
    return new Response(null, {
      status: 204,
      headers: { ...accountHeaders, "Set-Cookie": `${FIXTURE_COOKIE}=${session}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400` },
    });
  } catch (error) { return accountFailure(error); }
}

export function DELETE(request: Request) {
  try {
    if (accountMode() !== "fixture") throw new AccountError(404, "Not found.");
    sameOrigin(request);
    return new Response(null, { status: 204, headers: { ...accountHeaders, "Set-Cookie": `${FIXTURE_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0` } });
  } catch (error) { return accountFailure(error); }
}
