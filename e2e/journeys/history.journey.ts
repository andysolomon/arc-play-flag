import { expect, test } from "@playwright/test";
import { Designer } from "../support/designer";
import { SLANT_LEFT, WHEEL_RIGHT, seed, storedPlays } from "../support/fixtures";

test("opening B over an edited A, undoing, and saving writes A's diagram under A's id and leaves B alone", async ({ page }) => {
  await seed(page, { plays: [SLANT_LEFT, WHEEL_RIGHT] });
  const d = new Designer(page);
  await d.goto("?open=fx-slant-left");
  await expect(page).toHaveURL(/\/$/);
  await d.tools();
  await expect(d.nameInput).toHaveValue("Otter Slant Left");
  await expect(d.routes).toHaveCount(2);

  // edit A without saving: Y's out becomes a go
  await d.select("Y");
  await d.pick("Go");
  await expect(d.routes).toHaveCount(2);

  await d.openSaved("Otter Wheel Right");
  await expect(d.toast).toHaveText("Opened “Otter Wheel Right” · undo brings “Otter Slant Left” back");
  await expect(d.nameInput).toHaveValue("Otter Wheel Right");

  await d.undo.click();
  await expect(d.nameInput).toHaveValue("Otter Slant Left");
  await d.save();
  await expect(d.toast).toHaveText("Saved");

  const lib = await storedPlays(page);
  expect(Object.keys(lib).sort()).toEqual(["fx-slant-left", "fx-wheel-right"]);
  expect(lib["fx-wheel-right"]).toEqual(WHEEL_RIGHT);
  expect(lib["fx-slant-left"]?.name).toBe("Otter Slant Left");
  expect(lib["fx-slant-left"]?.players.find((p) => p.id === "o4")?.route).toEqual({ type: "go" });
  expect(lib["fx-slant-left"]?.players.find((p) => p.id === "o3")?.route).toEqual({ type: "slant" });

  // and B still opens as it was seeded
  await d.openSaved("Otter Wheel Right");
  await expect(d.nameInput).toHaveValue("Otter Wheel Right");
  await expect(d.primaryRoutes).toHaveCount(1);
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
  await expect(d.openSelect.locator("option")).toHaveText(["Open a saved play…", "Otter Slant Left", "Otter Slant Left copy"]);

  await d.setName("Otter Slant Left v2");
  await d.save();
  await expect(d.toast).toHaveText("Saved");

  const lib = await storedPlays(page);
  expect(lib["fx-slant-left"]).toEqual(SLANT_LEFT);
  expect(Object.values(lib).map((p) => p.name).sort()).toEqual(["Otter Slant Left", "Otter Slant Left v2"]);
});
