import { importMessage } from "@/lib/export/playbook-file";
import { readTransfer } from "@/lib/export/transfer";
import { boundedBody, sameOrigin, shareFailure, shareHeaders } from "@/lib/sharing/http";
import { createSnapshot, limit, ShareError } from "@/lib/sharing/store";

export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    await limit(request, true);
    const read = readTransfer(await boundedBody(request));
    if (!read.ok) throw new ShareError(400, importMessage(read.error));
    if (read.skipped || read.normalized) throw new ShareError(400, "This snapshot needs repair. Import and review it before sharing.");
    const { file } = read;
    if (file.kind === "ffpd.playbook" && (file.plays.length !== file.playbook.plays.length || new Set(file.playbook.plays).size !== file.plays.length)) throw new ShareError(400, "The playbook has missing or unrelated plays.");
    const created = await createSnapshot(JSON.stringify(file));
    return Response.json(created, { status: 201, headers: shareHeaders });
  } catch (error) { return shareFailure(error); }
}
