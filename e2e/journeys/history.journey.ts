import { writeFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { HISTORY_CAP } from "../../lib/play/history";
import { Designer } from "../support/designer";
import { SLANT_LEFT, WHEEL_RIGHT, seed, storedDraft, storedPlays } from "../support/fixtures";

test("editing A, saving, opening B, and checking storage leaves B alone and keeps A's diagram under A's id", async ({ page }) => {
  await seed(page, { plays: [SLANT_LEFT, WHEEL_RIGHT] });
  const d = new Designer(page);
  await d.goto("?open=fx-slant-left");
  await expect(page).toHaveURL(/\/$/);
  await d.tools();
  await expect(d.nameInput).toHaveValue("Otter Slant Left");
  await expect(d.routes).toHaveCount(2);

  // edit A: Y's out becomes a go
  await d.select("Y");
  await d.pick("Go");
  await expect(d.routes).toHaveCount(2);
  await d.save();
  await expect(d.toast).toHaveText("Saved");

  // reopen B from Playbooks (library no longer lives in Play tools)
  await d.openSaved("Otter Wheel Right");
  await expect(page.getByRole("heading", { name: "Otter Wheel Right" })).toBeVisible();
  await expect(d.primaryRoutes).toHaveCount(1);

  const lib = await storedPlays(page);
  expect(Object.keys(lib).sort()).toEqual(["fx-slant-left", "fx-wheel-right"]);
  expect(lib["fx-wheel-right"]).toEqual(WHEEL_RIGHT);
  expect(lib["fx-slant-left"]?.name).toBe("Otter Slant Left");
  expect(lib["fx-slant-left"]?.players.find((p) => p.id === "o4")?.route).toEqual({ type: "go" });
  expect(lib["fx-slant-left"]?.players.find((p) => p.id === "o3")?.route).toEqual({ type: "slant" });
});

test("saving a play and starting a new one keeps undo and redo inside the new play", async ({ page }) => {
  const d = new Designer(page);
  await d.goto();
  await d.setName("Otter Scratch");
  await d.select("X");
  await d.pick("Slant");
  await expect(d.routes).toHaveCount(1);
  await d.save();
  await expect(d.toast).toHaveText("Saved");

  await d.newPlay();
  await expect(d.toast).toHaveText("New play");
  await expect(d.nameInput).toHaveValue("New play");
  await expect(d.routes).toHaveCount(0);
  await expect(d.undo).toBeDisabled();
  await expect(d.redo).toBeDisabled();

  await d.select("Y");
  await d.pick("Go");
  await expect(d.routes).toHaveCount(1);
  // the name field lives in Play tools, and a phone or tablet folds that drawer away to
  // select a player and again once a route is picked, so open it to read the name back
  await d.tools();
  await expect(d.nameInput).toHaveValue("New play");
  await d.undo.click();
  await expect(d.routes).toHaveCount(0);
  await expect(d.nameInput).toHaveValue("New play");
  await d.redo.click();
  await expect(d.routes).toHaveCount(1);
  await expect(d.nameInput).toHaveValue("New play");
  await expect(d.redo).toBeDisabled();
});

test("Duplicate saves a copy, and later edits go to the copy, not the original", async ({ page }) => {
  await seed(page, { plays: [SLANT_LEFT] });
  const d = new Designer(page);
  await d.goto("?open=fx-slant-left");
  await d.clickTool("Duplicate");
  await expect(d.toast).toHaveText("Saved a copy");
  await expect(d.nameInput).toHaveValue("Otter Slant Left copy");

  await d.setName("Otter Slant Left v2");
  await d.save();
  await expect(d.toast).toHaveText("Saved");

  const lib = await storedPlays(page);
  expect(lib["fx-slant-left"]).toEqual(SLANT_LEFT);
  expect(Object.values(lib).map((p) => p.name).sort()).toEqual(["Otter Slant Left", "Otter Slant Left v2"]);

  await page.goto("/playbooks");
  await expect(page.getByText("Otter Slant Left", { exact: true })).toBeVisible();
  await expect(page.getByText("Otter Slant Left v2", { exact: true })).toBeVisible();
});

test("a player's tag takes three capital letters, and the whole retag is one step of undo", async ({ page }, info) => {
  const d = new Designer(page);
  await d.goto();
  await d.select("X");
  const tag = page.locator("#route-sidebar").getByRole("textbox", { name: "Player tag" });
  await expect(tag).toHaveValue("X");
  await tag.fill("");
  await tag.pressSequentially("cbxy");
  await expect(tag).toHaveValue("CBX");
  await expect(d.player("CBX")).toBeVisible();
  await expect.poll(async () => (await storedDraft(page))?.players.find((p) => p.id === "o3")?.label).toBe("CBX");

  // clearing the tag and typing four letters was one edit: one Undo puts X back, and there is nothing older
  await d.foldOverlays();
  await d.undo.click();
  await expect(d.player("X")).toBeVisible();
  await expect(d.undo).toBeDisabled();
  await expect.poll(async () => (await storedDraft(page))?.players.find((p) => p.id === "o3")?.label).toBe("X");
  await d.redo.click();
  await expect(d.player("CBX")).toBeVisible();
  writeFileSync(`test-results/history-${info.project.name}-tag.json`, `${JSON.stringify({ typed: "cbxy", shown: "CBX", undoSteps: 1 }, null, 2)}\n`);
});

test("undo keeps the last 60 edits and drops older ones", async ({ page }, info) => {
  test.setTimeout(120_000);
  const d = new Designer(page);
  await d.goto();
  const x = d.player("X");
  const storedY = async (): Promise<number | undefined> => (await storedDraft(page))?.players.find((p) => p.id === "o3")?.y;
  // 65 arrow steps, each its own edit: X steps back from the 1 to the 6, then up and back again 60 times
  for (let i = 0; i < 5; i++) await x.press("ArrowDown");
  for (let i = 0; i < HISTORY_CAP; i++) await x.press(i % 2 ? "ArrowDown" : "ArrowUp");
  await expect.poll(storedY).toBe(6);

  // 59 undos reach the board after the 6th step, a yard up; the 60th reaches the 5th step's and goes no further
  await d.foldOverlays();
  for (let i = 1; i < HISTORY_CAP; i++) await d.undo.click();
  await expect.poll(storedY).toBe(5);
  await d.undo.click();
  await expect.poll(storedY).toBe(6);
  await expect(d.undo).toBeDisabled();
  const after60 = await storedY();

  // and every one of them comes back
  for (let i = 0; i < HISTORY_CAP; i++) await d.redo.click();
  await expect(d.redo).toBeDisabled();
  await expect.poll(storedY).toBe(6);
  writeFileSync(`test-results/history-${info.project.name}-cap.json`, `${JSON.stringify({ edits: HISTORY_CAP + 5, cap: HISTORY_CAP, yAfter59Undos: 5, yAfter60Undos: after60 }, null, 2)}\n`);
});

test("Undo and Redo step the diagram only: a name and notes typed later stay, typing them or saving is no step, and a new edit after Undo drops Redo", async ({ page }, info) => {
  const d = new Designer(page);
  await d.goto();
  const steps: Record<string, unknown>[] = [];
  const x = d.player("X");
  const notes = page.locator("#play-sidebar").getByRole("textbox", { name: "Coaching points" });
  const draft = async (step: string) => {
    const s = await storedDraft(page);
    const at = s?.players.find((p) => p.id === "o3");
    const row = { step, name: s?.name, notes: s?.notes, x: at?.x, y: at?.y, undo: await d.undo.isEnabled(), redo: await d.redo.isEnabled() };
    steps.push(row);
    return row;
  };

  // X steps back a yard, then the play is named and given notes
  await x.press("ArrowDown");
  await d.setName("Otter Sprint");
  await d.clickTool("Notes");
  await notes.fill("Sell the fake.");
  await expect.poll(async () => (await draft("moved, named, noted")).notes).toBe("Sell the fake.");

  // Undo takes back the step and nothing typed after it, and lets go of X; Redo puts the step back
  await d.foldOverlays();
  await d.undo.click();
  await expect(x).toHaveAttribute("aria-pressed", "false");
  await expect.poll(() => draft("undone")).toMatchObject({ name: "Otter Sprint", notes: "Sell the fake.", y: 1, undo: false });
  await d.redo.click();
  await expect(x).toHaveAttribute("aria-pressed", "false");
  await expect.poll(() => draft("redone")).toMatchObject({ name: "Otter Sprint", notes: "Sell the fake.", y: 2, redo: false });

  // in a new play, typing notes and saving are not steps: Undo stays off
  await d.newPlay();
  await d.tools();
  if ((await notes.count()) === 0) await d.clickTool("Notes");
  await notes.fill("Walk it first.");
  await d.save();
  await expect(d.toast).toHaveText("Saved");
  await expect(d.undo).toBeDisabled();
  await draft("new play noted and saved");

  // a fresh edit after an Undo leaves nothing to redo
  await x.press("ArrowDown");
  await d.foldOverlays();
  await d.undo.click();
  await expect(d.redo).toBeEnabled();
  await x.press("ArrowRight");
  await expect(d.redo).toBeDisabled();
  await expect.poll(() => draft("a new step after Undo")).toMatchObject({ x: 4, y: 1, undo: true, redo: false });
  writeFileSync(`test-results/history-${info.project.name}-name-notes.json`, `${JSON.stringify({ steps }, null, 2)}\n`);
});
