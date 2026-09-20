import { expect, test } from "@playwright/test";
import { Designer } from "../support/designer";
import { COVER_TWO, SLANT_LEFT, seed, storedDraft, storedPlays } from "../support/fixtures";

const sides = (d: Designer) => d.page.getByRole("group", { name: "Play side" });
const offenseSide = (d: Designer) => sides(d).getByRole("button", { name: "Offense play" });
const defenseSide = (d: Designer) => sides(d).getByRole("button", { name: "Defense play" });
const showTile = (d: Designer, name: "Both" | "Offense" | "Defense") =>
  d.page.getByRole("group", { name: "Show" }).getByRole("button", { name, exact: true });

test("a coach marks a play as a defensive call, and the choice survives save, reload and reopen", async ({ page }) => {
  const d = new Designer(page);
  await d.goto();
  await expect(offenseSide(d)).toHaveAttribute("aria-pressed", "true");

  // marking the play defensive shows the defense, the way a Show tap would
  await defenseSide(d).click();
  await expect(defenseSide(d)).toHaveAttribute("aria-pressed", "true");
  await expect(offenseSide(d)).toHaveAttribute("aria-pressed", "false");
  await d.tools();
  await expect(showTile(d, "Defense")).toHaveAttribute("aria-pressed", "true");
  await d.setName("Otter Cover Two");
  await d.save();
  await expect(d.toast).toHaveText("Saved");
  const stored = Object.values(await storedPlays(page));
  expect(stored.map((p) => [p.name, p.side])).toEqual([["Otter Cover Two", "defense"]]);

  // the draft remembers the side across a reload
  await page.reload();
  await expect(d.field).toBeVisible();
  await expect(defenseSide(d)).toHaveAttribute("aria-pressed", "true");
  expect((await storedDraft(page))?.side).toBe("defense");

  // a new play is offensive again; reopening the saved call brings the defense back
  await d.tools();
  await d.clickTool("New play");
  await expect(offenseSide(d)).toHaveAttribute("aria-pressed", "true");
  await expect(showTile(d, "Offense")).toHaveAttribute("aria-pressed", "true");
  await d.openSaved("Otter Cover Two");
  await expect(page.getByRole("heading", { name: "Otter Cover Two" })).toBeVisible();
  await expect(defenseSide(d)).toHaveAttribute("aria-pressed", "true");
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

test("showing the other team on the field fades it, like the Show tiles", async ({ page }) => {
  const d = new Designer(page);
  await d.goto();
  await expect(d.player("d1", "Defense")).toBeHidden();
  await d.tools();
  await showTile(d, "Both").click();
  const defense = d.player("d1", "Defense");
  await expect(defense).toBeVisible();
  await expect(defense).toHaveCSS("opacity", "0.4");
  await expect(d.player("X", "Offense")).toHaveCSS("opacity", "1");
  await showTile(d, "Defense").click();
  await expect(defense).toBeVisible();
  await expect(defense).toHaveCSS("opacity", "0.4");
  await expect(d.player("X", "Offense")).toBeHidden();
});
