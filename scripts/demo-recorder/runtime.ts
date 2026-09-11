import { spawn } from "node:child_process";
import { access, copyFile, mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { chromium } from "@playwright/test";
import { CHAPTERS, ChapterBeatError, recordChapterActions, type ChapterRun } from "./chapters";
import { storageFor } from "./fixtures";
import { deliveryProblems, parseProbe, setProblem, VIDEO_SIZE, type DeliveryKind } from "./media";
import { outputNames, type ChapterSlug, type RecorderOptions } from "./options";

/** Runs a task inside a directory that is always removed afterwards, whatever the task does. */
export async function usingDisposableDirectory<T>(prefix: string, task: (directory: string) => Promise<T>): Promise<T> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  try {
    return await task(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function command(command: string, args: readonly string[], label: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => { stderr += chunk; });
    child.on("error", (error) => { reject(new Error(`${label}: could not start ${command}: ${error.message}`)); });
    child.on("close", (code) => {
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(`${label}: ${command} exited ${String(code)}: ${(stderr || stdout).trim().slice(-1_200)}`));
    });
  });
}

export async function prepareOutputDirectory(options: Pick<RecorderOptions, "outputDir" | "force" | "keepRaw" | "contactSheets">, slugs: readonly ChapterSlug[]): Promise<void> {
  await mkdir(options.outputDir, { recursive: true });
  const info = await stat(options.outputDir);
  if (!info.isDirectory()) throw new Error(`output path is not a directory: ${options.outputDir}`);

  const probe = join(options.outputDir, `.demo-recorder-write-${String(process.pid)}`);
  try {
    await writeFile(probe, "development-only output probe\n", { flag: "wx" });
  } catch (error) {
    throw new Error(`output directory is not writable: ${options.outputDir}`, { cause: error });
  } finally {
    await rm(probe, { force: true });
  }

  if (options.force) return;
  const collisions: string[] = [];
  for (const slug of slugs) {
    for (const name of outputNames(slug, options)) {
      try { await access(join(options.outputDir, name)); collisions.push(name); } catch { /* absent */ }
    }
  }
  if (collisions.length) {
    throw new Error(`refusing to replace existing output: ${collisions.join(", ")} (pass --force to replace)`);
  }
}

const REQUIRED_ENCODERS = ["libvpx-vp9", "libx264", "libwebp"] as const;

/** Confirms the encoders and the locked Chromium are present, and reports the versions used. */
export async function validateTools(): Promise<string[]> {
  const ffmpeg = (await command("ffmpeg", ["-version"], "recording tool check")).split("\n")[0] ?? "ffmpeg";
  const ffprobe = (await command("ffprobe", ["-version"], "recording tool check")).split("\n")[0] ?? "ffprobe";
  const encoders = await command("ffmpeg", ["-hide_banner", "-encoders"], "recording tool check");
  const missing = REQUIRED_ENCODERS.filter((name) => !encoders.includes(` ${name} `));
  if (missing.length) throw new Error(`recording tool check: ffmpeg is built without ${missing.join(", ")}`);
  const executable = chromium.executablePath();
  try {
    await access(executable);
  } catch (error) {
    throw new Error("recording tool check: Playwright Chromium is missing; run `bun run demo:setup`", { cause: error });
  }
  const { version } = JSON.parse(await readFile(new URL("../../node_modules/@playwright/test/package.json", import.meta.url), "utf8")) as { version: string };
  return [ffmpeg, ffprobe, `@playwright/test ${version}`, `chromium ${executable}`];
}

interface RawCapture {
  rawPath: string;
  run: ChapterRun;
}

/**
 * Records one chapter in a brand-new Chromium profile that only ever holds the fictional
 * fixtures. The profile and Playwright's video directory are removed on every exit path;
 * the raw capture is copied out to a held temporary file for encoding.
 */
async function rawCapture(slug: ChapterSlug, options: RecorderOptions): Promise<RawCapture> {
  return usingDisposableDirectory("arc-demo-profile-", async (profileDir) => usingDisposableDirectory("arc-demo-video-", async (videoDir) => {
    // the video starts with the browser, so the chapter clock starts before the launch
    const startedAt = Date.now();
    const context = await chromium.launchPersistentContext(profileDir, {
      headless: !options.headed,
      viewport: VIDEO_SIZE,
      deviceScaleFactor: 1,
      recordVideo: { dir: videoDir, size: VIDEO_SIZE },
      colorScheme: "light",
      // drawers and tiles snap instead of sliding: steadier frames and smaller files at 8 fps
      reducedMotion: "reduce",
      locale: "en-US",
      timezoneId: "UTC",
      acceptDownloads: true,
    });
    let closed = false;
    const close = async () => {
      if (closed) return;
      closed = true;
      await context.close();
    };
    try {
      await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: new URL(options.baseUrl).origin });
      await context.addInitScript((entries: ReadonlyArray<readonly [string, string]>) => {
        try {
          if (sessionStorage.getItem("arc-demo-fixtures-seeded") === "yes") return;
          localStorage.clear();
          for (const [key, value] of entries) localStorage.setItem(key, value);
          sessionStorage.setItem("arc-demo-fixtures-seeded", "yes");
        } catch {
          // about:blank has no storage origin; the same script runs again on the app URL
        }
      }, Object.entries(storageFor(slug)));
      const page = context.pages()[0] ?? await context.newPage();
      const video = page.video();
      if (!video) throw new Error("Playwright did not create a video for the page");

      let run: ChapterRun;
      try {
        run = await recordChapterActions(slug, page, options.baseUrl, startedAt, options.trace ? (line) => { console.error(line); } : undefined);
      } catch (error) {
        // a screenshot of the failed beat is the most useful thing to leave behind
        const shot = join(options.outputDir, `${slug}.failure.png`);
        const saved = await page.screenshot({ path: shot }).then(() => true, () => false);
        await close();
        if (error instanceof ChapterBeatError) {
          if (saved) error.message += ` [screenshot: ${shot}]`;
          throw error;
        }
        throw new ChapterBeatError(slug, "capture video", "recording", error);
      }
      await close();
      const recorded = await video.path();
      const rawPath = join(tmpdir(), `arc-demo-${slug}-${String(process.pid)}-${Date.now().toString(36)}.webm`);
      await copyFile(recorded, rawPath);
      return { rawPath, run };
    } finally {
      await close().catch(() => undefined);
    }
  }));
}

const DELIVERY: ReadonlyArray<readonly [DeliveryKind, string]> = [["webm", "webm"], ["mp4", "mp4"], ["poster", "webp"]];

/** A fixed manifest duration and timestamp-normalized filter for deterministic delivery clips. */
export function chapterVideoFilter(slug: ChapterSlug): string {
  const duration = CHAPTERS[slug].targetSeconds.toFixed(3);
  return `trim=start=0:duration=${duration},setpts=PTS-STARTPTS,fps=8,scale=960:540:flags=lanczos`;
}

async function verifyDelivery(slug: ChapterSlug, kind: DeliveryKind, path: string): Promise<void> {
  const json = await command("ffprobe", ["-v", "error", "-show_streams", "-show_format", "-of", "json", path], `${slug} ${basename(path)} probe`);
  const problems = deliveryProblems(kind, parseProbe(json), (await stat(path)).size);
  if (problems.length) throw new Error(`${basename(path)}: ${problems.join("; ")}`);
}

/** Encodes and verifies the three delivery files in a staging directory, then moves them into place together. */
async function encode(slug: ChapterSlug, capture: RawCapture, options: RecorderOptions): Promise<readonly string[]> {
  const staging = await mkdtemp(join(options.outputDir, `.demo-${slug}-`));
  const staged = (extension: string) => join(staging, `${slug}.${extension}`);
  const posterPng = join(staging, `${slug}.poster.png`);
  try {
    await writeFile(posterPng, capture.run.poster);
    // Wall-clock capture time varies with browser startup and shutdown. Trim to the
    // manifest duration and reset source timestamps so both formats are repeatable.
    const videoFilter = chapterVideoFilter(slug);
    await command("ffmpeg", ["-y", "-i", capture.rawPath, "-an", "-vf", videoFilter, "-c:v", "libvpx-vp9", "-crf", "42", "-b:v", "0", staged("webm")], `${slug} WebM encoding`);
    await command("ffmpeg", ["-y", "-i", capture.rawPath, "-an", "-vf", videoFilter, "-c:v", "libx264", "-crf", "30", "-preset", "slow", "-pix_fmt", "yuv420p", "-movflags", "+faststart", staged("mp4")], `${slug} MP4 encoding`);
    await command("ffmpeg", ["-y", "-i", posterPng, "-frames:v", "1", "-vf", "scale=960:540:flags=lanczos", "-c:v", "libwebp", "-q:v", "72", staged("webp")], `${slug} poster encoding`);
    if (options.contactSheets) {
      const tile = "fps=1,tile=4x3:padding=6:margin=6:color=white";
      await command("ffmpeg", ["-y", "-i", staged("webm"), "-vf", tile, "-frames:v", "1", staged("sheet.png")], `${slug} contact sheet`);
      await command("ffmpeg", ["-y", "-i", staged("webm"), "-vf", `fps=1,scale=390:-1:flags=lanczos,${tile.slice("fps=1,".length)}`, "-frames:v", "1", staged("sheet-390.png")], `${slug} 390px contact sheet`);
    }

    for (const [kind, extension] of DELIVERY) await verifyDelivery(slug, kind, staged(extension));

    const published: string[] = [];
    const names = outputNames(slug, options).filter((name) => !name.endsWith(".raw.webm"));
    for (const name of names) {
      const destination = join(options.outputDir, name);
      await rename(join(staging, name), destination);
      published.push(destination);
    }
    if (options.keepRaw) {
      const rawDestination = join(options.outputDir, `${slug}.raw.webm`);
      await copyFile(capture.rawPath, rawDestination);
      published.push(rawDestination);
    }
    return published;
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

export interface RecordedChapter {
  files: readonly string[];
  seconds: number;
}

export async function recordOne(slug: ChapterSlug, options: RecorderOptions): Promise<RecordedChapter> {
  // a stale failure screenshot must not outlive a successful re-run
  await rm(join(options.outputDir, `${slug}.failure.png`), { force: true });
  let capture: RawCapture;
  try {
    capture = await rawCapture(slug, options);
  } catch (error) {
    if (error instanceof ChapterBeatError) throw error;
    throw new ChapterBeatError(slug, "capture video", "recording", error);
  }
  try {
    try {
      return { files: await encode(slug, capture, options), seconds: capture.run.seconds };
    } catch (error) {
      throw new ChapterBeatError(slug, "encode and verify assets", "recording", error);
    }
  } finally {
    await rm(capture.rawPath, { force: true });
  }
}

/** Sums the delivery set for the given chapters and enforces the tour's byte budget. */
export async function verifyOutputSet(outputDir: string, slugs: readonly ChapterSlug[]): Promise<number> {
  let total = 0;
  for (const slug of slugs) {
    for (const name of outputNames(slug)) total += (await stat(join(outputDir, name))).size;
  }
  const problem = setProblem(total);
  if (problem) throw new Error(`recording output set: ${problem}`);
  return total;
}

/** Proves the disposable profile mechanism cleans up, without a browser. */
export async function dryRunProfileCheck(): Promise<string> {
  let created = "";
  await usingDisposableDirectory("arc-demo-profile-", async (directory) => {
    created = directory;
    await writeFile(join(directory, "dry-run-marker"), "fictional fixtures only\n");
  });
  let remains = true;
  try { await access(created); } catch { remains = false; }
  if (remains) throw new Error(`disposable profile was not cleaned up: ${created}`);
  return created;
}
