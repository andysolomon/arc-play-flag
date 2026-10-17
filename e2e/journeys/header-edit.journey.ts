import { mkdirSync, writeFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { Designer, armSabotage, sabotage } from "../support/designer";
import { SLANT_LEFT, seed, storedPlays } from "../support/fixtures";

test("rename and duplicate from the field keep the original, and the copy survives a reload", async ({ page }, testInfo) => {
  await seed(page, { plays: [SLANT_LEFT] });
  const d = new Designer(page);
  await d.goto("?open=fx-slant-left");
  await d.closeSidebars();
  const header = page.getByRole("banner");
  const rename = page.getByRole("button", { name: "Edit play name", exact: true });
  const input = page.getByRole("textbox", { name: "Edit play name", exact: true });
  const duplicate = header.getByRole("button", { name: "Duplicate play", exact: true });

  await rename.click();
  await expect(input).toBeFocused();
  await input.fill("Otter Quick Slant");
  await input.press("Enter");
  await expect(rename).toBeFocused();
  await expect(page.getByRole("heading", { name: "Otter Quick Slant", exact: true })).toBeVisible();
  // Duplicate takes the unsaved name on the board, leaving the saved original alone.
  await duplicate.click();
  await expect(d.toast).toHaveText("Saved a copy");
  let lib = await storedPlays(page);
  expect(lib[SLANT_LEFT.id]).toEqual(SLANT_LEFT);
  const copy = Object.values(lib).find((p) => p.id !== SLANT_LEFT.id);
  if (!copy) throw new Error("Duplicate did not create a new play");
  expect(copy).toMatchObject({ name: "Otter Quick Slant copy", players: SLANT_LEFT.players, notes: SLANT_LEFT.notes });
  await rename.click();
  await input.fill("Discard this name");
  await input.press("Escape");
  await expect(rename).toBeFocused();
  await expect(page.getByRole("heading", { name: copy.name, exact: true })).toBeVisible();
  // Tapping Save commits an in-progress rename before saving the same copy.
  await rename.click();
  await input.fill("Otter Keyboard Save");
  await input.press("ControlOrMeta+s");
  await expect(d.toast).toHaveText("Saved");
  await expect(input).toBeFocused();
  expect((await storedPlays(page))[copy.id]?.name).toBe("Otter Keyboard Save");
  await input.fill("Otter Slant Variation");
  await header.getByRole("button", { name: "Save play", exact: true }).click();
  await expect(d.toast).toHaveText("Saved");
  lib = await storedPlays(page);
  expect(Object.keys(lib)).toHaveLength(2);
  expect(lib[copy.id]?.name).toBe("Otter Slant Variation");
  expect(lib[SLANT_LEFT.id]).toEqual(SLANT_LEFT);
  await d.tools();
  await expect(d.nameInput).toHaveValue("Otter Slant Variation");
  await d.closeSidebars();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Otter Slant Variation", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Play tools" })).toHaveAttribute("aria-expanded", "false");
  mkdirSync("test-results", { recursive: true });
  const out = `test-results/header-edit-${testInfo.project.name}`;
  await page.screenshot({ path: `${out}.png` });
  writeFileSync(`${out}.json`, JSON.stringify({ stored: await storedPlays(page), copyId: copy.id }, null, 2));
});

test("the top bar fits at 320px with thumb-sized controls and a long editable name", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await seed(page, { plays: [SLANT_LEFT] });
  const d = new Designer(page);
  await d.goto("?open=fx-slant-left");
  await d.closeSidebars();
  await page.getByRole("button", { name: "Edit play name", exact: true }).click();
  const input = page.getByRole("textbox", { name: "Edit play name", exact: true });
  await input.fill("Riverside Otters very long play name for the championship game");
  await input.press("Enter");
  const boxes = await page.getByRole("banner").getByRole("button").evaluateAll((buttons) => buttons.map((b) => {
    const { x, y, width, height } = b.getBoundingClientRect();
    return { name: b.getAttribute("aria-label"), x, y, width, height };
  }));
  expect(boxes).toHaveLength(7);
  for (const b of boxes) {
    expect(b.width, b.name ?? "button").toBeGreaterThanOrEqual(44);
    expect(b.height, b.name ?? "button").toBeGreaterThanOrEqual(44);
    expect(b.x).toBeGreaterThanOrEqual(0);
    expect(b.x + b.width).toBeLessThanOrEqual(320);
    expect(b.y).toBe(boxes[0]?.y);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
  mkdirSync("test-results", { recursive: true });
  const out = `test-results/header-edit-${testInfo.project.name}-320`;
  await page.screenshot({ path: `${out}.png` });
  writeFileSync(`${out}.json`, JSON.stringify(boxes, null, 2));
  // Intermediate widths must also fit before the controls switch to their wider layout.
  for (const width of [375, 393, 480, 600, 768, 810]) {
    await page.setViewportSize({ width, height: 900 });
    const buttons = await page.getByRole("banner").getByRole("button").evaluateAll((items) => items.map((item) => {
      const r = item.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, width: r.width, height: r.height };
    }));
    for (const b of buttons) {
      expect(b.left, `${String(width)}px`).toBeGreaterThanOrEqual(0);
      expect(b.right, `${String(width)}px`).toBeLessThanOrEqual(width);
      expect(b.top, `${String(width)}px`).toBe(buttons[0]?.top);
      expect(b.width, `${String(width)}px`).toBeGreaterThanOrEqual(44);
      expect(b.height, `${String(width)}px`).toBeGreaterThanOrEqual(44);
    }
  }
});

test("a refused header duplicate exposes recovery without changing the original, and roster mode has neither control", async ({ page }, testInfo) => {
  await armSabotage(page);
  await seed(page, { plays: [SLANT_LEFT] });
  const d = new Designer(page);
  await d.goto("?open=fx-slant-left");
  await d.closeSidebars();
  await sabotage(page, "quota", true);
  await page.getByRole("banner").getByRole("button", { name: "Duplicate play", exact: true }).click();
  await expect(page.getByRole("button", { name: "Play tools" })).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByRole("button", { name: "Download play" })).toBeVisible();
  expect(await storedPlays(page)).toEqual({ [SLANT_LEFT.id]: SLANT_LEFT });
  await sabotage(page, "quota", false);
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(d.toast).toHaveText("Saved a copy");
  const lib = await storedPlays(page);
  expect(Object.keys(lib)).toHaveLength(2);
  expect(lib[SLANT_LEFT.id]).toEqual(SLANT_LEFT);
  expect(Object.values(lib).some((p) => p.name === `${SLANT_LEFT.name} copy`)).toBe(true);
  await d.roster();
  await expect(page.getByRole("banner").getByRole("button", { name: "Duplicate play", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Edit play name", exact: true })).toHaveCount(0);
  mkdirSync("test-results", { recursive: true });
  await page.screenshot({ path: `test-results/header-edit-${testInfo.project.name}-roster.png` });
});
