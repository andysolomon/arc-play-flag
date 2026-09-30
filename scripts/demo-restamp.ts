#!/usr/bin/env bun
/**
 * Moves components/demo/recorded-from.json on to the UI as it is now, without re-recording, for a
 * change no clip shows. It needs a reason, and keeps it with the files it waved through, so
 * the reviewer sees both in the diff. Anything a clip does show means re-recording instead:
 * see "Keeping the clips current" in DEMO_WORKFLOW.md.
 *
 *   bun run demo:restamp --reason "only the print stylesheet changed; no clip prints"
 */
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fingerprint, restamp, STAMP_FILE, STAMP_PATH } from "./demo-recorder/freshness";

const CHECKOUT = resolve(import.meta.dir, "..");
const STAMP = join(CHECKOUT, STAMP_PATH);

export async function main(args = process.argv.slice(2)): Promise<number> {
  const at = args.indexOf("--reason");
  const reason = at >= 0 ? args[at + 1] ?? "" : "";
  if (args.length !== 2 || at !== 0 || reason.startsWith("--")) {
    console.error('Usage: bun run demo:restamp --reason "<why the clips still match the UI>"');
    return 2;
  }
  const recorded = await readFile(STAMP, "utf8").catch(() => null);
  const next = restamp(recorded, await fingerprint(CHECKOUT), reason);
  await writeFile(STAMP, `${JSON.stringify(next, null, 2)}\n`);
  console.log(`Restamped ${STAMP_FILE} without re-recording: ${next.restamped?.files.join(", ") ?? ""}`);
  return 0;
}

if (import.meta.main) {
  main().then(
    (code) => { process.exitCode = code; },
    (error: unknown) => {
      console.error(`Demo restamp refused: ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
    },
  );
}
