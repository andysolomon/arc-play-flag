import { sameOrigin, shareFailure, shareHeaders } from "@/lib/sharing/http";
import { TOKEN_PATTERN } from "@/lib/sharing/links";
import { limit, readSnapshot, revokeSnapshot, ShareError } from "@/lib/sharing/store";

export const runtime = "nodejs";
type Context = { params: Promise<{ token: string }> };
async function checkedToken(context: Context): Promise<string> {
  const { token } = await context.params;
  if (!TOKEN_PATTERN.test(token)) throw new ShareError(404, "This share link is invalid.");
  return token;
}
export async function GET(request: Request, context: Context) {
  try {
    const token = await checkedToken(context);
    await limit(request, false);
    return new Response(await readSnapshot(token), { headers: { ...shareHeaders, "Content-Type": "application/json" } });
  } catch (error) { return shareFailure(error); }
}
export async function DELETE(request: Request, context: Context) {
  try {
    sameOrigin(request);
    const token = await checkedToken(context);
    const key = request.headers.get("authorization")?.replace(/^Bearer /, "");
    if (!key || !/^[A-Za-z0-9_-]{32}$/.test(key)) throw new ShareError(403, "Only the creator can revoke this link.");
    await limit(request, true);
    await revokeSnapshot(token, key);
    return new Response(null, { status: 204, headers: shareHeaders });
  } catch (error) { return shareFailure(error); }
}
