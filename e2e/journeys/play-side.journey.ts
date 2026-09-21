import { expect, test } from "@playwright/test";
import { Designer } from "../support/designer";
import { COVER_TWO, SLANT_LEFT, seed, storedDraft, storedPlays } from "../support/fixtures";

const sideBadge = (d: Designer, side: "Offense" | "Defense") => d.page.getByRole("img", { name: `${side} play` });
const shadowTile = (d: Designer) =>
  d.page.getByRole("group", { name: "Shadow offense" }).getByRole("button", { name: "Shadow offense", exact: true });

test("a coach starts a defensive call, and the choice survives save, reload and reopen", async ({ page }) => {
  const d = new Designer(page);
  await d.goto();
  await expect(sideBadge(d, "Offense")).toBeVisible();

  await d.tools();
  await expect(d.page.getByRole("group", { name: "Shadow offense" })).toHaveCount(0);
  await expect(d.page.getByRole("group", { name: "Show" })).toHaveCount(0);

  await d.newPlay("Defense");
  await expect(d.toast).toHaveText("New play · undo brings the last one back");
  await expect(sideBadge(d, "Defense")).toBeVisible();
  await expect(sideBadge(d, "Offense")).toHaveCount(0);
  await expect(shadowTile(d)).toHaveAttribute("aria-pressed", "true");
  await expect(d.field.getByRole("button")).toHaveCount(10);

  await d.setName("Otter Cover Two");
  await d.save();
  await expect(d.toast).toHaveText("Saved");
  const stored = Object.values(await storedPlays(page));
  expect(stored.map((p) => [p.name, p.side])).toEqual([["Otter Cover Two", "defense"]]);

  await page.reload();
  await expect(d.field).toBeVisible();
  await expect(sideBadge(d, "Defense")).toBeVisible();
  expect((await storedDraft(page))?.side).toBe("defense");

  await d.tools();
  await d.newPlay("Offense");
  await expect(sideBadge(d, "Offense")).toBeVisible();
  await expect(d.page.getByRole("group", { name: "Shadow offense" })).toHaveCount(0);
  await expect(d.field.getByRole("button")).toHaveCount(5);
  await d.openSaved("Otter Cover Two");
  await expect(page.getByRole("heading", { name: "Otter Cover Two" })).toBeVisible();
  await expect(sideBadge(d, "Defense")).toBeVisible();
});

test("a defensive call can hide or show the shadow offense, and never offers both teams", async ({ page }) => {
  const d = new Designer(page);
  await d.goto();
  await d.newPlay("Defense");
  await expect(shadowTile(d)).toHaveAttribute("aria-pressed", "true");
  await expect(d.player("X")).toBeVisible();
  await expect(d.player("d1", "Defense")).toBeVisible();

  await shadowTile(d).click();
  await expect(shadowTile(d)).toHaveAttribute("aria-pressed", "false");
  await expect(d.player("X")).toHaveCount(0);
  await expect(d.player("d1", "Defense")).toBeVisible();
  await expect(d.field.getByRole("button")).toHaveCount(5);

  await shadowTile(d).click();
  await expect(shadowTile(d)).toHaveAttribute("aria-pressed", "true");
  await expect(d.player("X")).toBeVisible();
  await expect(d.field.getByRole("button")).toHaveCount(10);

  await d.closeSidebars();
  await d.player("X").click();
  await expect(d.player("X")).toHaveAttribute("aria-pressed", "false");
  await d.select("d1", "Defense");
  await expect(d.player("d1", "Defense")).toHaveAttribute("aria-pressed", "true");
});

test("the playbook gallery labels each play's side and filters defensive calls by it", async ({ page }) => {
  await seed(page, { plays: [SLANT_LEFT, { ...COVER_TWO, side: "defense" }] });
  await page.goto("/playbooks");

  const slant = page.locator("div", { has: page.getByText("Otter Slant Left", { exact: true }) }).last();
  const cover = page.locator("div", { has: page.getByText("Otter Cover Two", { exact: true }) }).last();
  await expect(slant).toContainText("Offense");
  await expect(cover).toContainText("Defense");
  await expect(page.getByRole("group", { name: "Show" })).toHaveCount(0);
  await expect(slant.getByRole("img", { name: "Otter Slant Left" }).locator('circle[fill="#e5675e"]')).toHaveCount(5);
  await expect(slant.getByRole("img", { name: "Otter Slant Left" }).locator('circle[fill="#4a8fe0"]')).toHaveCount(0);
  await expect(cover.getByRole("img", { name: "Otter Cover Two" }).locator('circle[fill="#4a8fe0"]')).toHaveCount(5);
  await expect(cover.getByRole("img", { name: "Otter Cover Two" }).locator('circle[fill="#e5675e"]')).toHaveCount(0);

  await page.getByRole("combobox", { name: "Filter saved plays" }).selectOption("defense");
  await expect(page.getByText("Otter Cover Two", { exact: true })).toBeVisible();
  await expect(page.getByText("Otter Slant Left", { exact: true })).toHaveCount(0);
  await page.getByRole("combobox", { name: "Filter saved plays" }).selectOption("pass");
  await expect(page.getByText("Otter Slant Left", { exact: true })).toBeVisible();
  await expect(page.getByText("Otter Cover Two", { exact: true })).toHaveCount(0);
});

test("the shadow offense is faded context, and hiding it leaves only the defense", async ({ page }) => {
  const d = new Designer(page);
  await d.goto();
  await expect(d.player("d1", "Defense")).toBeHidden();
  await d.newPlay("Defense");
  const offense = d.player("X", "Offense");
  const defense = d.player("d1", "Defense");
  await expect(offense).toBeVisible();
  await expect(offense).toHaveCSS("opacity", "0.4");
  await expect(defense).toHaveCSS("opacity", "1");
  await shadowTile(d).click();
  await expect(offense).toHaveCount(0);
  await expect(defense).toBeVisible();
  await expect(defense).toHaveCSS("opacity", "1");
});
