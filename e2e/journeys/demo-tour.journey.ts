import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { DEMOS, TOUR_SECONDS } from "../../components/demo/demos";
import { STAMP_PATH } from "../../scripts/demo-recorder/freshness";

/*
 * The /demo tour, as a new coach meets it. How it could break, and the test that catches each:
 *  - a chapter is missing or out of order, or its card's title, length, summary or pills say
 *    something other than the manifest the recorder proved them against  → "every chapter"
 *  - the "Under N seconds" promise no longer covers the tour               → "every chapter"
 *  - a clip or poster is missing, served as something else, or not the bytes that were
 *    committed                                                             → "every chapter"
 *  - a clip is not the length its card promises, or not 960×540, so it was cut short or
 *    recorded wrong; a poster is not a 960×540 picture                    → "every chapter"
 *  - starting one clip leaves another playing                              → "one clip at a time"
 * Whether the clips still show today's UI is `bun test`'s job (components/demo/demos.test.ts
 * against components/demo/recorded-from.json); the manifest this leaves names the recording's
 * fingerprint so the two can be tied together.
 *
 * Leaves `demo-tour-<device>.json` (every chapter's card, each file's bytes and sha256, what the
 * browser measured, and the recorded-from fingerprint) and, on the desktop project, a frame from
 * the middle of every clip (`demo-tour-chromium-<slug>.png`) in test-results/, uploaded as `demo-tour`.
 */

const DEMOS_DIR = new URL("../../public/demos/", import.meta.url);
const sha256 = (bytes: Buffer): string => createHash("sha256").update(bytes).digest("hex");
const onDisk = (name: string): Buffer => readFileSync(new URL(name, DEMOS_DIR));

/** The committed stamp's fingerprint, reduced to one digest: which recorded UI these clips are. */
function recordedFrom(): string {
  const stamp = JSON.parse(readFileSync(new URL(`../../${STAMP_PATH}`, import.meta.url), "utf8")) as { files: Record<string, string> };
  return sha256(Buffer.from(JSON.stringify(Object.entries(stamp.files).sort(([a], [b]) => a.localeCompare(b)))));
}

const card = (page: Page, title: string): Locator => page.locator("article").filter({ has: page.getByRole("heading", { name: title, exact: true }) });
const clip = (page: Page, title: string): Locator => page.getByLabel(`${title} demonstration`, { exact: true });

interface Measured { duration: number; width: number; height: number; source: string }

/** Loads a clip's metadata the way the page's own <video> would, and reads what the browser decoded. */
async function measure(video: Locator): Promise<Measured> {
  return video.evaluate(async (element: HTMLVideoElement) => {
    element.preload = "metadata";
    if (element.readyState < HTMLMediaElement.HAVE_METADATA) {
      await new Promise<void>((resolve, reject) => {
        element.addEventListener("loadedmetadata", () => { resolve(); }, { once: true });
        element.addEventListener("error", () => { reject(new Error(`could not load ${element.currentSrc}`)); }, { once: true });
        element.load();
      });
    }
    return { duration: element.duration, width: element.videoWidth, height: element.videoHeight, source: element.currentSrc };
  });
}

async function posterSize(page: Page, url: string): Promise<{ width: number; height: number }> {
  return page.evaluate(async (src) => {
    const image = new Image();
    image.src = src;
    await image.decode();
    return { width: image.naturalWidth, height: image.naturalHeight };
  }, url);
}

test("every chapter's card matches the manifest, and its clip and poster are the committed files at the promised length", async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  const device = testInfo.project.name;
  await page.goto("/demo");
  await expect(page.getByRole("heading", { name: `Learn the whole play designer in ${String(DEMOS.length)} short clips.` })).toBeVisible();
  // the promise at the top of the page covers the whole tour
  const badge = await page.getByText(/^Under \d+ seconds$/).innerText();
  expect(Number.parseInt(badge.replace(/\D+/g, ""), 10)).toBeGreaterThanOrEqual(TOUR_SECONDS);
  await expect(page.locator("article")).toHaveCount(DEMOS.length);
  await expect(page.locator("article h2")).toHaveText(DEMOS.map((demo) => demo.title));

  const chapters = [];
  for (const demo of DEMOS) {
    const article = card(page, demo.title);
    await expect(article.getByText(demo.time, { exact: true })).toBeVisible();
    await expect(article.getByText(demo.summary, { exact: true })).toBeVisible();
    await expect(article.getByRole("list", { name: "Features covered" }).getByRole("listitem")).toHaveText([...demo.covers]);

    // what the server hands a coach is exactly what was committed, as the type the page asks for
    const files: Record<string, { bytes: number; sha256: string; type: string }> = {};
    for (const [extension, type] of [["webm", "video/webm"], ["mp4", "video/mp4"], ["webp", "image/webp"]] as const) {
      const name = `${demo.slug}.${extension}`;
      const response = await page.request.get(`/demos/${name}`);
      expect(response.status(), name).toBe(200);
      expect(response.headers()["content-type"], name).toContain(type);
      const served = await response.body();
      expect(sha256(served), `${name} is the committed file`).toBe(sha256(onDisk(name)));
      files[extension] = { bytes: served.length, sha256: sha256(served), type };
    }

    const video = clip(page, demo.title);
    await expect(video).toHaveAttribute("poster", `/demos/${demo.slug}.webp`);
    const measured = await measure(video);
    const promised = Number.parseInt(demo.time, 10);
    // encoding trims each clip to its promised length at 8 fps: within a frame of it
    expect(measured.duration, `${demo.slug} runs as long as its card says`).toBeCloseTo(promised, 0);
    expect(Math.abs(measured.duration - promised), `${demo.slug} duration`).toBeLessThanOrEqual(0.2);
    expect({ width: measured.width, height: measured.height }, demo.slug).toEqual({ width: 960, height: 540 });
    expect(new URL(measured.source).pathname).toBe(`/demos/${demo.slug}.webm`);
    const poster = await posterSize(page, `/demos/${demo.slug}.webp`);
    expect(poster, `${demo.slug} poster`).toEqual({ width: 960, height: 540 });

    let frame: string | null = null;
    if (device === "chromium") {
      await video.scrollIntoViewIfNeeded();
      // the frame itself, not the browser's controls or its seeking spinner over it
      await video.evaluate(async (element: HTMLVideoElement) => {
        element.controls = false;
        await new Promise<void>((resolve) => {
          element.addEventListener("seeked", () => { resolve(); }, { once: true });
          element.currentTime = element.duration / 2;
        });
        // until the sought frame is on screen, or a second passes where a browser never says
        await Promise.race([
          new Promise<void>((resolve) => { element.requestVideoFrameCallback(() => { resolve(); }); }),
          new Promise<void>((resolve) => { setTimeout(resolve, 1_000); }),
        ]);
      });
      frame = `demo-tour-${device}-${demo.slug}.png`;
      await video.screenshot({ path: `test-results/${frame}` });
      await video.evaluate((element: HTMLVideoElement) => { element.controls = true; });
    }
    chapters.push({
      slug: demo.slug, title: demo.title, time: demo.time, covers: demo.covers,
      files, measured: { duration: measured.duration, width: measured.width, height: measured.height }, poster, frame,
    });
  }

  writeFileSync(`test-results/demo-tour-${device}.json`, `${JSON.stringify({
    device, tourSeconds: TOUR_SECONDS, badge, recordedFrom: recordedFrom(), chapters,
  }, null, 2)}\n`);
});

test("one clip at a time: starting a second chapter pauses the first", async ({ page }) => {
  await page.goto("/demo");
  const [one, two] = DEMOS;
  if (!one || !two) throw new Error("the tour needs two chapters to switch between");
  const [first, second] = [clip(page, one.title), clip(page, two.title)];
  const playing = (video: Locator) => video.evaluate((element: HTMLVideoElement) => !element.paused);
  await first.evaluate((element: HTMLVideoElement) => element.play());
  await expect.poll(() => playing(first)).toBe(true);
  await second.evaluate((element: HTMLVideoElement) => element.play());
  await expect.poll(() => playing(second)).toBe(true);
  await expect.poll(() => playing(first)).toBe(false);
});
