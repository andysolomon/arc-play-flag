import { afterEach, describe, expect, test } from "bun:test";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEMOS } from "../../components/demo/demos";
import { CHAPTERS } from "./chapters";
import { BLANK_DRAFT, CHAPTER_PLAY, DEMO_PLAYBOOK, DEMO_PLAYS, FORMATIONS, STORAGE_KEYS, storageFor, TWINS_SLANT } from "./fixtures";
import { CHAPTER_SLUGS, DEFAULT_BASE_URL, UsageError, outputNames, parseArgs, selectedChapters } from "./options";
import { DEFAULT_FPS, MAX_SET_BYTES } from "./media";
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
    const one = parseArgs(["--chapter", "run-game", "--output-dir", "captures"], "/work");
    expect(one).not.toBe("help");
    if (one === "help") return;
    expect(one.outputDir).toBe("/work/captures");
    expect(one.baseUrl).toBe(DEFAULT_BASE_URL);
    expect(one).toMatchObject({ dryRun: false, force: false, headed: false, keepRaw: false, contactSheets: false, trace: false });
    expect(selectedChapters(one.chapter)).toEqual(["run-game"]);
    expect(selectedChapters("all")).toEqual(CHAPTER_SLUGS);
  });

  test("names the delivery set first and opted-in extras after it", () => {
    expect(outputNames("run-game")).toEqual(["run-game.webm", "run-game.mp4", "run-game.webp"]);
    expect(outputNames("run-game", { keepRaw: true, contactSheets: true })).toEqual([
      "run-game.webm", "run-game.mp4", "run-game.webp", "run-game.raw.webm", "run-game.sheet.png", "run-game.sheet-390.png",
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

  test("encoding cuts the lead-in, then trims normalized source timestamps to fixed manifest durations at the chapter's frame rate", () => {
    expect(CHAPTER_SLUGS.map((slug) => chapterVideoFilter(slug))).toEqual(
      CHAPTER_SLUGS.map((slug) => `trim=start=0.000:duration=${CHAPTERS[slug].targetSeconds.toFixed(3)},setpts=PTS-STARTPTS,fps=${String(CHAPTERS[slug].fps ?? DEFAULT_FPS)},scale=576:720:flags=lanczos`),
    );
    expect(chapterVideoFilter("run-game", 1.2345)).toBe("trim=start=1.234:duration=12.000,setpts=PTS-STARTPTS,fps=12,scale=576:720:flags=lanczos");
    // a lead-in cannot be negative: the clock never starts before the video
    expect(chapterVideoFilter("roster", -0.5)).toContain("trim=start=0.000");
  });

  test("fixtures are fictional, stable, and seed only the app's own storage keys", () => {
    expect(DEMO_PLAYS.map((play) => play.id)).toEqual([
      "demo-twins-slant", "demo-pistol-dive", "demo-jet-sweep", "demo-jet-fake", "demo-cover-one", "demo-bunch-corner",
      "demo-goal-to-go", "demo-split-wheel", "demo-halfback-pass", "demo-stack-fade",
    ]);
    expect(DEMO_PLAYS.every((play) => play.name.startsWith("Otter "))).toBe(true);
    expect(Object.values(STORAGE_KEYS).sort()).toEqual(["ffpd.draft.v1", "ffpd.first-use.v1", "ffpd.lineups.v1", "ffpd.los.v1", "ffpd.playbooks.v1", "ffpd.plays.v2", "ffpd.team.v1"]);
    for (const slug of CHAPTER_SLUGS) {
      const storage = storageFor(slug);
      // the board's spot is seeded only for a chapter whose play is spotted off the 40 (ADR 014)
      const draftLos = (JSON.parse(storage[STORAGE_KEYS.draft] ?? "") as { los?: number }).los;
      const expectedKeys = Object.values(STORAGE_KEYS).filter((k) => k !== STORAGE_KEYS.los || draftLos !== undefined).sort();
      expect(Object.keys(storage).sort()).toEqual(expectedKeys);
      if (draftLos !== undefined) expect(storage[STORAGE_KEYS.los]).toBe(String(draftLos));
      expect(storage[STORAGE_KEYS.firstUse]).toBe("done");
      expect(JSON.parse(storage[STORAGE_KEYS.team] ?? "")).toEqual({ name: "Riverside Otters", color: "#2a9d8f" });
      const draft = JSON.parse(storage[STORAGE_KEYS.draft] ?? "") as { id: string | null; name: string };
      const opened = CHAPTER_PLAY[slug];
      if (opened) {
        expect(draft.id).toBe(opened.id);
        expect(draft.name).toBe(opened.name);
      }
    }
    // the share chapter saves the hero's play for the first time: unsaved on the board, and not in the library yet
    const share = storageFor("share");
    expect(JSON.parse(share[STORAGE_KEYS.draft] ?? "")).toMatchObject({ id: null, name: TWINS_SLANT.name });
    expect(JSON.parse(share[STORAGE_KEYS.plays] ?? "")).not.toHaveProperty(TWINS_SLANT.id);
    expect(JSON.parse(storageFor("game-day")[STORAGE_KEYS.plays] ?? "")).toHaveProperty(`${TWINS_SLANT.id}.name`, TWINS_SLANT.name);
    expect(BLANK_DRAFT.players.every((player) => player.route === null)).toBe(true);
    // every play in the book stands in a formation of its own, so no two thumbnails or wristband cells look alike;
    // the one pair that shares a look is the point of the run-game chapter (the jet sweep and the jet fake off it)
    const looks = DEMO_PLAYBOOK.plays.map((id) => JSON.stringify(DEMO_PLAYS.find((play) => play.id === id)?.players.filter((p) => p.team === "offense").map((p) => [p.x, p.y])));
    expect(new Set(looks).size).toBe(DEMO_PLAYBOOK.plays.length - 1);
    expect(Object.keys(FORMATIONS).length).toBeGreaterThanOrEqual(7);
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
    await prepareOutputDirectory(base, ["run-game"]);
    await writeFile(join(outputDir, "run-game.webm"), "existing");
    await writeFile(join(outputDir, "run-game.sheet.png"), "existing");
    let collision: unknown;
    try {
      await prepareOutputDirectory(base, ["run-game"]);
    } catch (error) { collision = error; }
    expect(collision).toBeInstanceOf(Error);
    expect((collision as Error).message).toBe("refusing to replace existing output: run-game.webm (pass --force to replace)");
    // a whole set's own files collide too, and only when the run writes them
    await writeFile(join(outputDir, "recorded-from.json"), "{}");
    expect(await rejection(prepareOutputDirectory(base, ["game-day"]))).toBeNull();
    expect(await rejection(prepareOutputDirectory(base, ["game-day"], ["recorded-from.json"]))).toContain("recorded-from.json");
    // extras only collide when they were asked for
    expect(await rejection(prepareOutputDirectory({ ...base, contactSheets: true }, ["game-day"]))).toBeNull();
    expect(await rejection(prepareOutputDirectory({ ...base, contactSheets: true }, ["run-game"]))).toContain("run-game.webm, run-game.sheet.png");
    expect(await rejection(prepareOutputDirectory({ ...base, force: true }, ["run-game"]))).toBeNull();
    // a file where the directory should be is an error, not a place to write into
    await writeFile(join(root, "not-a-directory"), "x");
    expect(await rejection(prepareOutputDirectory({ ...base, outputDir: join(root, "not-a-directory") }, ["run-game"]))).toMatch(/not a directory|ENOTDIR|EEXIST/);
  });

  test("checks the committed set against the delivery budget and reports a missing file", async () => {
    const committed = join(import.meta.dir, "../../public/demos");
    const bytes = await verifyOutputSet(committed, CHAPTER_SLUGS);
    expect(bytes).toBeGreaterThan(1_000);
    expect(bytes).toBeLessThan(MAX_SET_BYTES);
    const empty = await mkdtemp(join(tmpdir(), "arc-demo-empty-"));
    temporary.push(empty);
    expect(await rejection(verifyOutputSet(empty, ["run-game"]))).toMatch(/ENOENT.*run-game\.webm/);
  });
});
