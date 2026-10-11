import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";
import { writeFileSync } from "node:fs";
import { callOf } from "../../lib/play/call";
import { S } from "../../lib/play/geometry";
import { HOLD, buildMotion, type Motion } from "../../lib/play/motion";
import { JET_GAP, LOS_GAP } from "../../lib/play/routes";
import type { Pair, Player, Route } from "../../lib/play/types";
import { Designer } from "../support/designer";
import { storedDraft, storedPlays } from "../support/fixtures";

/**
 * The jet sweep (docs/adr/006-jet-sweep.md): a receiver is already crossing the formation behind the line
 * when the ball is snapped, and the quarterback hands it off as they pass. In flag football a forward pass
 * to a player behind the line isn't allowed, so it is always a handoff. Each test leaves what it saw as
 * `test-results/jet-sweep-<device>-<test>.json` with pictures beside it, uploaded as `jet-sweep`.
 */

const out = (info: TestInfo, name: string): string => `test-results/jet-sweep-${info.project.name}-${name}`;
const group = (page: Page, name: string): Locator => page.locator("#route-sidebar").getByRole("group", { name, exact: true });
const jetTile = (page: Page): Locator => group(page, "Runs").getByRole("button", { name: "Jet sweep", exact: true });
const losSelect = (page: Page): Locator => page.locator("#play-sidebar").getByRole("combobox", { name: "Line of scrimmage" });

interface Pt { x: number; y: number }
const dist = (a: Pt, b: Pt): number => Math.hypot(a.x - b.x, a.y - b.y);
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

/** The one drawn route's vertices, in yards: the stroke starts a step out from the token and stops inside the arrowhead. */
async function routeYards(d: Designer): Promise<Pair[]> {
  await expect(d.routes).toHaveCount(1);
  const path = await d.routes.getAttribute("d");
  const top = await topOf(d);
  return [...(path ?? "").matchAll(/([-\d.]+) ([-\d.]+)/g)].map((m) => [Number(m[1]) / S, Number(m[2]) / S + top] as const);
}

/** The plan the app's ▶ builds for the stored draft: with one runner and one read it has no coin flips. */
async function plan(d: Designer): Promise<{ players: Player[]; motion: Motion }> {
  const players = (await storedDraft(d.page))?.players ?? [];
  return { players, motion: buildMotion(players, await topOf(d)) };
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

test("a receiver's jet sweep crosses behind the line before the snap and takes the handoff in stride", async ({ page }, info) => {
  const d = new Designer(page);
  await d.goto();
  await d.setName("Otters Jet Sweep");

  // only a player who can take a handoff at the snap is offered one: not the QB, who hands it off, nor the C, who snaps
  const offered: Record<string, boolean> = {};
  for (const label of ["QB", "C", "X"]) {
    await d.select(label);
    offered[label] = (await jetTile(page).count()) === 1;
  }
  expect(offered).toEqual({ QB: false, C: false, X: true });
  await d.pick("Jet sweep");
  // a phone's palette folds away after a pick; open it again to read it
  await d.palette();
  await expect(jetTile(page)).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#route-sidebar [data-jet-note]")).toContainText("always a handoff");
  await expect.poll(() => offense(page)).toMatchObject({ X: { type: "jet" } });
  // a sweep always crosses toward the far side, so there is nothing to mirror; like any run it can be the read
  await expect(d.mirrorButton).toHaveCount(0);
  await expect(d.primaryButton).toBeVisible();
  await page.screenshot({ path: `${out(info, "sweep")}-palette.png` });

  // drawn from X's spot into the lane in front of the QB, across past the QB behind the line, then up past it
  await d.closeSidebars();
  const drawn = await routeYards(d);
  const lane = 5 - JET_GAP;
  const behind = drawn.filter((q) => q[1] > 0);
  expect(drawn.length).toBeGreaterThanOrEqual(4);
  expect(Math.min(...behind.map((q) => q[0]))).toBeLessThan(15);
  expect(Math.max(...behind.map((q) => q[0]))).toBeGreaterThan(15);
  // into the lane 3 yards short of the QB, and out of it a yard past them
  expect(behind.some((q) => Math.abs(q[1] - lane) < 0.05 && Math.abs(q[0] - 12) < 0.05)).toBe(true);
  expect(behind.some((q) => Math.abs(q[1] - lane) < 0.05 && Math.abs(q[0] - 16) < 0.05)).toBe(true);
  for (const q of drawn.slice(0, -1)) expect(q[1]).toBeGreaterThanOrEqual(LOS_GAP);
  expect(drawn.at(-1)?.[1] ?? 0).toBeLessThan(-3);
  await page.screenshot({ path: `${out(info, "sweep")}-drawn.png` });

  // ▶ with the page's clock frozen: X is on the move while everyone else and the ball hold, the snap comes
  // as X nears the QB, the handoff lands behind the line, and the ball rides with X to the end
  const { motion: m } = await plan(d);
  expect(m.kind).toBe("run");
  expect(m.runner).toBe("o3");
  expect(m.jetLead).toBeGreaterThan(0.5);
  expect(m.handAt).toBeGreaterThanOrEqual(m.snapAt);
  const clock = await startPlayback(d);
  await clock.to(m.jetLead / 2);
  const midLead = { X: await tokenAt(d, "X"), Y: await tokenAt(d, "Y"), QB: await tokenAt(d, "QB"), ball: await ballAt(d) };
  expect(midLead.X.x).toBeGreaterThan(3.5);
  expect(midLead.X.y).toBeGreaterThanOrEqual(LOS_GAP - 0.01);
  expect(dist(midLead.Y, { x: 27, y: 1 })).toBeLessThan(0.01);
  expect(dist(midLead.QB, { x: 15, y: 5 })).toBeLessThan(0.01);
  expect(dist(midLead.ball, { x: 15, y: 1 })).toBeLessThan(0.05);
  await clock.to((m.preSnapFor ?? 0) - 0.1);
  const beforeSnap = { X: await tokenAt(d, "X"), ball: await ballAt(d) };
  expect(beforeSnap.X.x).toBeLessThan(15);
  expect(dist(beforeSnap.ball, { x: 15, y: 1 })).toBeLessThan(0.05);
  await clock.to(m.handAt + m.handFor + 0.05);
  const handed = { X: await tokenAt(d, "X"), ball: await ballAt(d) };
  expect(dist(handed.ball, handed.X)).toBeLessThan(0.3);
  expect(handed.ball.y).toBeGreaterThanOrEqual(LOS_GAP - 0.05);
  expect(handed.X.x).toBeGreaterThan(15);
  await page.screenshot({ path: `${out(info, "sweep")}-handoff.png` });
  await clock.to(m.dur - HOLD);
  const end = { X: await tokenAt(d, "X"), ball: await ballAt(d) };
  expect(end.X.y).toBeLessThan(-4);
  expect(dist(end.ball, end.X)).toBeLessThan(0.3);
  await clock.to(m.dur + 1);
  await expect(page.getByRole("button", { name: "Run the play" })).toBeVisible();
  expect(dist(await tokenAt(d, "X"), { x: 3, y: 1 })).toBeLessThan(0.01);
  await page.clock.resume();

  // saved, it reloads the same; flipped, X sweeps the other way, past the QB's other hip
  await d.save();
  await page.reload();
  await expect.poll(() => storedPlays(page).then((lib) => Object.values(lib)[0]?.players.find((p) => p.id === "o3")?.route)).toEqual({ type: "jet" });
  await d.clickTool("Flip play");
  await d.closeSidebars();
  const flipped = await routeYards(d);
  expect(dist(await tokenAt(d, "X"), { x: 27, y: 1 })).toBeLessThan(0.01);
  expect(flipped.some((q) => Math.abs(q[1] - lane) < 0.05 && Math.abs(q[0] - 14) < 0.05)).toBe(true);
  expect(flipped.at(-1)?.[0] ?? 15).toBeLessThan(15);

  // a handoff is a run: with the ball on the 5 the tile is hatched and the field wears the no-run flag
  await d.tools();
  await losSelect(page).selectOption("35");
  await expect(d.field.locator("[data-no-run-flag]")).toHaveCount(1);
  await d.select("X");
  await expect(jetTile(page)).toHaveAttribute("data-hatched", "true");
  await d.closeSidebars();
  await page.screenshot({ path: `${out(info, "sweep")}-no-run.png` });

  writeFileSync(`${out(info, "sweep")}.json`, `${JSON.stringify({
    project: info.project.name, offered, drawn, flipped,
    plan: { jetLead: m.jetLead, preSnapFor: m.preSnapFor, snapAt: m.snapAt, handAt: m.handAt, dur: m.dur },
    midLead, beforeSnap, handed, end, stored: await offense(page),
  }, null, 2)}\n`);
});

test("a jet fake beside the primary read is play-action, and a lateral to the runner takes the sweep off", async ({ page }, info) => {
  const d = new Designer(page);
  await d.goto();
  await d.setName("Otters Jet Fake");
  await d.select("Z");
  await d.pick("Jet sweep");
  await d.select("Y");
  await d.pick("Go");
  await d.palette();
  await d.primaryButton.click();
  await expect.poll(() => offense(page)).toMatchObject({ Z: { type: "jet" }, Y: { type: "go", primary: true } });

  // the call is play-action: the sweep is the fake, and the ball ends with Y
  const { players, motion: m } = await plan(d);
  const call = callOf(players);
  expect(call).toBe("play-action");
  expect(m.kind).toBe("pass");
  expect(m.runner).toBe("o5");
  expect(m.receiver).toBe("o4");
  expect(m.jetLead).toBeGreaterThan(0);
  const clock = await startPlayback(d);
  await clock.to(m.jetLead / 2);
  const midLead = { Z: await tokenAt(d, "Z"), Y: await tokenAt(d, "Y"), ball: await ballAt(d) };
  expect(dist(midLead.Z, { x: 19, y: 5 })).toBeGreaterThan(0.5);
  expect(midLead.Z.y).toBeGreaterThanOrEqual(LOS_GAP - 0.01);
  expect(dist(midLead.Y, { x: 27, y: 1 })).toBeLessThan(0.01);
  expect(dist(midLead.ball, { x: 15, y: 1 })).toBeLessThan(0.05);
  await clock.to(m.catchAt + 0.05);
  const caught = { Y: await tokenAt(d, "Y"), ball: await ballAt(d) };
  expect(dist(caught.ball, caught.Y)).toBeLessThan(0.3);
  expect(caught.ball.y).toBeLessThan(0);
  await page.screenshot({ path: `${out(info, "fake")}-caught.png` });
  await clock.to(m.dur + 1);
  await expect(page.getByRole("button", { name: "Run the play" })).toBeVisible();
  await page.clock.resume();

  // the ball reaches a carrier by lateral, not by handoff: Z's sweep is gone, no keep offers it, and undo brings it back
  await d.select("QB");
  await d.pick("Lateral");
  await d.foldOverlays();
  await d.field.getByRole("button", { name: "Offense Z, can take the lateral", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Z has the ball" })).toBeVisible();
  await expect(group(page, "Runs").getByRole("button", { name: "Stretch", exact: true })).toBeVisible();
  await expect(jetTile(page)).toHaveCount(0);
  await expect.poll(() => offense(page)).toMatchObject({ Z: null, Y: { type: "go", primary: true } });
  await expect(page.getByRole("list", { name: "Ball path" })).toContainText("?");
  const afterLateral = await offense(page);
  await page.screenshot({ path: `${out(info, "fake")}-carrier.png` });
  await d.undo.click();
  await expect.poll(() => offense(page)).toMatchObject({ Z: { type: "jet" } });
  await expect.poll(async () => (await storedDraft(page))?.players.find((p) => p.id === "o2")?.laterals).toBeUndefined();

  writeFileSync(`${out(info, "fake")}.json`, `${JSON.stringify({
    project: info.project.name, call,
    plan: { jetLead: m.jetLead, preSnapFor: m.preSnapFor, handAt: m.handAt, throwAt: m.throwAt, catchAt: m.catchAt },
    midLead, caught, afterLateral, afterUndo: await offense(page),
  }, null, 2)}\n`);
});
