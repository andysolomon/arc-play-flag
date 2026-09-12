import { afterEach, describe, expect, test } from "bun:test";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEMOS } from "../../components/demo/demos";
import { CHAPTERS } from "./chapters";
import { BLANK_DRAFT, CHAPTER_PLAY, DEMO_PLAYS, QUICK_SLANT, STORAGE_KEYS, storageFor } from "./fixtures";
import { CHAPTER_SLUGS, DEFAULT_BASE_URL, UsageError, outputNames, parseArgs, selectedChapters } from "./options";
import { MAX_SET_BYTES } from "./media";
import { chapterVideoFilter, dryRunProfileCheck, prepareOutputDirectory, usingDisposableDirectory, verifyOutputSet } from "./runtime";

const temporary: string[] = [];
afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function expectMissing(path: string): Promise<void> {
  let missing = false;
  try { await access(path); } catch { missing = true; }
  expect(missing).toBe(true);
}

/** The message a promise rejects with, or null when it resolves. */
async function rejection(promise: Promise<unknown>): Promise<string | null> {
  try { await promise; return null; } catch (error) { return error instanceof Error ? error.message : String(error); }
}

describe("Demo recorder arguments", () => {
  test("requires a chapter and an explicit output directory", () => {
    expect(() => parseArgs([])).toThrow(new UsageError("--chapter is required"));
    expect(() => parseArgs(["--chapter", "all"])).toThrow(new UsageError("--output-dir is required"));
    expect(() => parseArgs(["--chapter", "unknown", "--output-dir", "out"])).toThrow("unknown chapter: unknown");
    expect(() => parseArgs(["--chapter", "all", "--output-dir"])).toThrow("--output-dir requires a value");
    expect(parseArgs(["--help"])).toBe("help");
  });

  test("selects one chapter or every stable chapter slug", () => {
    const one = parseArgs(["--chapter", "run-play", "--output-dir", "captures"], "/work");
    expect(one).not.toBe("help");
    if (one === "help") return;
    expect(one.outputDir).toBe("/work/captures");
    expect(one.baseUrl).toBe(DEFAULT_BASE_URL);
    expect(one).toMatchObject({ dryRun: false, force: false, headed: false, keepRaw: false, contactSheets: false, trace: false });
    expect(selectedChapters(one.chapter)).toEqual(["run-play"]);
    expect(selectedChapters("all")).toEqual(CHAPTER_SLUGS);
  });

  test("names the delivery set first and opted-in extras after it", () => {
    expect(outputNames("run-play")).toEqual(["run-play.webm", "run-play.mp4", "run-play.webp"]);
    expect(outputNames("run-play", { keepRaw: true, contactSheets: true })).toEqual([
      "run-play.webm", "run-play.mp4", "run-play.webp", "run-play.raw.webm", "run-play.sheet.png", "run-play.sheet-390.png",
    ]);
    const flags = parseArgs(["--chapter", "all", "--output-dir", "o", "--force", "--keep-raw", "--contact-sheets", "--trace", "--dry-run", "--base-url", "http://localhost:3777/"]);
    expect(flags).toMatchObject({ force: true, keepRaw: true, contactSheets: true, trace: true, dryRun: true, baseUrl: "http://localhost:3777" });
  });

  test("rejects unknown flags and non-http app URLs", () => {
    expect(() => parseArgs(["--wat"])).toThrow("unknown argument: --wat");
    expect(() => parseArgs(["--chapter", "all", "--output-dir", "out", "--base-url", "file:///tmp/app"])).toThrow("must use http or https");
    expect(() => parseArgs(["--chapter", "all", "--output-dir", "out", "--base-url", "nope"])).toThrow("invalid --base-url: nope");
  });
});

describe("Demo recorder chapters and fixtures", () => {
  test("chapters match the tour manifest slug for slug, in order, with the promised length", () => {
    expect(Object.keys(CHAPTERS)).toEqual(DEMOS.map((demo) => demo.slug));
    expect(DEMOS.map((demo) => demo.slug)).toEqual([...CHAPTER_SLUGS]);
    expect(Object.values(CHAPTERS).map((chapter) => `${String(chapter.targetSeconds)} sec`)).toEqual(DEMOS.map((demo) => demo.time));
  });

  test("encoding trims normalized source timestamps to fixed manifest durations", () => {
    expect(CHAPTER_SLUGS.map(chapterVideoFilter)).toEqual(
      [9, 9, 11, 11, 8, 10, 8, 9].map((seconds) => `trim=start=0:duration=${seconds.toFixed(3)},setpts=PTS-STARTPTS,fps=8,scale=960:540:flags=lanczos`),
    );
  });

  test("fixtures are fictional, stable, and seed only the app's own storage keys", () => {
    expect(DEMO_PLAYS.map((play) => play.id)).toEqual(["demo-slant", "demo-handoff", "demo-play-action", "demo-defense"]);
    expect(DEMO_PLAYS.every((play) => play.name.startsWith("Otter "))).toBe(true);
    expect(Object.values(STORAGE_KEYS).sort()).toEqual(["ffpd.draft.v1", "ffpd.first-use.v1", "ffpd.playbooks.v1", "ffpd.plays.v2", "ffpd.team.v1"]);
    for (const slug of CHAPTER_SLUGS) {
      const storage = storageFor(slug);
      expect(Object.keys(storage).sort()).toEqual(Object.values(STORAGE_KEYS).sort());
      expect(storage[STORAGE_KEYS.firstUse]).toBe("done");
      // `playbooks` types the team name on camera, so only that chapter starts without one
      expect(JSON.parse(storage[STORAGE_KEYS.team] ?? "")).toEqual({ name: slug === "playbooks" ? "" : "Riverside Otters", color: "#2a9d8f" });
      const draft = JSON.parse(storage[STORAGE_KEYS.draft] ?? "") as { id: string | null; name: string };
      const opened = CHAPTER_PLAY[slug] ?? (slug === "custom-routes" ? QUICK_SLANT : undefined);
      expect(draft.id).toBe(opened ? opened.id : null);
      expect(draft.name).toBe(opened ? opened.name : "");
    }
    expect(BLANK_DRAFT.players.every((player) => player.route === null)).toBe(true);
    expect(JSON.parse(storageFor("build-play")[STORAGE_KEYS.plays] ?? "")).toHaveProperty("demo-slant.name", "Otter Quick Slant");
  });
});

describe("Demo recorder isolation", () => {
  test("removes a disposable profile after success and failure", async () => {
    let successful = "";
    await usingDisposableDirectory("arc-demo-test-", async (directory) => {
      successful = directory;
      await writeFile(join(directory, "marker"), "fictional\n");
    });
    await expectMissing(successful);

    let failed = "";
    let failure: unknown;
    try {
      await usingDisposableDirectory("arc-demo-test-", (directory) => {
        failed = directory;
        return Promise.reject(new Error("deliberate beat failure"));
      });
    } catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toBe("deliberate beat failure");
    await expectMissing(failed);

    const dryRun = await dryRunProfileCheck();
    expect(dryRun).toContain("arc-demo-profile-");
    await expectMissing(dryRun);
  });

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

  test("checks the committed set against the delivery budget and reports a missing file", async () => {
    const committed = join(import.meta.dir, "../../public/demos");
    const bytes = await verifyOutputSet(committed, CHAPTER_SLUGS);
    expect(bytes).toBeGreaterThan(1_000);
    expect(bytes).toBeLessThan(MAX_SET_BYTES);
    const empty = await mkdtemp(join(tmpdir(), "arc-demo-empty-"));
    temporary.push(empty);
    expect(await rejection(verifyOutputSet(empty, ["run-play"]))).toMatch(/ENOENT.*run-play\.webm/);
  });
});
