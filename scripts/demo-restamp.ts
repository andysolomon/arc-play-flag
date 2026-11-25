#!/usr/bin/env bun
/**
 * Moves components/demo/recorded-from.json on to the UI as it is now, without re-recording, but
 * only when no clip shows the change: it builds this checkout, serves it on a free port, takes every
 * chapter again and compares each take with its published clip (./demo-recorder/compare.ts). If any
 * take differs it writes nothing and leaves the frames that differ in test-results/demo-restamp/;
 * re-record instead (DEMO_WORKFLOW.md). The reason is kept with the comparison, as a record.
 *
 *   bun run demo:restamp --reason "only the print stylesheet changed"
 */
import { spawn } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import { ChapterBeatError, CHAPTERS } from "./demo-recorder/chapters";
import { compareClips, decodeFrames, differs, sideBySide, TOLERANCE, type ClipComparison } from "./demo-recorder/compare";
import { drift, fingerprint, publishedClips, restamp, restampDrift, STAMP_FILE, STAMP_PATH, type Compared } from "./demo-recorder/freshness";
import { DEFAULT_FPS } from "./demo-recorder/media";
import { CHAPTER_SLUGS, type ChapterSlug, type RecorderOptions } from "./demo-recorder/options";
import { chapterVideoFilter, rawCapture, validateTools, warmUp } from "./demo-recorder/runtime";

const CHECKOUT = resolve(import.meta.dir, "..");
const STAMP = join(CHECKOUT, STAMP_PATH);
const EVIDENCE = join(CHECKOUT, "test-results/demo-restamp");

function run(command: string, args: readonly string[]): Promise<void> {
  return new Promise((done, fail) => {
    const child = spawn(command, args, { cwd: CHECKOUT, stdio: ["ignore", 2, 2] });
    child.on("error", fail);
    child.on("close", (code) => { if (code === 0) done(); else fail(new Error(`${command} ${args.join(" ")} exited ${String(code)}`)); });
  });
}

async function freePort(): Promise<number> {
  return new Promise((done, fail) => {
    const server = createServer();
    server.on("error", fail);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => { if (address && typeof address === "object") done(address.port); else fail(new Error("no free port")); });
    });
  });
}

/** Serves this checkout's production build on a port no other checkout's server holds. */
async function serve(): Promise<{ baseUrl: string; stop: () => void }> {
  const port = String(await freePort());
  const child = spawn(join(CHECKOUT, "node_modules/.bin/next"), ["start", "--hostname", "127.0.0.1", "-p", port], { cwd: CHECKOUT, stdio: ["ignore", "ignore", 2] });
  let exited = false;
  child.on("exit", () => { exited = true; });
  const baseUrl = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline && !exited) {
    if (await fetch(baseUrl).then((response) => response.ok, () => false)) return { baseUrl, stop: () => { child.kill("SIGTERM"); } };
    await new Promise((wait) => setTimeout(wait, 250));
  }
  child.kill("SIGTERM");
  throw new Error(`the production build did not answer at ${baseUrl}`);
}

const TAKES = 3;

/**
 * Takes a chapter until a take matches the published clip. A loaded machine stretches a take, and
 * can put a toast over a different beat, so a take can differ when the UI has not; but no take of
 * a UI that changed on screen can match. So one matching take is enough, and a chapter differs only
 * when every take does. A control a chapter cannot find or a state it cannot reach throws: that
 * chapter cannot be played on this UI at all.
 */
async function takeAndCompare(slug: ChapterSlug, options: RecorderOptions): Promise<ClipComparison> {
  const clip = join(CHECKOUT, "public/demos", `${slug}.webm`);
  const published = await decodeFrames(clip);
  let worst: ClipComparison | null = null;
  const misses: string[] = [];
  for (let take = 1; take <= TAKES; take += 1) {
    let capture;
    try {
      capture = await rawCapture(slug, options, false);
    } catch (error) {
      if (!(error instanceof ChapterBeatError) || error.kind !== "recording") throw error;
      misses.push(error.message);
      continue;
    }
    try {
      const filter = chapterVideoFilter(slug, capture.run.leadIn, Math.max(CHAPTERS[slug].targetSeconds, capture.run.seconds));
      const comparison = compareClips(await decodeFrames(capture.rawPath, filter), published, CHAPTERS[slug].fps ?? DEFAULT_FPS);
      if (!differs(comparison)) return comparison;
      if (!worst || comparison.worst > worst.worst) {
        worst = comparison;
        await sideBySide({ path: capture.rawPath, filter, frame: comparison.takeFrame }, { path: clip, frame: comparison.publishedFrame }, comparison, join(EVIDENCE, `${slug}.png`));
      }
    } finally {
      await rm(capture.rawPath, { force: true });
    }
  }
  if (worst) return worst;
  throw new Error(`no take of ${slug} finished in ${String(TAKES)} tries (${misses.join("; ")})`);
}

export async function main(args = process.argv.slice(2)): Promise<number> {
  const at = args.indexOf("--reason");
  const reason = at >= 0 ? args[at + 1] ?? "" : "";
  if (args.length !== 2 || at !== 0 || reason.startsWith("--") || !reason.trim()) {
    console.error('Usage: bun run demo:restamp --reason "<what changed>"');
    return 2;
  }
  const recorded = await readFile(STAMP, "utf8").catch(() => null);
  const ui = await fingerprint(CHECKOUT);
  const files = restampDrift(recorded, ui);
  console.log(`Comparing every chapter with its published clip for ${files.join(", ")}`);

  for (const line of await validateTools()) console.log(`Using ${line}`);
  await run("bun", ["run", "build"]);
  await rm(EVIDENCE, { recursive: true, force: true });
  await mkdir(EVIDENCE, { recursive: true });
  const published = await publishedClips(CHECKOUT);
  const clips: Record<string, { webm: string; worst: number }> = {};
  const differing: string[] = [];
  const server = await serve();
  try {
    await warmUp(server.baseUrl);
    const options: RecorderOptions = {
      chapter: "all", outputDir: EVIDENCE, baseUrl: server.baseUrl,
      dryRun: false, force: true, headed: false, keepRaw: false, contactSheets: false, trace: false,
    };
    for (const slug of CHAPTER_SLUGS) {
      const comparison = await takeAndCompare(slug, options);
      clips[slug] = { webm: published[slug] ?? "", worst: Number(comparison.worst.toFixed(3)) };
      const held = `${(comparison.worst * 100).toFixed(1)}% of a block held ${String(TOLERANCE.seconds)}s`;
      if (differs(comparison)) differing.push(slug);
      console.log(differs(comparison) ? `${slug}: DIFFERS, ${held} (take | published | difference: ${join(EVIDENCE, `${slug}.png`)})` : `${slug}: matches, ${held}`);
    }
  } finally {
    server.stop();
  }

  const moved = drift(ui, await fingerprint(CHECKOUT));
  if (moved.length) throw new Error(`the UI changed while the chapters were taken (${moved.join(", ")}); run it again`);
  if (differing.length) {
    console.error(`Demo restamp refused: ${differing.join(", ")} no longer show${differing.length === 1 ? "s" : ""} this UI (more than ${String(TOLERANCE.blockShare * 100)}% of a block stayed different for ${String(TOLERANCE.seconds)}s). Re-record the tour (DEMO_WORKFLOW.md); the frames are in ${EVIDENCE}.`);
    return 1;
  }
  const compared: Compared = { tolerance: TOLERANCE, clips };
  await writeFile(STAMP, `${JSON.stringify(restamp(recorded, ui, reason, compared), null, 2)}\n`);
  console.log(`Restamped ${STAMP_FILE}: every take matched its published clip`);
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
