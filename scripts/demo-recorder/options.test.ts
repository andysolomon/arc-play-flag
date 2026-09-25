import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prepareOutputDirectory } from "./runtime";

const temporary: string[] = [];
afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

/** The message a promise rejects with, or null when it resolves. */
async function rejection(promise: Promise<unknown>): Promise<string | null> {
  try { await promise; return null; } catch (error) { return error instanceof Error ? error.message : String(error); }
}

describe("Demo recorder isolation", () => {
  test("prepares only the explicit output and refuses replacement without --force", async () => {
    const root = await mkdtemp(join(tmpdir(), "arc-demo-output-test-"));
    temporary.push(root);
    const outputDir = join(root, "chosen", "captures");
    const base = { outputDir, force: false, keepRaw: false, contactSheets: false };
    await prepareOutputDirectory(base, ["run-play"]);
    await writeFile(join(outputDir, "run-play.webm"), "existing");
    await writeFile(join(outputDir, "run-play.sheet.png"), "existing");
    let collision: unknown;
    try {
      await prepareOutputDirectory(base, ["run-play"]);
    } catch (error) { collision = error; }
    expect(collision).toBeInstanceOf(Error);
    expect((collision as Error).message).toBe("refusing to replace existing output: run-play.webm (pass --force to replace)");
    // extras only collide when they were asked for
    expect(await rejection(prepareOutputDirectory({ ...base, contactSheets: true }, ["playbooks"]))).toBeNull();
    expect(await rejection(prepareOutputDirectory({ ...base, contactSheets: true }, ["run-play"]))).toContain("run-play.webm, run-play.sheet.png");
    expect(await rejection(prepareOutputDirectory({ ...base, force: true }, ["run-play"]))).toBeNull();
    // a file where the directory should be is an error, not a place to write into
    await writeFile(join(root, "not-a-directory"), "x");
    expect(await rejection(prepareOutputDirectory({ ...base, outputDir: join(root, "not-a-directory") }, ["run-play"]))).toMatch(/not a directory|ENOTDIR|EEXIST/);
  });
});
