import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";
import { writeFileSync } from "node:fs";
import { S } from "../../lib/play/geometry";
import type { Pair, Player, Route, SavedPlay } from "../../lib/play/types";
import { Designer } from "../support/designer";
import { OTTERS, play, seed, storedDraft } from "../support/fixtures";

/**
 * Lateral chains (docs/adr/004-lateral-chains.md): the quarterback laterals, each carrier laterals
 * again, throws or keeps it, every catch behind its release and the line. Each test leaves what it
 * saw as `test-results/lateral-chain-<device>-<test>.json` with pictures beside it, uploaded as
 * `lateral-chain`.
 */

test.use({ permissions: ["clipboard-read", "clipboard-write"] });

const LINE_NOTE = "A lateral has to be caught behind the line. Snapped the catch back to it.";
const forwardNote = (who: string): string => `A lateral can't go forward. Snapped the catch level with where ${who} lets it go.`;

/** QB → Z → X, X throws to Y on a Go, each catch stored where the coach put it. */
const TRICK: SavedPlay = play("fx-trick", "Otter Trick Lateral", {
  o2: { type: "lateral", target: "o5", catch: [22, 6] },
  o5: { type: "lateral", target: "o3", catch: [9, 6.5] },
  o3: { type: "throw" },
  o4: { type: "go", primary: true },
});

const out = (info: TestInfo, name: string): string => `test-results/lateral-chain-${info.project.name}-${name}`;
const takes = (d: Designer, label: string): Locator => d.field.getByRole("button", { name: `Offense ${label}, can take the lateral`, exact: true });
const handle = (d: Designer, thrower: string): Locator => d.field.locator(`[data-catch='${thrower}']`);
const crumbs = (page: Page): Locator => page.getByRole("list", { name: "Ball path" }).locator("li span:not([aria-hidden='true'])");
const group = (page: Page, name: string): Locator => page.locator("#route-sidebar").getByRole("group", { name, exact: true });

async function offense(page: Page): Promise<Record<string, Route | null>> {
  const draft = await storedDraft(page);
  return Object.fromEntries((draft?.players ?? []).filter((p) => p.team === "offense").map((p) => [p.label, p.route]));
}
async function catchOf(page: Page, id: string): Promise<Pair | undefined> {
  return (await storedDraft(page))?.players.find((p) => p.id === id)?.route?.catch;
}

/** Picks Lateral for the selected carrier and taps the red player who takes it. */
async function lateralTo(d: Designer, label: string): Promise<void> {
  await d.pick("Lateral");
  await d.foldOverlays();
  await takes(d, label).click();
}

/** Drags a catch handle to a yard point, and reads what the coach sees while it is still held. */
async function dragCatch(d: Designer, thrower: string, to: Pair): Promise<{ shook: boolean }> {
  await d.closeSidebars();
  const box = await handle(d, thrower).boundingBox();
  if (!box) throw new Error(`no handle for ${thrower}`);
  const target = await d.yardPoint(to[0], to[1]);
  await d.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await d.page.mouse.down();
  await d.page.mouse.move(target.x, target.y, { steps: 6 });
  const shook = (await handle(d, thrower).locator(".animate-shake").count()) === 1;
  await d.page.mouse.up();
  return { shook };
}

test("a coach laterals QB to Z to X, X throws to Y, and the chain is drawn, worded and shared", async ({ page }, info) => {
  const d = new Designer(page);
  await d.goto();
  await d.setName("Otter Trick Lateral");

  // Z holds no ball: no Lateral for them, and the pass tree as always
  await d.select("Z");
  await expect(group(page, "Runs").getByRole("button", { name: "Lateral", exact: true })).toHaveCount(0);
  await expect(group(page, "Routes").getByRole("button", { name: "Go", exact: true })).toBeVisible();
  await d.pick("Go");

  // the QB starts it from the RUN group, where Pitch was; like Man, it asks who takes it
  await d.select("QB");
  await expect(page.getByRole("heading", { name: "Pick a route" })).toBeVisible();
  await expect(group(page, "Runs").getByRole("button", { name: "Pitch" })).toHaveCount(0);
  await d.pick("Lateral");
  await d.palette();
  await expect(page.locator("#route-sidebar")).toContainText("Lateral to who? Choose a red player · Esc cancels.");
  await d.foldOverlays();
  await expect(d.toast).toHaveText("Lateral to who? Tap a red player.");
  // every red player off the chain gets the dashed ring; the QB, who has it, doesn't
  for (const label of ["C", "X", "Y", "Z"]) await expect(takes(d, label)).toBeVisible();
  await expect(d.player("QB")).toBeVisible();
  const ringed = await d.field.getByRole("button", { name: /can take the lateral$/ }).count();
  await page.screenshot({ path: `${out(info, "draw")}-targeting.png` });
  await takes(d, "Z").click();

  // Z is selected next and has the ball: throw, lateral again or keep it; no pass tree, and Z's Go is gone
  await expect(page.getByRole("heading", { name: "Z has the ball" })).toBeVisible();
  await expect(crumbs(page)).toHaveText(["QB", "Z", "?"]);
  await expect(group(page, "Routes")).toHaveCount(0);
  await expect(group(page, "With the ball").getByRole("button")).toHaveText(["Throw", "Lateral", "Done"]);
  await expect(group(page, "Runs").getByRole("button", { name: "Lateral", exact: true })).toHaveCount(0);
  await expect(page.locator("#route-sidebar")).toContainText("OR KEEP IT");
  await expect(d.primaryButton).toHaveCount(0);
  await expect.poll(() => offense(page)).toMatchObject({ QB: { type: "lateral", target: "o5" }, Z: null });

  // Z laterals on to X: neither the QB nor Z can take it back
  await d.pick("Lateral");
  await d.foldOverlays();
  await expect(d.field.getByRole("button", { name: /^Offense (QB|Z), can take the lateral$/ })).toHaveCount(0);
  await takes(d, "X").click();
  await expect(page.getByRole("heading", { name: "X has the ball" })).toBeVisible();
  await d.pick("Throw");
  await d.palette();
  await expect(crumbs(page)).toHaveText(["QB", "Z", "X", "throw"]);

  // Y runs a Go and is the read; X, in the chain, can't be
  await d.select("Y");
  await d.pick("Go");
  await d.palette();
  await d.primaryButton.click();
  await d.select("X");
  await expect(d.primaryButton).toHaveCount(0);
  await expect.poll(() => offense(page)).toEqual({
    C: null,
    QB: { type: "lateral", target: "o5" },
    X: { type: "throw" },
    Y: { type: "go", primary: true },
    Z: { type: "lateral", target: "o3" },
  });

  // on the field: two arcs, a football on each, and a handle at each catch
  await expect(d.field.locator("[data-lateral]")).toHaveCount(2);
  await expect(d.field.locator("[data-lateral] image")).toHaveCount(2);
  await expect(handle(d, "o2")).toContainText("Z catches");
  await expect(handle(d, "o5")).toContainText("X catches");
  // X's throw starts at X's catch and ends in the set-up ring behind the line
  await expect(d.field.locator("[data-set]")).toHaveCount(1);
  await d.closeSidebars();
  await page.screenshot({ path: `${out(info, "draw")}-chain.png` });

  // saved, it reloads the same, and a snapshot link draws the arcs without handles
  await d.save();
  await page.reload();
  await expect(d.field.locator("[data-lateral]")).toHaveCount(2);
  await d.clickTool("Copy share link");
  const dialog = page.getByRole("dialog", { name: "Share snapshot" });
  await expect(dialog.locator("[data-lateral]")).toHaveCount(2);
  await dialog.getByRole("button", { name: "Copy snapshot link" }).click();
  const url = await page.evaluate(() => navigator.clipboard.readText());
  await page.goto(url);
  const shared = page.getByRole("img", { name: "Play diagram" });
  await expect(shared.locator("[data-lateral]")).toHaveCount(2);
  await expect(shared.locator("[data-catch]")).toHaveCount(0);
  await page.screenshot({ path: `${out(info, "draw")}-share.png` });

  writeFileSync(`${out(info, "draw")}.json`, `${JSON.stringify({ project: info.project.name, ringed, url, stored: await offense(page) }, null, 2)}\n`);
});

test("a catch never goes forward or past the line, and follows its release when the QB drops back", async ({ page }, info) => {
  const d = new Designer(page);
  await seed(page, { plays: [TRICK] });
  await d.openSaved(TRICK.name);
  await expect(d.field.locator("[data-lateral]")).toHaveCount(2);
  const steps: Record<string, unknown>[] = [];

  // forward of where the QB lets it go (5 yards deep): level with the QB, with a shake and a flag note
  const forward = await dragCatch(d, "o2", [22, 2]);
  await expect(d.toast).toHaveText(forwardNote("QB"));
  await expect(d.toast).toHaveAttribute("data-flag", "true");
  await expect.poll(() => catchOf(page, "o2")).toEqual([22, 5]);
  steps.push({ drag: "Z's catch to the 2", shook: forward.shook, note: await d.toast.textContent(), catch: await catchOf(page, "o2") });
  expect(forward.shook).toBe(true);
  await page.screenshot({ path: `${out(info, "clamp")}-forward.png` });

  // past the line: still level with the QB, since that is where it lands
  await dragCatch(d, "o2", [20, -3]);
  await expect.poll(() => catchOf(page, "o2")).toEqual([20, 5]);
  steps.push({ drag: "Z's catch past the line", catch: await catchOf(page, "o2") });

  // the QB drops back to 7: Z's catch comes back with the release, and X's follows Z's
  await d.closeSidebars();
  const qb = await d.player("QB").boundingBox();
  if (!qb) throw new Error("no QB");
  const deep = await d.yardPoint(15, 7);
  await page.mouse.move(qb.x + qb.width / 2, qb.y + qb.height / 2);
  await page.mouse.down();
  await page.mouse.move(deep.x, deep.y, { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => [await catchOf(page, "o2"), await catchOf(page, "o5")]).toEqual([[20, 7], [9, 7]]);
  steps.push({ move: "QB to 7 yards deep", catches: [await catchOf(page, "o2"), await catchOf(page, "o5")] });
  await page.screenshot({ path: `${out(info, "clamp")}-reclamped.png` });

  // by keyboard: a step forward is snapped back and said the same way
  await handle(d, "o5").focus();
  await page.keyboard.press("ArrowUp");
  await expect(d.toast).toHaveText(forwardNote("Z"));
  await expect.poll(() => catchOf(page, "o5")).toEqual([9, 7]);
  await page.keyboard.press("ArrowLeft");
  await expect.poll(() => catchOf(page, "o5")).toEqual([8.5, 7]);

  // undo walks it all back: the catches come back with the QB
  await d.undo.click();
  await d.undo.click();
  await expect.poll(async () => [await catchOf(page, "o2"), await catchOf(page, "o5")]).toEqual([[20, 5], [9, 6.5]]);

  // a QB on the line lets it go on the line: a catch dragged past it lands on the line
  const onLine = await page.evaluate(() => JSON.parse(localStorage.getItem("ffpd.draft.v1") ?? "null") as { players: Player[] });
  expect(onLine.players.find((p) => p.id === "o2")?.y).toBe(5);
  // a drag snaps to the half yard, so the QB steps up to the line by keyboard, a yard a press
  await d.closeSidebars();
  await d.player("QB").focus();
  for (let i = 0; i < 5; i++) await page.keyboard.press("ArrowUp");
  await expect.poll(async () => (await storedDraft(page))?.players.find((p) => p.id === "o2")?.y).toBe(0.9);
  await dragCatch(d, "o2", [20, -3]);
  await expect(d.toast).toHaveText(LINE_NOTE);
  await expect.poll(() => catchOf(page, "o2")).toEqual([20, 0.9]);
  steps.push({ drag: "Z's catch past the line, the QB on it", note: LINE_NOTE, catch: await catchOf(page, "o2") });
  await page.screenshot({ path: `${out(info, "clamp")}-line.png` });

  writeFileSync(`${out(info, "clamp")}.json`, `${JSON.stringify({ project: info.project.name, steps }, null, 2)}\n`);
});

test("▶ tosses the ball back to each catch in turn, then throws it forward to the read", async ({ page }, info) => {
  const d = new Designer(page);
  await seed(page, { plays: [TRICK] });
  await d.openSaved(TRICK.name);
  await d.closeSidebars();
  await page.clock.install();
  await page.clock.pauseAt(new Date());
  await page.getByRole("button", { name: "Run the play" }).click();

  // the playback football (the arcs' footballs stay put), read back in yards from its transform
  const ball = d.field.locator("image[data-export='skip']");
  const samples: { t: number; x: number; y: number }[] = [];
  for (let t = 0; t <= 6000; t += 50) {
    if ((await ball.count()) === 0) break;
    const [transform, viewBox] = await Promise.all([ball.getAttribute("transform"), d.field.getAttribute("viewBox")]);
    const m = /translate\(([-\d.]+),([-\d.]+)\) scale\(([\d.]+)\)/.exec(transform ?? "");
    if (m && viewBox) {
      const top = 8 - Number(viewBox.split(" ")[3]) / S;
      const lift = (Number(m[3]) - 1) / 0.6;
      samples.push({ t, x: Number(m[1]) / S, y: (Number(m[2]) + lift * 16) / S + top });
    }
    await page.clock.runFor(50);
  }
  await page.clock.resume();
  const near = (s: { x: number; y: number }, p: Pair): boolean => Math.hypot(s.x - p[0], s.y - p[1]) < 0.6;
  // snapped back from the centre to the QB, who holds it at their spot, 5 yards deep
  const atQB = samples.findIndex((s) => Math.abs(s.x - 15) < 0.01 && Math.abs(s.y - 5) < 0.01);
  const atZ = samples.findIndex((s) => near(s, [22, 6]));
  const atX = samples.findIndex((s, i) => i > atZ && near(s, [9, 6.5]));
  const forward = samples.findIndex((s) => s.y < 0.9);
  writeFileSync(`${out(info, "playback")}.json`, `${JSON.stringify({ project: info.project.name, atQB, atZ, atX, forward, samples }, null, 2)}\n`);
  // the QB, Z's catch, then X's, all before the ball ever crosses the line, and then it goes downfield to Y
  expect(atQB).toBeGreaterThanOrEqual(0);
  expect(atZ).toBeGreaterThan(atQB);
  expect(atX).toBeGreaterThan(atZ);
  expect(forward).toBeGreaterThan(atX);
  // behind the line the whole time the ball is lateraled: never ahead of the QB's 5 until X has it
  expect(samples.slice(atQB, atX + 1).every((s) => s.y >= 5 - 0.01)).toBe(true);
  expect(Math.min(...samples.map((s) => s.y))).toBeLessThan(-10);
});

test("a play saved with a Pitch opens as the QB's lateral to the runner, who throws or keeps it", async ({ page }, info) => {
  // stored by a version before laterals, as the JSON it was
  const legacy = (id: string, name: string, routes: Record<string, unknown>): SavedPlay => {
    const p = play(id, name);
    return { ...p, players: p.players.map((q) => ({ ...q, route: (routes[q.id] ?? null) as Route | null })) };
  };
  const OPTION = legacy("fx-old-option", "Otter Old Option", { o5: { type: "pitch" }, o4: { type: "corner" } });
  const SWEEP = legacy("fx-old-sweep", "Otter Old Sweep", { o5: { type: "pitch" } });
  const d = new Designer(page);
  await seed(page, { plays: [OPTION, SWEEP], team: OTTERS });

  // the gallery draws the lateral on each thumbnail
  await page.goto("/playbooks");
  for (const p of [OPTION, SWEEP]) {
    const card = page.getByRole("link", { name: `Open ${p.name} in the designer` }).locator("xpath=..");
    await expect(card.getByRole("img").first().locator("[data-lateral]")).toHaveCount(1);
  }
  await page.screenshot({ path: `${out(info, "migration")}-gallery.png` });

  const read: Record<string, unknown> = {};
  await d.openSaved(OPTION.name);
  await expect.poll(() => offense(page)).toMatchObject({ QB: { type: "lateral", target: "o5" }, Z: { type: "throw" }, Y: { type: "corner" } });
  read[OPTION.name] = await offense(page);
  await d.select("Z");
  await expect(page.getByRole("heading", { name: "Z has the ball" })).toBeVisible();
  await expect(group(page, "With the ball").getByRole("button", { name: "Throw" })).toHaveAttribute("aria-pressed", "true");
  await page.screenshot({ path: `${out(info, "migration")}-option.png` });

  await d.openSaved(SWEEP.name);
  await expect.poll(() => offense(page)).toMatchObject({ QB: { type: "lateral", target: "o5" }, Z: { type: "stretch" } });
  read[SWEEP.name] = await offense(page);
  writeFileSync(`${out(info, "migration")}.json`, `${JSON.stringify({ project: info.project.name, read }, null, 2)}\n`);
});

test("from their 5 a chain that ends in a throw is a pass, never flagged, and one that ends in a keep is flagged", async ({ page }, info) => {
  const GOAL_LINE: SavedPlay = {
    ...play("fx-goal-line-lateral", "Otter Goal Line Lateral", { o2: { type: "lateral", target: "o5" }, o5: { type: "throw" }, o4: { type: "corner", primary: true } }),
    los: 35,
  };
  const d = new Designer(page);
  await seed(page, { plays: [GOAL_LINE], team: OTTERS });
  await d.openSaved(GOAL_LINE.name);
  const flag = d.field.locator("[data-no-run-flag]");
  await expect(d.field.locator("[data-lateral]")).toHaveCount(1);
  await expect(flag).toHaveCount(0);

  await d.select("Z");
  await d.pick("Reverse");
  await expect(flag).toHaveCount(1);
  await expect(d.toast).toHaveText("Flagged · run in a no-run zone");
  await d.closeSidebars();
  await page.screenshot({ path: `${out(info, "no-run")}-keep.png` });

  await d.select("Z");
  await d.pick("Throw");
  await expect(flag).toHaveCount(0);
  writeFileSync(`${out(info, "no-run")}.json`, `${JSON.stringify({ project: info.project.name, throwFlagged: false, keepFlagged: true, stored: await offense(page) }, null, 2)}\n`);
});
