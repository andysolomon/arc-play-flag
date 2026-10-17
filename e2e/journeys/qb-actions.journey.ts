import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";
import { writeFileSync } from "node:fs";
import { callOf } from "../../lib/play/call";
import { S } from "../../lib/play/geometry";
import { HOLD, buildMotion, simulationPlayback, type Motion } from "../../lib/play/motion";
import { LOS_GAP, PITCH_SET } from "../../lib/play/routes";
import type { Pair, Player, Route } from "../../lib/play/types";
import { Designer, downloadBytes } from "../support/designer";
import { OTTERS, moved, play, playbook, seed, storedDraft, storedPlays } from "../support/fixtures";
import { readDeck, readZip } from "../support/pptx";

/**
 * The quarterback's rollout and boot (docs/adr/011-qb-rollout-and-boot.md): the QB takes the snap, carries
 * the ball across behind the line to a launch point and throws from there; on a boot they fake the handoff
 * first and go the other way. Each test leaves what it saw as `test-results/qb-actions-<device>-<test>.json`
 * with pictures beside it, uploaded as `qb-actions`.
 */

test.use({ permissions: ["clipboard-read", "clipboard-write"] });

/** ▶ plays a simulation that throws to the read when Math.random() < 0.8: pinned, it plays the plan built here. */
const RANDOM = 0.1;
test.beforeEach(async ({ page }) => {
  await page.addInitScript((r) => { Math.random = () => r; }, RANDOM);
});

const out = (info: TestInfo, name: string): string => `test-results/qb-actions-${info.project.name}-${name}`;
const group = (page: Page, name: string): Locator => page.locator("#route-sidebar").getByRole("group", { name, exact: true });
const qbTile = (page: Page, label: "Rollout" | "Boot"): Locator => group(page, "Quarterback").getByRole("button", { name: label, exact: true });
const qbNote = (page: Page): Locator => page.locator("#route-sidebar [data-qb-note]");
const losSelect = (page: Page): Locator => page.locator("#play-sidebar").getByRole("combobox", { name: "Line of scrimmage" });

/** Where the ADR lays the paths out from the default QB spot (15, 5): measured from 5 yards deep, 8 yards over. */
const QB_SPOT: Pair = [15, 5];
const ROLL_RIGHT: Pair[] = [[17, 6.2], [20.5, 6.2], [23, 4.2]];
const ROLL_LEFT: Pair[] = [[13, 6.2], [9.5, 6.2], [7, 4.2]];
/** a boot away from a fake on the QB's right: it pivots back on the fake's side, bends behind the spot and runs out left */
const BOOT_LEFT: Pair[] = [[16, 6.6], [12, 7], [9, 6.4], [7, 4.2]];
const BOOT_RIGHT: Pair[] = [[14, 6.6], [18, 7], [21, 6.4], [23, 4.2]];
/**
 * from under centre, right behind the C as close as a teammate may stand (PLAYER_SPACING, lib/play/spacing.ts):
 * the fake there, then the path measured from 4 yards deep
 */
const UNDER_CENTRE: Pair = [15, 3];
const BOOT_LEFT_UNDER: Pair[] = [[16, 5.6], [12, 6], [9, 5.4], [7, 3.2]];
/** how long a play-action fake takes to sell, in seconds (lib/play/motion.ts) */
const FAKE = 0.25;

interface Pt { x: number; y: number }
const dist = (a: Pt, b: Pt): number => Math.hypot(a.x - b.x, a.y - b.y);
const pt = (q: Pair): Pt => ({ x: q[0], y: q[1] });
const ms = (seconds: number): number => Math.round(seconds * 1000);

async function offense(page: Page): Promise<Record<string, Route | null>> {
  const draft = await storedDraft(page);
  return Object.fromEntries((draft?.players ?? []).filter((p) => p.team === "offense").map((p) => [p.label, p.route]));
}

/** The yard value at the card's top edge, from the field's own viewBox, so a plan built here matches the app's. */
async function topOf(d: Designer): Promise<number> {
  const viewBox = await d.field.getAttribute("viewBox");
  if (!viewBox) throw new Error("the field has not laid out");
  return 8 - Number(viewBox.split(" ")[3]) / S;
}

/** A player's token, in yards, read from its transform. */
async function tokenAt(d: Designer, label: string): Promise<Pt> {
  const t = await d.player(label).getAttribute("transform");
  const m = /translate\(([-\d.]+),([-\d.]+)\)/.exec(t ?? "");
  if (!m?.[1] || !m[2]) throw new Error(`no transform on Offense ${label}`);
  return { x: Number(m[1]) / S, y: Number(m[2]) / S + (await topOf(d)) };
}

/** The playback football, in yards (the arcs' footballs stay put, this one rides with the ball). */
async function ballAt(d: Designer): Promise<Pt> {
  const ball = d.field.locator("image[data-export='skip']");
  const transform = await ball.getAttribute("transform");
  const m = /translate\(([-\d.]+),([-\d.]+)\) scale\(([\d.]+)\)/.exec(transform ?? "");
  if (!m?.[1] || !m[2] || !m[3]) throw new Error("no playback football");
  const lift = (Number(m[3]) - 1) / 0.6;
  return { x: Number(m[1]) / S, y: (Number(m[2]) + lift * 16) / S + (await topOf(d)) };
}

/** The ring the throw leaves from, in yards: the one a rollout or boot ends in. */
async function ringAt(d: Designer): Promise<Pt> {
  const ring = d.field.locator("circle[data-set]");
  await expect(ring).toHaveCount(1);
  const [cx, cy] = await Promise.all([ring.getAttribute("cx"), ring.getAttribute("cy")]);
  return { x: Number(cx) / S, y: Number(cy) / S + (await topOf(d)) };
}

/** The tips of the arrowheads drawn on the field, in yards. */
async function arrowTips(d: Designer): Promise<Pt[]> {
  const top = await topOf(d);
  const points = await d.field.locator("polygon").evaluateAll((els) => els.map((el) => el.getAttribute("points") ?? ""));
  return points.flatMap((p) => {
    const m = /^([-\d.]+),([-\d.]+)/.exec(p);
    return m?.[1] && m[2] ? [{ x: Number(m[1]) / S, y: Number(m[2]) / S + top }] : [];
  });
}

/** The drawn route that ends at the ring, in yards: the QB's. Its stroke starts a step out from the token. */
async function qbPath(d: Designer): Promise<Pair[]> {
  const ring = await ringAt(d);
  const top = await topOf(d);
  for (const path of await d.routes.all()) {
    const yards = [...((await path.getAttribute("d")) ?? "").matchAll(/([-\d.]+) ([-\d.]+)/g)]
      .map((m) => [Number(m[1]) / S, Number(m[2]) / S + top] as const);
    const last = yards.at(-1);
    if (last && dist(pt(last), ring) < 0.05) return yards;
  }
  throw new Error("no drawn route ends at the ring");
}

/** The path matches the ADR's legs after the token, every vertex behind the line, the launch point deep enough. */
function expectLegs(drawn: readonly Pair[], legs: readonly Pair[]): void {
  expect(drawn.length).toBe(legs.length + 1);
  drawn.slice(1).forEach((q, i) => {
    const want = legs[i];
    if (!want) throw new Error("more vertices than legs");
    expect(dist(pt(q), pt(want)), `vertex ${String(i + 1)} at ${q.join(",")}`).toBeLessThan(0.06);
  });
  for (const q of drawn) {
    expect(q[1]).toBeGreaterThanOrEqual(LOS_GAP);
    expect(q[1]).toBeLessThanOrEqual(7.4);
  }
  expect(drawn.at(-1)?.[1] ?? 0).toBeGreaterThanOrEqual(PITCH_SET);
}

/** The plan the app's ▶ builds for the stored draft, with the page's pinned random. */
async function plan(d: Designer): Promise<{ players: Player[]; motion: Motion }> {
  const players = (await storedDraft(d.page))?.players ?? [];
  return { players, motion: buildMotion(players, await topOf(d), simulationPlayback(() => RANDOM)) };
}

/** Drags a player's token to a yard point. */
async function dragToken(d: Designer, label: string, to: Pair): Promise<void> {
  await d.closeSidebars();
  const box = await d.player(label).boundingBox();
  if (!box) throw new Error(`no token for ${label}`);
  const target = await d.yardPoint(to[0], to[1]);
  await d.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await d.page.mouse.down();
  await d.page.mouse.move(target.x, target.y, { steps: 8 });
  await d.page.mouse.up();
}

/** Freezes the page's clock and presses ▶. Each step then runs the clock on to a moment of the plan. */
async function startPlayback(d: Designer): Promise<{ to: (seconds: number) => Promise<void> }> {
  await d.closeSidebars();
  await d.page.clock.install();
  await d.page.clock.pauseAt(new Date());
  await d.page.getByRole("button", { name: "Run the play" }).click();
  let now = 0;
  return {
    to: async (seconds) => {
      await d.page.clock.runFor(Math.max(0, ms(seconds) - now));
      now = Math.max(now, ms(seconds));
    },
  };
}

/** Runs the clock past the end of the play and hands it back. */
async function finish(d: Designer, m: Motion, clock: { to: (seconds: number) => Promise<void> }): Promise<void> {
  await clock.to(m.dur + 1);
  await expect(d.page.getByRole("button", { name: "Run the play" })).toBeVisible();
  await d.page.clock.resume();
}

test("a rollout: the QB takes the snap, rolls out right behind the line and throws from the ring", async ({ page }, info) => {
  const d = new Designer(page);
  await d.goto();
  await d.setName("Otters Sprint Right");

  // the QB group is the quarterback's own: not the C's, who snaps it, nor a receiver's
  const offered: Record<string, boolean> = {};
  for (const label of ["QB", "C", "X"]) {
    await d.select(label);
    offered[label] = (await group(page, "Quarterback").count()) === 1;
  }
  expect(offered).toEqual({ QB: true, C: false, X: false });

  // Y curls as the read, X clears with a Go, and the QB rolls out to throw
  await d.select("Y");
  await d.pick("Curl");
  await d.palette();
  await d.primaryButton.click();
  await d.select("X");
  await d.pick("Go");
  await d.select("QB");
  await expect(qbTile(page, "Rollout")).toHaveAttribute("aria-pressed", "false");
  await expect(qbTile(page, "Boot")).toHaveAttribute("aria-pressed", "false");
  await d.pick("Rollout");
  await d.palette();
  await expect(qbTile(page, "Rollout")).toHaveAttribute("aria-pressed", "true");
  await expect(qbNote(page)).toContainText("rolls out right");
  await expect.poll(() => offense(page)).toMatchObject({ QB: { type: "rollout" }, Y: { type: "curl", primary: true }, X: { type: "go" } });
  // a rollout can be mirrored, and the quarterback is never the read
  await expect(d.mirrorButton).toBeVisible();
  await expect(d.primaryButton).toHaveCount(0);
  await page.screenshot({ path: `${out(info, "rollout")}-palette.png` });

  // drawn from the QB's spot: open and gain depth, across, then up to the ring 8 yards over, all behind the line
  await d.closeSidebars();
  const drawn = await qbPath(d);
  expectLegs(drawn, ROLL_RIGHT);
  const ring = await ringAt(d);
  expect(dist(ring, pt([23, 4.2]))).toBeLessThan(0.05);
  await expect(d.field.locator("desc")).toContainText("rolls out right");
  await page.screenshot({ path: `${out(info, "rollout")}-drawn.png` });

  // ▶ with the page's clock frozen: the QB waits for the snap, carries the ball out to the ring, throws from it, and Y catches
  const { players, motion: m } = await plan(d);
  expect(callOf(players)).toBe("pass");
  expect({ kind: m.kind, passer: m.passer, receiver: m.receiver, runner: m.runner }).toEqual({ kind: "pass", passer: "o2", receiver: "o4", runner: null });
  expect(m.throwAt).toBeGreaterThan(m.snapAt);
  const clock = await startPlayback(d);
  await clock.to(m.snapAt * 0.6);
  const snapping = { QB: await tokenAt(d, "QB"), ball: await ballAt(d) };
  expect(dist(snapping.QB, pt(QB_SPOT))).toBeLessThan(0.01);
  expect(snapping.ball.y).toBeLessThan(QB_SPOT[1]);
  await clock.to((m.snapAt + m.throwAt) / 2);
  const rolling = { QB: await tokenAt(d, "QB"), ball: await ballAt(d) };
  expect(rolling.QB.x).toBeGreaterThan(15.5);
  expect(rolling.QB.x).toBeLessThan(23);
  expect(rolling.QB.y).toBeGreaterThanOrEqual(LOS_GAP);
  expect(dist(rolling.ball, rolling.QB)).toBeLessThan(0.3);
  await clock.to(m.throwAt - 0.01);
  const launch = { QB: await tokenAt(d, "QB"), ball: await ballAt(d) };
  expect(dist(launch.QB, ring)).toBeLessThan(0.3);
  expect(dist(launch.ball, launch.QB)).toBeLessThan(0.3);
  await clock.to((m.throwAt + m.catchAt) / 2);
  const flying = { QB: await tokenAt(d, "QB"), Y: await tokenAt(d, "Y"), ball: await ballAt(d) };
  expect(dist(flying.ball, flying.QB)).toBeGreaterThan(1);
  await page.screenshot({ path: `${out(info, "rollout")}-throw.png` });
  await clock.to(m.catchAt + 0.05);
  const caught = { Y: await tokenAt(d, "Y"), ball: await ballAt(d) };
  expect(dist(caught.ball, caught.Y)).toBeLessThan(0.3);
  await finish(d, m, clock);
  expect(dist(await tokenAt(d, "QB"), pt(QB_SPOT))).toBeLessThan(0.01);

  // ⇄ Mirror rolls left; the link carries it to a cleared device
  await d.select("QB");
  await d.mirrorButton.click();
  await expect.poll(() => offense(page)).toMatchObject({ QB: { type: "rollout", mirror: true } });
  await d.palette();
  await expect(qbNote(page)).toContainText("rolls out left");
  await d.closeSidebars();
  expectLegs(await qbPath(d), ROLL_LEFT);
  await d.save();
  await d.clickTool("Copy share link");
  const dialog = page.getByRole("dialog", { name: "Share snapshot" });
  await expect(dialog.locator("circle")).not.toHaveCount(0);
  await dialog.getByRole("button", { name: "Copy snapshot link" }).click();
  const url = await page.evaluate(() => navigator.clipboard.readText());
  const id = new URL(url).pathname.replace(/^\/p\//, "");
  await page.evaluate(() => { localStorage.clear(); });
  await d.goto(`?p=${id}`);
  await expect.poll(() => offense(page)).toMatchObject({ QB: { type: "rollout", mirror: true } });
  expectLegs(await qbPath(d), ROLL_LEFT);
  await page.screenshot({ path: `${out(info, "rollout")}-shared.png` });

  // Flip play turns it back to the right, though the QB stands in the middle of the field
  await d.clickTool("Flip play");
  await d.closeSidebars();
  await expect.poll(async () => (await offense(page)).QB).toEqual({ type: "rollout" });
  const flipped = await qbPath(d);
  expectLegs(flipped, ROLL_RIGHT);
  await d.save();
  await page.reload();
  await expect.poll(() => storedPlays(page).then((lib) => Object.values(lib)[0]?.players.find((p) => p.id === "o2")?.route)).toEqual({ type: "rollout" });

  writeFileSync(`${out(info, "rollout")}.json`, `${JSON.stringify({
    project: info.project.name, offered, drawn, ring, flipped,
    plan: { snapAt: m.snapAt, throwAt: m.throwAt, catchAt: m.catchAt, dur: m.dur },
    snapping, rolling, launch, flying, caught, stored: await offense(page),
  }, null, 2)}\n`);
});

test("a boot: the QB fakes the dive to Z, then boots out the other way to throw", async ({ page }, info) => {
  const d = new Designer(page);
  await d.goto();
  await d.setName("Otters Boot Left");

  // with nothing to fake, a boot goes right and the palette says so; it is never mirrored
  await d.select("QB");
  await d.pick("Boot");
  await d.palette();
  await expect(qbTile(page, "Boot")).toHaveAttribute("aria-pressed", "true");
  await expect(qbNote(page)).toContainText("Nothing to fake yet");
  await expect(d.mirrorButton).toHaveCount(0);
  await expect(d.primaryButton).toHaveCount(0);
  await d.closeSidebars();
  const naked = await qbPath(d);
  expectLegs(naked, BOOT_RIGHT);

  // Z's dive is the fake: it goes up on the QB's right, so the boot turns to the left
  await d.select("Z");
  await d.pick("Dive");
  await d.select("Y");
  await d.pick("Drag");
  await d.palette();
  await d.primaryButton.click();
  await d.select("X");
  await d.pick("Go");
  await expect.poll(() => offense(page)).toMatchObject({ QB: { type: "boot" }, Z: { type: "dive" }, Y: { type: "drag", primary: true } });
  await d.select("QB");
  await expect(qbNote(page)).toContainText("fakes the handoff to Z, then boots out the other way, to the left");
  await expect(qbNote(page)).toContainText("Flip the play to boot right, or pick Rollout to go with the fake.");
  await d.closeSidebars();
  const drawn = await qbPath(d);
  expectLegs(drawn, BOOT_LEFT);
  await expect(d.field.locator("desc")).toContainText("fakes the handoff to Z, then boots left");
  await page.screenshot({ path: `${out(info, "boot")}-drawn.png` });

  // ▶: the QB fakes from their spot while the ball dips to Z and back, then boots left with it and throws to Y
  const { players, motion: m } = await plan(d);
  expect(callOf(players)).toBe("play-action");
  expect({ kind: m.kind, passer: m.passer, receiver: m.receiver, runner: m.runner }).toEqual({ kind: "pass", passer: "o2", receiver: "o4", runner: "o5" });
  expect(m.handAt).toBeGreaterThanOrEqual(m.snapAt);
  expect(m.throwAt).toBeGreaterThan(m.handAt + FAKE);
  const ring = await ringAt(d);
  const clock = await startPlayback(d);
  await clock.to(m.handAt);
  const fake = { QB: await tokenAt(d, "QB"), Z: await tokenAt(d, "Z"), ball: await ballAt(d) };
  expect(dist(fake.QB, pt(QB_SPOT))).toBeLessThan(0.01);
  expect(dist(fake.ball, fake.QB)).toBeGreaterThan(0.2);
  expect(dist(fake.ball, fake.Z)).toBeLessThan(dist(fake.QB, fake.Z));
  await page.screenshot({ path: `${out(info, "boot")}-fake.png` });
  await clock.to(m.handAt + FAKE - 0.02);
  const sold = { QB: await tokenAt(d, "QB") };
  expect(dist(sold.QB, pt(QB_SPOT))).toBeLessThan(0.01);
  await clock.to(m.throwAt - 0.01);
  const launch = { QB: await tokenAt(d, "QB"), ball: await ballAt(d) };
  expect(dist(launch.QB, ring)).toBeLessThan(0.3);
  expect(dist(launch.ball, launch.QB)).toBeLessThan(0.3);
  await clock.to(m.catchAt + 0.05);
  const caught = { Y: await tokenAt(d, "Y"), ball: await ballAt(d) };
  expect(dist(caught.ball, caught.Y)).toBeLessThan(0.3);
  await page.screenshot({ path: `${out(info, "boot")}-caught.png` });
  await finish(d, m, clock);

  // with no read marked, a boot is still a pass: the simulation never hands it off by chance
  const unmarked = players.map((p) => (p.route?.primary ? { ...p, route: { type: p.route.type } } : p));
  const coin = [0.1, 0.3, 0.49].map((r) => buildMotion(unmarked, -16, simulationPlayback(() => r)).kind);
  expect(coin).toEqual(["pass", "pass", "pass"]);

  // flipped, Z dives on the QB's left and the boot goes right; undo puts it back
  await d.clickTool("Flip play");
  await d.closeSidebars();
  const flipped = await qbPath(d);
  expectLegs(flipped, BOOT_RIGHT);
  await d.undo.click();
  await d.closeSidebars();
  expectLegs(await qbPath(d), BOOT_LEFT);

  // a boot is a pass: with the ball on the 5 nothing is flagged, until the read is moved onto the dive
  await d.tools();
  await losSelect(page).selectOption("35");
  await expect(d.field.locator("[data-no-run-flag]")).toHaveCount(0);
  await d.select("Z");
  await d.primaryButton.click();
  await expect.poll(() => offense(page)).toMatchObject({ Z: { type: "dive", primary: true }, QB: { type: "boot" } });
  await expect(d.field.locator("[data-no-run-flag]")).toHaveCount(1);
  await d.closeSidebars();
  // the QB throws nothing now: the decoy ends in an arrowhead where the ring was, not the ring
  await expect(d.field.locator("circle[data-set]")).toHaveCount(0);
  const decoyTip = (await arrowTips(d)).find((t) => dist(t, ring) < 0.15);
  expect(decoyTip, "an arrowhead at the end of the decoy").toBeDefined();
  await expect(d.field.locator("desc")).toContainText("hands off to Z, then boots left as a decoy");
  await d.select("QB");
  await expect(qbNote(page)).toContainText("hands off to Z, then boots left as a decoy. To throw instead, mark a receiver as the read.");
  await d.closeSidebars();
  await page.screenshot({ path: `${out(info, "boot")}-decoy.png` });

  // a run now: Z takes the handoff at the mesh, then the QB carries out the boot without the ball
  const decoyPlan = await plan(d);
  const r = decoyPlan.motion;
  expect(callOf(decoyPlan.players)).toBe("run");
  expect({ kind: r.kind, runner: r.runner }).toEqual({ kind: "run", runner: "o5" });
  const run = await startPlayback(d);
  await run.to(r.handAt + r.handFor + 0.05);
  const handed = { QB: await tokenAt(d, "QB"), Z: await tokenAt(d, "Z"), ball: await ballAt(d) };
  expect(dist(handed.ball, handed.Z)).toBeLessThan(0.3);
  await run.to(r.dur - HOLD);
  const decoy = { QB: await tokenAt(d, "QB"), Z: await tokenAt(d, "Z"), ball: await ballAt(d) };
  expect(dist(decoy.QB, ring)).toBeLessThan(0.3);
  expect(dist(decoy.ball, decoy.Z)).toBeLessThan(0.3);
  await finish(d, r, run);

  // the ball can't come to a carrier by a boot: a lateral from the QB replaces it, and undo brings it back
  await d.select("QB");
  await d.pick("Lateral");
  await d.foldOverlays();
  await d.field.getByRole("button", { name: "Offense X, can take the lateral", exact: true }).click();
  await expect(page.getByRole("heading", { name: "X has the ball" })).toBeVisible();
  await expect(group(page, "Quarterback")).toHaveCount(0);
  await expect.poll(async () => (await offense(page)).QB).toBeNull();
  const afterLateral = await offense(page);
  // and the QB taking it back (QB → X → QB) is a carrier: no QB group for their second time with the ball
  await d.pick("Lateral");
  await d.foldOverlays();
  await d.field.getByRole("button", { name: "Offense QB, can take the lateral", exact: true }).click();
  await expect(page.getByRole("heading", { name: "QB has it again" })).toBeVisible();
  await expect(group(page, "Quarterback")).toHaveCount(0);
  await d.undo.click();
  await d.undo.click();
  await expect.poll(async () => (await offense(page)).QB).toEqual({ type: "boot" });
  await expect.poll(async () => (await storedDraft(page))?.players.find((p) => p.id === "o2")?.laterals).toBeUndefined();

  writeFileSync(`${out(info, "boot")}.json`, `${JSON.stringify({
    project: info.project.name, naked, drawn, ring, flipped,
    plan: { snapAt: m.snapAt, handAt: m.handAt, throwAt: m.throwAt, catchAt: m.catchAt, dur: m.dur },
    fake, sold, launch, caught,
    decoyPlan: { kind: r.kind, handAt: r.handAt, handFor: r.handFor, dur: r.dur }, decoyTip, handed, decoy,
    coin, afterLateral, afterUndo: await offense(page),
  }, null, 2)}\n`);
});

test("a boot fakes to the first runner to reach the QB, flips with the play, and fakes from under centre", async ({ page }, info) => {
  const d = new Designer(page);
  await d.goto();
  await d.setName("Otters Boot Reverse");

  // X's reverse comes the long way round behind the QB; Z's dive gets there first, so Z is the fake
  await d.select("X");
  await d.pick("Reverse");
  await d.select("Z");
  await d.pick("Dive");
  await d.select("Y");
  await d.pick("Drag");
  await d.palette();
  await d.primaryButton.click();
  await d.select("QB");
  await d.pick("Boot");
  await d.palette();
  await expect(qbNote(page)).toContainText("fakes the handoff to Z, then boots out the other way, to the left");
  await d.closeSidebars();
  const drawn = await qbPath(d);
  expectLegs(drawn, BOOT_LEFT);
  const before = await plan(d);
  expect({ runner: before.motion.runner, kind: before.motion.kind }).toEqual({ runner: "o5", kind: "pass" });

  // flipped, X lines up on the right and Z on the left: still Z first, so the boot turns right and keeps its fake
  await d.clickTool("Flip play");
  await d.select("QB");
  // a Rollout goes right as it is, so with a fake to the left it has to be mirrored to go with it
  await expect(qbNote(page)).toContainText("fakes the handoff to Z, then boots out the other way, to the right");
  await expect(qbNote(page)).toContainText("Flip the play to boot left, or pick Rollout and ⇄ Mirror it to go with the fake.");
  await d.closeSidebars();
  await expect(d.field.locator("desc")).toContainText("fakes the handoff to Z, then boots right");
  const flipped = await qbPath(d);
  expectLegs(flipped, BOOT_RIGHT);
  const after = await plan(d);
  expect(after.motion.runner).toBe("o5");
  await page.screenshot({ path: `${out(info, "two-runners")}-flipped.png` });

  // under centre the QB fakes two yards behind the C, the closest a teammate stands, then drops and boots
  await d.undo.click();
  await dragToken(d, "QB", UNDER_CENTRE);
  await expect.poll(async () => (await storedDraft(page))?.players.find((p) => p.id === "o2")).toMatchObject({ x: UNDER_CENTRE[0], y: UNDER_CENTRE[1] });
  const under = await qbPath(d);
  expectLegs(under, BOOT_LEFT_UNDER);
  const { motion: m } = await plan(d);
  expect({ runner: m.runner, kind: m.kind }).toEqual({ runner: "o5", kind: "pass" });
  const ring = await ringAt(d);
  const clock = await startPlayback(d);
  await clock.to(m.handAt);
  const fake = { QB: await tokenAt(d, "QB"), Z: await tokenAt(d, "Z"), ball: await ballAt(d) };
  expect(dist(fake.QB, pt(UNDER_CENTRE))).toBeLessThan(0.01);
  expect(dist(fake.ball, fake.Z)).toBeLessThan(dist(fake.QB, fake.Z));
  await clock.to(m.throwAt - 0.01);
  const launch = { QB: await tokenAt(d, "QB"), ball: await ballAt(d) };
  expect(dist(launch.QB, ring)).toBeLessThan(0.3);
  expect(dist(launch.ball, launch.QB)).toBeLessThan(0.3);
  await page.screenshot({ path: `${out(info, "two-runners")}-under-centre.png` });
  await finish(d, m, clock);

  // Z lined up straight behind the QB dives to the right flipped or not, so Flip play can't turn the boot: Mirror on the dive does
  await dragToken(d, "Z", [15, 6]);
  await expect.poll(async () => (await storedDraft(page))?.players.find((p) => p.id === "o5")).toMatchObject({ x: 15, y: 6 });
  await d.select("QB");
  await expect(qbNote(page)).toContainText("to the left");
  await expect(qbNote(page)).toContainText("⇄ Mirror Z's run to boot right");

  writeFileSync(`${out(info, "two-runners")}.json`, `${JSON.stringify({
    project: info.project.name, drawn, flipped, under, ring,
    runners: { before: before.motion.runner, after: after.motion.runner },
    plan: { snapAt: m.snapAt, handAt: m.handAt, throwAt: m.throwAt, catchAt: m.catchAt, dur: m.dur },
    fake, launch, stored: await offense(page),
  }, null, 2)}\n`);
});

/** A rollout, a boot off a fake, and the same boot with the read on the run, in a book. */
const SPRINT = play("fx-sprint-right", "Otter Sprint Right", { o2: { type: "rollout" }, o4: { type: "curl", primary: true }, o3: { type: "go" } });
const BOOT = play("fx-boot-left", "Otter Boot Left", { o5: { type: "dive" }, o2: { type: "boot" }, o4: { type: "drag", primary: true }, o3: { type: "go" } });
const BOOT_RUN = play("fx-boot-dive", "Otter Boot Dive", { o5: { type: "dive", primary: true }, o2: { type: "boot" }, o3: { type: "go" } });
/** The jet is the read on the 5, Z steps up to the line: the QB boots left as a decoy through the corner the flag would sit in. */
const JET_BOOT = { ...moved(play("fx-jet-boot", "Otter Jet Boot", { o3: { type: "jet", primary: true }, o2: { type: "boot" }, o4: { type: "go" } }), { o5: { x: 22, y: 1 } }), los: 35 };
const BOOK = playbook("fx-boot-book", "Otter Boot Book", [SPRINT, BOOT, BOOT_RUN, JET_BOOT]);

test("the slides say what the QB does: rolls out, boots off the fake, or hands off and boots as a decoy", async ({ page }, info) => {
  test.setTimeout(120_000);
  await seed(page, { plays: [SPRINT, BOOT, BOOT_RUN, JET_BOOT], playbooks: [BOOK], team: OTTERS });
  await page.goto("/playbooks?book=fx-boot-book");
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 60_000 }),
    page.getByRole("button", { name: "Download slides" }).click(),
  ]);
  // kept under this journey's own name: the slides journey keeps its deck as slides-<device>.pptx beside it
  const raw = await downloadBytes(download);
  writeFileSync(`${out(info, "slides")}.pptx`, raw);
  const deck = await readDeck(page, readZip(raw));
  const notes: Record<string, string | null> = Object.fromEntries(
    deck.slides.filter((s) => /^\d+ · /.test(s.title ?? "")).map((s) => [s.title ?? "", s.notes] as const),
  );
  expect(notes).toEqual({
    "1 · Otter Sprint Right":
      "1 · Otter Sprint Right · Pass\n\nPass: QB rolls out right and throws. Primary read: Y (Curl).\n\n" +
      "Left to right:\nX: Go\nC: Snap\nQB: Roll out right, throw, look to Y first\nZ: No route\nY: Curl (primary read)",
    "2 · Otter Boot Left":
      "2 · Otter Boot Left · Play-action\n\nPlay-action: fake to Z, QB boots left, then throws. Primary read: Y (Drag).\n\n" +
      "Left to right:\nX: Go\nC: Snap\nQB: Fake to Z, boot left, throw, look to Y first\nZ: Dive\nY: Drag (primary read)",
    "3 · Otter Boot Dive":
      "3 · Otter Boot Dive · Run\n\nRun: Z takes it (Dive). QB hands off, then boots left as a decoy.\n\n" +
      "Left to right:\nX: Go\nC: Snap\nQB: Hand off to Z, then boot left as a decoy\nZ: Dive (primary read)\nY: No route",
    "4 · Otter Jet Boot":
      "4 · Otter Jet Boot · Run\n\nRun: X takes it (Jet sweep). QB hands off, then boots left as a decoy.\n\nFlagged: run in a no-run zone.\n\n" +
      "Left to right:\nX: Jet sweep (primary read)\nC: Snap\nQB: Hand off to X, then boot left as a decoy\nZ: No route\nY: Go",
  });

  // in the play's pictures the flag keeps off the decoy's path: the QB boots through the left corner, so it goes right
  await page.goto("/playbooks");
  const card = page.getByRole("link", { name: "Open Otter Jet Boot in the designer" }).locator("xpath=..");
  const stamp = card.getByRole("img").first().locator("[data-no-run-flag] rect");
  await expect(stamp).toHaveCount(1);
  const stampX = Number(await stamp.getAttribute("x"));
  expect(stampX).toBeGreaterThan(330);
  await card.screenshot({ path: `${out(info, "slides")}-jet-boot-card.png` });
  writeFileSync(`${out(info, "slides")}.json`, `${JSON.stringify({ project: info.project.name, notes, stampX }, null, 2)}\n`);
});
