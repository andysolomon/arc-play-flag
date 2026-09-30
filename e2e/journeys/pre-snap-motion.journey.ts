import { expect, test } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { Designer, downloadText } from "../support/designer";
import { jsonUpload, seed, SLANT_LEFT, storedDraft, storedPlays } from "../support/fixtures";

test.use({ permissions: ["clipboard-read", "clipboard-write"] });

test("motion precedes the snap, preserves the route, and survives save, share and flip", async ({ page }, info) => {
  const d = new Designer(page);
  await d.goto();
  await d.setName("Otters Motion Go");
  await d.select("X");
  await d.pick("Go");
  await d.palette();
  await page.getByRole("button", { name: "Draw pre-snap motion", exact: true }).click();
  await expect(page.getByRole("button", { name: "Finish", exact: true })).toBeDisabled();
  await d.tapField(10, -2); // motion points stay behind the LOS
  await d.tapField(22, 2);
  await page.getByRole("button", { name: "Finish", exact: true }).click();
  const mover = async () => (await storedDraft(page))?.players.find(p => p.id === "o3");
  await expect.poll(async () => (await mover())?.preSnap).toEqual({ pts: [[10, 0.9], [22, 2]] });
  expect((await mover())?.route).toEqual({ type: "go" });
  await expect(d.field.locator("[data-pre-snap='o3']")).toHaveCount(1);
  const height = Number((await d.field.getAttribute("viewBox"))?.split(" ")[3]);
  await expect(d.field.locator("path[stroke='#4a3728']")).toHaveAttribute("d", new RegExp(`^M484\\.0 ${(height - 132).toFixed(1)}`));
  await d.undo.click();
  await expect(d.field.locator("[data-pre-snap]")).toHaveCount(0);
  await d.redo.click();
  await expect(d.field.locator("[data-pre-snap='o3']")).toHaveCount(1);
  await d.save();
  await page.reload();
  await expect(d.field.locator("[data-pre-snap='o3']")).toHaveCount(1);
  await d.select("X");
  await page.screenshot({ path: info.outputPath("motion-editor.png") });

  // Freeze the browser clock and read the actual tokens, rather than the planner alone.
  await d.closeSidebars();
  await page.clock.install();
  await page.clock.pauseAt(new Date());
  await page.getByRole("button", { name: "Run the play" }).click();
  await page.clock.runFor(1000);
  const moving = await d.playerX("X");
  expect(moving).toBeGreaterThan(3);
  expect(moving).toBeLessThan(22);
  expect(await d.playerX("Y")).toBe(27);
  const firstBall = await d.field.locator("image").getAttribute("transform");
  await page.clock.runFor(300);
  expect(await d.field.locator("image").getAttribute("transform")).toBe(firstBall);
  await page.clock.runFor(3000);
  expect(await d.playerX("X")).toBeCloseTo(22, 1);
  await page.clock.runFor(10000);
  await expect(page.getByRole("button", { name: "Run the play" })).toBeVisible();
  expect(await d.playerX("X")).toBe(3);
  await page.clock.resume();

  await d.clickTool("Flip play");
  await expect.poll(async () => (await mover())?.preSnap).toEqual({ pts: [[20, 0.9], [8, 2]] });
  await d.clickTool("Copy share link");
  const dialog = page.getByRole("dialog", { name: "Share snapshot" });
  await expect(dialog.locator("[data-pre-snap='o3']")).toHaveCount(1);
  await dialog.getByRole("button", { name: "Copy snapshot link" }).click();
  const url = await page.evaluate(() => navigator.clipboard.readText());
  await page.goto(url);
  await expect(page.getByRole("img", { name: "Play diagram" }).locator("[data-pre-snap='o3']")).toHaveCount(1);
  await page.screenshot({ path: info.outputPath("motion-share.png") });
  await writeFile(info.outputPath("motion-manifest.json"), JSON.stringify({ project: info.project.name, mover: await mover(), moving, url }, null, 2));
});

test("a motion play exports and imports onto another device without losing either assignment", async ({ page, browser }, info) => {
  const play = { ...SLANT_LEFT, players: SLANT_LEFT.players.map(p => p.id === "o3" ? { ...p, preSnap: { pts: [[20, 2] as const] } } : p) };
  await seed(page, { plays: [play] });
  await page.goto("/playbooks");
  await expect(page.locator("[data-pre-snap='o3']")).toHaveCount(1);
  await page.getByRole("button", { name: `More actions for ${play.name}` }).click();
  const [file] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Export play file", exact: true }).click()]);
  const json = await downloadText(file);
  await writeFile(info.outputPath("motion.play.json"), json);
  const other = await browser.newContext();
  try {
    const recipient = await other.newPage();
    await recipient.goto("/playbooks");
    await recipient.getByLabel("Import a play file").setInputFiles(jsonUpload("motion.play.json", json));
    await expect(recipient.getByRole("region", { name: "Import preview" })).toContainText("1 added");
    await recipient.getByRole("button", { name: "Import play", exact: true }).click();
    await expect.poll(() => storedPlays(recipient)).toEqual({ [play.id]: play });
    await recipient.reload();
    await expect(recipient.locator("[data-pre-snap='o3']")).toHaveCount(1);
    await recipient.screenshot({ path: info.outputPath("motion-import.png") });
  } finally { await other.close(); }
});

test("redraw can be cancelled, motion transfers to one player, and removal keeps the route", async ({ page }, info) => {
  const d = new Designer(page);
  await d.goto();
  await d.select("X");
  await d.pick("Slant");
  const draw = async (x: number, y: number) => {
    await d.palette();
    await page.getByRole("button", { name: /^(Draw|Redraw) pre-snap motion$/ }).click();
    await d.tapField(x, y);
    await page.getByRole("button", { name: "Finish", exact: true }).click();
  };
  await draw(16, 2);
  await d.palette();
  await page.getByRole("button", { name: "Redraw pre-snap motion", exact: true }).click();
  await d.tapField(20, 3);
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect.poll(async () => (await storedDraft(page))?.players.find(p => p.id === "o3")?.preSnap).toEqual({ pts: [[16, 2]] });
  await d.select("Y");
  await draw(18, 2);
  await expect(d.field.locator("[data-pre-snap]")).toHaveCount(1);
  await expect(d.field.locator("[data-pre-snap='o4']")).toHaveCount(1);
  await d.palette();
  await page.getByRole("button", { name: "Remove pre-snap motion", exact: true }).click();
  await expect(d.field.locator("[data-pre-snap]")).toHaveCount(0);
  expect((await storedDraft(page))?.players.find(p => p.id === "o3")?.route).toEqual({ type: "slant" });
  await d.newPlay("Defense");
  await d.select("LC", "Defense");
  await expect(page.getByRole("button", { name: /pre-snap motion/ })).toHaveCount(0);
  await page.screenshot({ path: info.outputPath("motion-defense-palette.png") });
});
