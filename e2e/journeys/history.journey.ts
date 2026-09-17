import { expect, test } from "@playwright/test";
import { Designer } from "../support/designer";
import { SLANT_LEFT, WHEEL_RIGHT, seed, storedPlays } from "../support/fixtures";

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
  await expect(d.nameInput).toHaveValue("Otter Wheel Right");
  await expect(d.primaryRoutes).toHaveCount(1);

  const lib = await storedPlays(page);
  expect(Object.keys(lib).sort()).toEqual(["fx-slant-left", "fx-wheel-right"]);
  expect(lib["fx-wheel-right"]).toEqual(WHEEL_RIGHT);
  expect(lib["fx-slant-left"]?.name).toBe("Otter Slant Left");
  expect(lib["fx-slant-left"]?.players.find((p) => p.id === "o4")?.route).toEqual({ type: "go" });
  expect(lib["fx-slant-left"]?.players.find((p) => p.id === "o3")?.route).toEqual({ type: "slant" });
});

test("New play clears the field and undo brings the last play back whole", async ({ page }) => {
  const d = new Designer(page);
  await d.goto();
  await d.setName("Otter Scratch");
  await d.select("X");
  await d.pick("Slant");
  await expect(d.routes).toHaveCount(1);

  await d.clickTool("New play");
  await expect(d.toast).toHaveText("New play · undo brings the last one back");
  await expect(d.nameInput).toHaveValue("New play");
  await expect(d.routes).toHaveCount(0);

  await d.undo.click();
  await expect(d.nameInput).toHaveValue("Otter Scratch");
  await expect(d.routes).toHaveCount(1);

  await d.redo.click();
  await expect(d.nameInput).toHaveValue("New play");
  await expect(d.routes).toHaveCount(0);
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
