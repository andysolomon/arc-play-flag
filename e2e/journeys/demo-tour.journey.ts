import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { DEMOS, DEMO_VIDEO, TOUR_SECONDS } from "../../components/demo/demos";
import { STAMP_PATH } from "../../scripts/demo-recorder/freshness";

/*
 * The /demo tour, as a new coach meets it. How it could break, and the test that catches each:
 *  - a chapter is missing or out of order, or its card's title, length, summary or pills say
 *    something other than the manifest the recorder proved them against  → "every chapter"
 *  - the "Under N seconds" promise no longer covers the tour               → "every chapter"
 *  - a clip or poster is missing, served as something else, or not the bytes that were
 *    committed                                                             → "every chapter"
 *  - a clip is not the length its card promises, or not the phone-shaped 576×720 frame, so it
 *    was cut short or recorded wrong; a poster is not a 576×720 picture    → "every chapter"
 *  - a card's captions (the silent clip's text alternative) are not the manifest's → "every chapter"
 *  - the browser draws its own controls over a clip (iOS covered it with skip, scrub and AirPlay
 *    buttons; Android Chrome adds a cast button), or a clip loses playsinline, so an iPhone plays
 *    it fullscreen under its own controls                                  → "plays without the browser's controls"
 *  - a stopped clip shows no sign that it plays, the sign or the chapter number stays over the
 *    picture once it does, or the control over the clip paints over the poster
 *                                                                          → "plays without the browser's controls"
 *  - a tap on the picture away from the sign does nothing, the chapter number takes the tap, or a
 *    held click at the clip's edge misses because pressing shrinks the control
 *                                                                          → "plays without the browser's controls"
 *  - a second tap does not pause it, or a keyboard cannot reach, name or press the control
 *                                                                          → "plays without the browser's controls"
 *  - a clip that has finished cannot be played again, or still says Pause  → "plays without the browser's controls"
 *  - starting one clip leaves another playing, or still marked as playing  → "one clip at a time"
 * Whether the clips still show today's UI is `bun test`'s job (components/demo/demos.test.ts
 * against components/demo/recorded-from.json); the manifest this leaves names the recording's
 * fingerprint so the two can be tied together.
 *
 * Leaves `demo-tour-<device>.json` (every chapter's card, each file's bytes and sha256, what the
 * browser measured, and the recorded-from fingerprint), `demo-tour-<device>-playback.json` (the
 * first chapter's control, sign and clip after every tap and key) with a picture of that card
 * stopped and playing (`demo-tour-<device>-stopped.png`, `demo-tour-<device>-playing.png`) and, on
 * the desktop project, a frame from the middle of every clip (`demo-tour-chromium-<slug>.png`) in
 * test-results/, uploaded as `demo-tour`.
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
/** The one control on a chapter's card: it covers the clip, and its name says what a press does. */
const control = (page: Page, title: string): Locator => card(page, title).getByRole("button");
/** The play sign drawn over a stopped clip. */
const sign = (page: Page, title: string): Locator => control(page, title).locator("svg");
/** The chapter's number in the clip's corner, shown over a stopped clip like the sign. */
const number = (page: Page, title: string): Locator =>
  card(page, title).getByText(String(DEMOS.findIndex((demo) => demo.title === title) + 1), { exact: true });
const playing = (video: Locator): Promise<boolean> => video.evaluate((element: HTMLVideoElement) => !element.paused && !element.ended);

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
    await expect(article.getByRole("list", { name: "What the clip says" }).getByRole("listitem")).toHaveText(demo.captions.map((caption, step) => `${String(step + 1)}.${caption}`));

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
    // encoding trims each clip to its promised length at 10 or 12 fps: within a frame of it
    expect(measured.duration, `${demo.slug} runs as long as its card says`).toBeCloseTo(promised, 0);
    expect(Math.abs(measured.duration - promised), `${demo.slug} duration`).toBeLessThanOrEqual(0.2);
    expect({ width: measured.width, height: measured.height }, demo.slug).toEqual(DEMO_VIDEO);
    expect(new URL(measured.source).pathname).toBe(`/demos/${demo.slug}.webm`);
    const poster = await posterSize(page, `/demos/${demo.slug}.webp`);
    expect(poster, `${demo.slug} poster`).toEqual(DEMO_VIDEO);

    let frame: string | null = null;
    if (device === "chromium") {
      await video.scrollIntoViewIfNeeded();
      await video.evaluate(async (element: HTMLVideoElement) => {
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
      // the frame itself, not the play sign drawn over a stopped clip
      await video.screenshot({ path: `test-results/${frame}`, style: "article button > span { display: none !important; }" });
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

interface Step { step: string; name: string | null; sign: boolean; number: boolean; playing: boolean; ended: boolean; controls: boolean; at: number }

test("a clip plays without the browser's controls: a tap anywhere on it or a key plays and pauses it, and nothing covers it while it plays", async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  const device = testInfo.project.name;
  // as most coaches have it: the sign fades and a press scales, so a shrinking control can miss a click
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/demo");

  // no clip asks the browser for its controls, lets Android Chrome put a cast button over it, or
  // leaves an iPhone free to play it fullscreen under its own
  for (const demo of DEMOS) {
    const video = clip(page, demo.title);
    await expect(video, demo.slug).not.toHaveAttribute("controls");
    await expect(video, demo.slug).toHaveJSProperty("controls", false);
    await expect(video, demo.slug).toHaveJSProperty("disableRemotePlayback", true);
    await expect(video, demo.slug).toHaveJSProperty("playsInline", true);
    await expect(control(page, demo.title), demo.slug).toHaveAccessibleName(`Play ${demo.title}`);
    await expect(sign(page, demo.title), demo.slug).toBeVisible();
    await expect(number(page, demo.title), demo.slug).toBeVisible();
    // the control over the clip is see-through: the poster, then the clip, is all there is under the sign
    await expect(control(page, demo.title), demo.slug).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  }

  const [demo] = DEMOS;
  if (!demo) throw new Error("the tour needs a chapter to play");
  const article = card(page, demo.title);
  const video = clip(page, demo.title);
  const button = control(page, demo.title);
  /**
   * A real tap at a point on the clip, from its top left corner, given its size; on the desktop a
   * click held as long as a coach holds one. Measured each time: a screenshot of the card can scroll it.
   */
  const tapAt = async (where: (width: number, height: number) => [number, number]): Promise<void> => {
    await video.scrollIntoViewIfNeeded();
    const box = await video.boundingBox();
    if (!box) throw new Error(`${demo.slug} has no box on screen`);
    const [x, y] = where(box.width, box.height);
    if (testInfo.project.use.hasTouch) await page.touchscreen.tap(box.x + x, box.y + y);
    else await page.mouse.click(box.x + x, box.y + y, { delay: 200 });
  };
  const steps: Step[] = [];
  const record = async (step: string): Promise<void> => {
    const state = await video.evaluate((element: HTMLVideoElement) => ({
      playing: !element.paused && !element.ended, ended: element.ended, controls: element.controls, at: element.currentTime,
    }));
    steps.push({
      step, name: await button.getAttribute("aria-label"),
      sign: await sign(page, demo.title).isVisible(), number: await number(page, demo.title).isVisible(), ...state,
    });
  };
  const expectPlaying = async (): Promise<void> => {
    await expect.poll(() => playing(video)).toBe(true);
    await expect(button).toHaveAccessibleName(`Pause ${demo.title}`);
    await expect(sign(page, demo.title)).toBeHidden();
    await expect(number(page, demo.title)).toBeHidden();
    await expect(video).toHaveJSProperty("controls", false);
  };
  /** Stopped, and either paused where it was (well before the end, so a tap that missed and let it run out cannot pass) or finished. */
  const expectStopped = async (how: "paused" | "finished"): Promise<void> => {
    await expect.poll(() => playing(video)).toBe(false);
    const { ended, at, duration } = await video.evaluate((element: HTMLVideoElement) => ({ ended: element.ended, at: element.currentTime, duration: element.duration }));
    expect(ended, how).toBe(how === "finished");
    if (how === "paused") expect(at, "paused where it was, not run out").toBeLessThan(duration - 1);
    await expect(button).toHaveAccessibleName(`Play ${demo.title}`);
    await expect(sign(page, demo.title)).toBeVisible();
    await expect(number(page, demo.title)).toBeVisible();
  };

  await record("at rest");
  await article.screenshot({ path: `test-results/demo-tour-${device}-stopped.png` });

  // a tap on the sign plays it, and the sign gets out of the way
  await tapAt((width, height) => [width / 2, height / 2]);
  await expectPlaying();
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime)).toBeGreaterThan(1);
  await article.screenshot({ path: `test-results/demo-tour-${device}-playing.png` });
  await record("tapped the sign: playing");

  // a tap anywhere else on the picture, right up to its edge, pauses it, and one on the chapter number plays it again
  await tapAt((width, height) => [width - 3, height / 2]);
  await expectStopped("paused");
  await record("tapped the edge: paused");
  await tapAt(() => [24, 24]);
  await expectPlaying();
  await record("tapped the chapter number: playing");

  // once it has finished it says Play again, and a tap plays it from the start
  await video.evaluate((element: HTMLVideoElement) => { element.currentTime = element.duration - 0.3; });
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.ended)).toBe(true);
  await expectStopped("finished");
  await record("finished");
  await tapAt((width, height) => [width * 0.3, height * 0.6]);
  await expectPlaying();
  expect(await video.evaluate((element: HTMLVideoElement) => element.currentTime), "replays from the start").toBeLessThan(3);
  await record("tapped after the end: playing from the start");

  // a keyboard reaches the same control from the header with one Tab, and presses it either way
  await page.getByRole("link", { name: "‹ Designer", exact: true }).focus();
  await page.keyboard.press("Tab");
  await expect(button).toBeFocused();
  await page.keyboard.press("Space");
  await expectStopped("paused");
  await record("Space: paused");
  await page.keyboard.press("Enter");
  await expectPlaying();
  await record("Enter: playing");
  await page.keyboard.press("Space");
  await expectStopped("paused");
  await record("Space: paused");

  writeFileSync(`test-results/demo-tour-${device}-playback.json`, `${JSON.stringify({ device, chapter: demo.slug, steps }, null, 2)}\n`);
});

test("one clip at a time: starting a second chapter pauses the first", async ({ page }, testInfo) => {
  await page.goto("/demo");
  const [one, two] = DEMOS;
  if (!one || !two) throw new Error("the tour needs two chapters to switch between");
  const [first, second] = [clip(page, one.title), clip(page, two.title)];
  const press = (title: string) => (testInfo.project.use.hasTouch ? control(page, title).tap() : control(page, title).click());
  await press(one.title);
  await expect.poll(() => playing(first)).toBe(true);
  await press(two.title);
  await expect.poll(() => playing(second)).toBe(true);
  await expect.poll(() => playing(first)).toBe(false);
  // and the first one shows it: it offers Play again, under its sign
  await expect(control(page, one.title)).toHaveAccessibleName(`Play ${one.title}`);
  await expect(sign(page, one.title)).toBeVisible();
  await expect(control(page, two.title)).toHaveAccessibleName(`Pause ${two.title}`);
});
