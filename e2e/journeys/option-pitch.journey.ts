import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";
import { writeFileSync } from "node:fs";
import { S } from "../../lib/play/geometry";
import type { Hop, Pair, SavedPlay } from "../../lib/play/types";
import { Designer } from "../support/designer";
import { OTTERS, lateraled, play, seed, storedDraft } from "../support/fixtures";

/**
 * A pitch on the run, the option (docs/adr/006-pitch-on-the-run.md): a carrier runs with the ball to
 * a release point and pitches from there, instead of tossing it from where they stand. Each test
 * leaves what it saw as `test-results/option-pitch-<device>-<test>.json` with pictures beside it,
 * uploaded as `option-pitch`.
 */

test.use({ permissions: ["clipboard-read", "clipboard-write"] });

const LINE_NOTE = "QB has to pitch from behind the line. Snapped the pitch back to it.";

/** QB → Z, let go from where the QB stands, as a play saved before pitches on the run stored it; Z keeps it. */
const SWEEP: SavedPlay = lateraled(play("fx-sweep", "Otter Sweep", { o5: { type: "stretch" }, o4: { type: "go" } }), ["o5"]);

const out = (info: TestInfo, name: string): string => `test-results/option-pitch-${info.project.name}-${name}`;
const takes = (d: Designer, label: string): Locator => d.field.getByRole("button", { name: `Offense ${label}, can take the lateral`, exact: true });
const release = (d: Designer, hop: number): Locator => d.field.locator(`[data-release='${String(hop)}']`);
const catchHandle = (d: Designer, hop: number): Locator => d.field.locator(`[data-catch='${String(hop)}']`);
const group = (page: Page, name: string): Locator => page.locator("#route-sidebar").getByRole("group", { name, exact: true });
const onTheRun = (page: Page): Locator => page.locator("#route-sidebar").getByRole("button", { name: "On the run", exact: true });

/** The quarterback's laterals as stored: who takes each, the catches the coach moved and the releases they run to. */
async function hops(page: Page): Promise<readonly Hop[] | undefined> {
  return (await storedDraft(page))?.players.find((p) => p.id === "o2")?.laterals;
}

/** Reads the playback football, in yards, every 50ms of the page's own clock until the play is over. */
async function playback(d: Designer): Promise<{ t: number; x: number; y: number }[]> {
  await d.closeSidebars();
  await d.page.clock.install();
  await d.page.clock.pauseAt(new Date());
  await d.page.getByRole("button", { name: "Run the play" }).click();
  const ball = d.field.locator("image[data-export='skip']");
  const samples: { t: number; x: number; y: number }[] = [];
  for (let t = 0; t <= 8000; t += 50) {
    if ((await ball.count()) === 0) break;
    const [transform, viewBox] = await Promise.all([ball.getAttribute("transform"), d.field.getAttribute("viewBox")]);
    const m = /translate\(([-\d.]+),([-\d.]+)\) scale\(([\d.]+)\)/.exec(transform ?? "");
    if (m && viewBox) {
      const top = 8 - Number(viewBox.split(" ")[3]) / S;
      const lift = (Number(m[3]) - 1) / 0.6;
      samples.push({ t, x: Number(m[1]) / S, y: (Number(m[2]) + lift * 16) / S + top });
    }
    await d.page.clock.runFor(50);
  }
  await d.page.clock.resume();
  return samples;
}
const near = (s: { x: number; y: number }, p: Pair): boolean => Math.hypot(s.x - p[0], s.y - p[1]) < 0.6;

/** Drags a handle to a yard point, and reads whether it shook while it was still held. */
async function drag(d: Designer, handle: Locator, to: Pair): Promise<{ shook: boolean }> {
  await d.closeSidebars();
  const box = await handle.boundingBox();
  if (!box) throw new Error("no handle to drag");
  const target = await d.yardPoint(to[0], to[1]);
  await d.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await d.page.mouse.down();
  await d.page.mouse.move(target.x, target.y, { steps: 6 });
  const shook = (await handle.locator(".animate-shake").count()) === 1;
  await d.page.mouse.up();
  return { shook };
}

/** QB laterals to Z, who keeps it on a Stretch; the QB is selected again, at the snap. */
async function sweep(d: Designer): Promise<void> {
  await d.select("QB");
  await d.pick("Lateral");
  await d.foldOverlays();
  await takes(d, "Z").click();
  await expect(d.page.getByRole("heading", { name: "Z has the ball" })).toBeVisible();
  await d.pick("Stretch");
  await d.select("QB");
}

test("the QB runs with the ball and pitches to Z from the run: drawn, stored, toggled off and on, saved, in the gallery and shared", async ({ page }, info) => {
  const d = new Designer(page);
  await d.goto();
  await d.setName("Otter Speed Option");
  await sweep(d);

  // a lateral from where the QB stands offers On the run; nothing runs yet
  await expect(onTheRun(page)).toHaveAttribute("aria-pressed", "false");
  await expect(d.field.locator("[data-run]")).toHaveCount(0);
  await expect(release(d, 0)).toHaveCount(0);
  await expect.poll(() => hops(page)).toEqual([{ to: "o5" }]);

  // On the run: the QB runs 4 yards across toward Z and 3 up, and pitches from there; the run is drawn solid
  // from the QB to a round handle, and the arc leaves from the handle
  await onTheRun(page).click();
  await d.palette();
  await expect(onTheRun(page)).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#route-sidebar")).toContainText("QB runs with the ball to the round handle and pitches from there.");
  await expect.poll(() => hops(page)).toEqual([{ to: "o5", release: [19, 2] }]);
  await expect(d.field.locator("[data-run]")).toHaveCount(1);
  await expect(release(d, 0)).toContainText("QB pitches");
  await expect(catchHandle(d, 0)).toContainText("Z catches");
  await d.closeSidebars();
  await page.screenshot({ path: `${out(info, "draw")}-option.png` });

  // the tile again pitches from where the QB stands; undo brings the run back
  await d.select("QB");
  await onTheRun(page).click();
  await expect.poll(() => hops(page)).toEqual([{ to: "o5" }]);
  await expect(d.field.locator("[data-run]")).toHaveCount(0);
  await d.undo.click();
  await expect.poll(() => hops(page)).toEqual([{ to: "o5", release: [19, 2] }]);
  await expect(d.field.locator("[data-run]")).toHaveCount(1);

  // saved, it reloads the same, the gallery draws the run, and a snapshot link draws it without handles
  await d.save();
  await page.reload();
  await expect(d.field.locator("[data-run]")).toHaveCount(1);
  await page.goto("/playbooks");
  const card = page.getByRole("link", { name: "Open Otter Speed Option in the designer" }).locator("xpath=..");
  await expect(card.getByRole("img").first().locator("[data-run]")).toHaveCount(1);
  await page.screenshot({ path: `${out(info, "draw")}-gallery.png` });
  await d.openSaved("Otter Speed Option");
  await d.clickTool("Copy share link");
  const dialog = page.getByRole("dialog", { name: "Share snapshot" });
  await expect(dialog.locator("[data-run]")).toHaveCount(1);
  await dialog.getByRole("button", { name: "Copy snapshot link" }).click();
  const url = await page.evaluate(() => navigator.clipboard.readText());
  await page.goto(url);
  const shared = page.getByRole("img", { name: "Play diagram" });
  await expect(shared.locator("[data-run]")).toHaveCount(1);
  await expect(shared.locator("[data-release]")).toHaveCount(0);
  await page.screenshot({ path: `${out(info, "draw")}-share.png` });

  // and the link carries the run: opened on a cleared device, the QB still pitches from the same spot
  const id = new URL(url).pathname.replace(/^\/p\//, "");
  await page.evaluate(() => { localStorage.clear(); });
  await d.goto(`?p=${id}`);
  await expect.poll(() => hops(page)).toEqual([{ to: "o5", release: [19, 2] }]);

  writeFileSync(`${out(info, "draw")}.json`, `${JSON.stringify({ project: info.project.name, url, hops: await hops(page) }, null, 2)}\n`);
});

test("the pitch stays behind the line and on the field, and the catch follows it back", async ({ page }, info) => {
  const d = new Designer(page);
  await d.goto();
  await sweep(d);
  await onTheRun(page).click();
  await expect.poll(() => hops(page)).toEqual([{ to: "o5", release: [19, 2] }]);
  const steps: Record<string, unknown>[] = [];

  // past the line: the run stops on it, with a shake and a flag note
  const past = await drag(d, release(d, 0), [21, -3]);
  await expect(d.toast).toHaveText(LINE_NOTE);
  await expect(d.toast).toHaveAttribute("data-flag", "true");
  await expect.poll(() => hops(page)).toEqual([{ to: "o5", release: [21, 0.9] }]);
  expect(past.shook).toBe(true);
  steps.push({ drag: "the pitch past the line", shook: past.shook, note: await d.toast.textContent(), hops: await hops(page) });
  await page.screenshot({ path: `${out(info, "clamp")}-line.png` });

  // the catch is placed by the coach, then the run goes deeper than it: the catch is pushed back level
  // with the pitch (a lateral is never forward), and never comes forward again on its own
  await drag(d, catchHandle(d, 0), [24, 4]);
  await expect.poll(() => hops(page)).toEqual([{ to: "o5", release: [21, 0.9], catch: [24, 4] }]);
  await drag(d, release(d, 0), [20, 6]);
  await expect.poll(() => hops(page)).toEqual([{ to: "o5", release: [20, 6], catch: [24, 6] }]);
  steps.push({ drag: "the pitch 6 yards deep", hops: await hops(page) });
  await drag(d, release(d, 0), [20, 3]);
  await expect.poll(() => hops(page)).toEqual([{ to: "o5", release: [20, 3], catch: [24, 6] }]);
  await page.screenshot({ path: `${out(info, "clamp")}-deep.png` });

  // by keyboard: half a yard a press, a yard with Shift, and a step past the line is snapped back with the same note
  await release(d, 0).focus();
  await page.keyboard.press("ArrowLeft");
  await expect.poll(() => hops(page)).toMatchObject([{ release: [19.5, 3] }]);
  await page.keyboard.press("Shift+ArrowUp");
  await page.keyboard.press("Shift+ArrowUp");
  await expect.poll(() => hops(page)).toMatchObject([{ release: [19.5, 1] }]);
  await page.keyboard.press("ArrowUp");
  await expect(d.toast).toHaveText(LINE_NOTE);
  await expect.poll(() => hops(page)).toMatchObject([{ release: [19.5, 0.9] }]);
  steps.push({ keys: "left, shift+up twice, up", hops: await hops(page) });

  // undo walks every move back
  for (let i = 0; i < 4; i++) await d.undo.click();
  await expect.poll(() => hops(page)).toEqual([{ to: "o5", release: [20, 3], catch: [24, 6] }]);

  writeFileSync(`${out(info, "clamp")}.json`, `${JSON.stringify({ project: info.project.name, steps }, null, 2)}\n`);
});

test("▶ snaps to the QB, who runs with the ball to the pitch and lets it go there; Z takes it behind the line and keeps it", async ({ page }, info) => {
  const d = new Designer(page);
  await d.goto();
  await sweep(d);
  await onTheRun(page).click();
  await expect.poll(() => hops(page)).toEqual([{ to: "o5", release: [19, 2] }]);
  const samples = await playback(d);
  // the ball snapped back to the QB, then carried along the run (its midpoint), held at the pitch, caught
  // by Z, and only then across the line. The QB sets off the moment the snap lands, so the ball is read
  // as theirs once it is within a stride of their spot
  const atQB = samples.findIndex((s) => near(s, [15, 5]));
  const onRun = samples.findIndex((s, i) => i > atQB && near(s, [17, 3.5]));
  const atPitch = samples.findIndex((s, i) => i > onRun && Math.abs(s.x - 19) < 0.05 && Math.abs(s.y - 2) < 0.05);
  const atCatch = samples.findIndex((s, i) => i > atPitch && near(s, [22, 5]));
  const forward = samples.findIndex((s) => s.y < 0.9);
  writeFileSync(`${out(info, "playback")}.json`, `${JSON.stringify({ project: info.project.name, atQB, onRun, atPitch, atCatch, forward, samples }, null, 2)}\n`);
  expect(atQB).toBeGreaterThanOrEqual(0);
  expect(onRun).toBeGreaterThan(atQB);
  expect(atPitch).toBeGreaterThan(onRun);
  expect(atCatch).toBeGreaterThan(atPitch);
  expect(forward).toBeGreaterThan(atCatch);
  // held at the pitch for a beat before it goes
  expect(samples.filter((s, i) => i >= atPitch && i < atCatch && Math.abs(s.x - 19) < 0.05 && Math.abs(s.y - 2) < 0.05).length).toBeGreaterThanOrEqual(2);
  // the toss itself never goes forward of the pitch, and nothing crosses the line until Z has it
  expect(samples.slice(atPitch, atCatch + 1).every((s) => s.y >= 2 - 0.01)).toBe(true);
  expect(samples.slice(0, atCatch + 1).every((s) => s.y >= 0.9 - 0.01)).toBe(true);
});

test("a later carrier pitches on the run too, the play flips with its runs, and a play saved before pitches on the run opens unchanged", async ({ page }, info) => {
  const d = new Designer(page);
  await seed(page, { plays: [SWEEP], team: OTTERS });

  // saved before: the QB lets it go where they stand, and no run is drawn
  await d.openSaved(SWEEP.name);
  await expect(d.field.locator("[data-lateral]")).toHaveCount(1);
  await expect(d.field.locator("[data-run]")).toHaveCount(0);
  await expect.poll(() => hops(page)).toEqual([{ to: "o5" }]);

  // QB runs and pitches to Z, Z runs and pitches to X, X throws to Y
  await d.select("QB");
  await onTheRun(page).click();
  await d.select("Z");
  await expect(page.getByRole("heading", { name: "Z has the ball" })).toBeVisible();
  await expect(onTheRun(page)).toHaveCount(0);
  await d.pick("Lateral");
  await d.foldOverlays();
  await takes(d, "X").click();
  await d.pick("Throw");
  // Y, on the Go the play was saved with, is the read
  await d.select("Y");
  await d.primaryButton.click();
  // Z's time with it, from the ball path: With the ball now offers On the run, since the ball goes on from Z
  await d.select("QB");
  await page.getByRole("list", { name: "Ball path" }).getByRole("button", { name: /^Z, step 2/ }).click();
  await expect(group(page, "With the ball").getByRole("button")).toHaveText(["Throw", "Lateral", "On the run", "Done"]);
  await onTheRun(page).click();
  // Z's run starts at Z's catch (22, 5) and goes 4 across toward X, 3 up
  await expect.poll(() => hops(page)).toEqual([{ to: "o5", release: [19, 2] }, { to: "o3", release: [18, 2] }]);
  await expect(d.field.locator("[data-run]")).toHaveCount(2);
  await expect(release(d, 1)).toContainText("Z pitches");
  await d.closeSidebars();
  await page.screenshot({ path: `${out(info, "chain")}-two-runs.png` });

  // flipped, both runs flip with the field
  await d.clickTool("Flip play");
  await expect.poll(() => hops(page)).toEqual([{ to: "o5", release: [11, 2] }, { to: "o3", release: [12, 2] }]);
  await d.closeSidebars();
  await page.screenshot({ path: `${out(info, "chain")}-flipped.png` });
  await d.undo.click();
  await expect.poll(() => hops(page)).toEqual([{ to: "o5", release: [19, 2] }, { to: "o3", release: [18, 2] }]);

  writeFileSync(`${out(info, "chain")}.json`, `${JSON.stringify({ project: info.project.name, hops: await hops(page) }, null, 2)}\n`);
});
