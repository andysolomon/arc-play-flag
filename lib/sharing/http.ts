import { MAX_FILE_BYTES } from "@/lib/export/playbook-file";
import { ShareError } from "./store";

export const shareHeaders = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow", "Referrer-Policy": "no-referrer" };
export function shareFailure(error: unknown): Response {
  return Response.json({ error: error instanceof ShareError ? error.message : "Link sharing is temporarily unavailable. Try again." }, { status: error instanceof ShareError ? error.status : 503, headers: shareHeaders });
}
export function sameOrigin(request: Request): void {
  if (request.headers.get("origin") !== new URL(request.url).origin) throw new ShareError(403, "Open the app to manage a share link.");
}
/** Bound the stream itself, including requests without Content-Length. */
export async function boundedBody(request: Request): Promise<string> {
  if (!request.headers.get("content-type")?.startsWith("application/json")) throw new ShareError(415, "Expected a playbook JSON snapshot.");
  if (Number(request.headers.get("content-length")) > MAX_FILE_BYTES) throw new ShareError(413, "That playbook is too large.");
  const reader = request.body?.getReader();
  if (!reader) throw new ShareError(400, "The playbook is empty.");
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_FILE_BYTES) { await reader.cancel(); throw new ShareError(413, "That playbook is too large."); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks).toString("utf8");
}
