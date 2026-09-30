import { expect, test } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { assignments } from "../../lib/play/assignments";
import { buildMotion } from "../../lib/play/motion";
import type { SavedPlay } from "../../lib/play/types";
import { Designer } from "../support/designer";
import { formation, seed, storedDraft, storedPlays } from "../support/fixtures";

// Integration failures: a merge can discard the ball plan, run transfers during motion,
// omit motion from possession jobs, or clear one assignment while leaving the other.
test("motion finishes before a lateral chain and forward pass, with both assignments saved and undoable", async ({ page }, info) => {
  const original: SavedPlay = {
    id: "fx-motion-laterals", name: "Otters Motion Flea Flicker", side: "offense", notes: "Motion, then exchange.",
    players: formation({ o3: { type: "go", primary: true } }),
    ballPlan: [
      { type: "lateral", target: "o5", delay: 0.2 },
      { type: "lateral", target: "o2", delay: 0.2 },
      { type: "lateral", target: "o5", delay: 0.2 },
      { type: "pass", target: "o3", delay: 0.2 },
    ],
  };
  await seed(page, { draft: original });
  const d = new Designer(page);
  await d.goto();
  await d.select("Z");
  await page.getByRole("button", { name: "Draw pre-snap motion", exact: true }).click();
  await d.tapField(23, 5); // Keep the waypoint clear of the floating Run button on phones.
  await page.getByRole("button", { name: "Finish", exact: true }).click();
  await d.save();
  const saved = Object.values(await storedPlays(page))[0];
  if (!saved) throw new Error("Missing saved motion play");
  expect(saved.ballPlan).toEqual(original.ballPlan);
  expect(saved.players.find(p => p.id === "o5")?.preSnap).toEqual({ pts: [[23, 5]] });
  const base = buildMotion(original.players, -16, undefined, original.ballPlan);
  const motion = buildMotion(saved.players, -16, undefined, saved.ballPlan);
  expect(motion.ballError).toBeNull();
  expect(motion.exchanges).toHaveLength(4);
  expect(motion.exchanges[0]?.releaseAt).toBeGreaterThan(motion.snapAt);
  expect(motion.exchanges[0]?.from).toBe("o2");
  expect(motion.exchanges[0]?.toPt.x).toBe(23);
  expect(motion.passer).toBe("o5");
  expect(motion.throwAt).toBeGreaterThan(base.throwAt);
  expect(assignments(saved).find(a => a.id === "o5")?.job).toMatch(/^Pre-snap motion, then Receive lateral/);
  expect(assignments(saved).find(a => a.id === "o5")?.job).toContain("Throw forward pass");
  await page.reload();
  await expect(d.field.locator("[data-pre-snap='o5']")).toHaveCount(1);
  await expect(d.field.locator("[data-ball-step]")).toHaveCount(4);
  await d.closeSidebars();
  await page.clock.install({ time: new Date("2026-09-30T12:00:00Z") });
  await page.clock.pauseAt(new Date("2026-09-30T12:00:01Z"));
  await page.getByRole("button", { name: "Run the play", exact: true }).click();
  await page.clock.runFor(500);
  await expect(d.field).toHaveAttribute("data-ball-holder", "o1");
  expect(await d.playerX("Z")).toBeGreaterThan(19);
  expect(await d.playerX("Z")).toBeLessThan(23);
  expect(await d.playerX("X")).toBe(3);
  let previous = 0.5;
  for (const exchange of motion.exchanges) {
    const now = exchange.catchAt + 0.05;
    await page.clock.runFor(Math.ceil((now - previous) * 1000));
    await expect(d.field).toHaveAttribute("data-ball-holder", exchange.to);
    previous = now;
  }
  await page.screenshot({ path: info.outputPath("motion-lateral-chain.png") });
  await page.clock.runFor(10000);
  await page.clock.resume();
  await page.getByRole("button", { name: "Clear routes", exact: true }).first().click();
  await expect(d.field.locator("[data-pre-snap]")).toHaveCount(0);
  await expect(d.field.locator("[data-ball-step]")).toHaveCount(0);
  await expect.poll(async () => (await storedDraft(page))?.ballPlan).toBeUndefined();
  await d.undo.click();
  await expect(d.field.locator("[data-pre-snap='o5']")).toHaveCount(1);
  await expect(d.field.locator("[data-ball-step]")).toHaveCount(4);
  await writeFile(info.outputPath("motion-lateral-chain.json"), JSON.stringify({ saved, motion, assignments: assignments(saved) }, null, 2));
});
