import { expect, test } from "@playwright/test";
import { Designer } from "../support/designer";
import { COVER_TWO, seed } from "../support/fixtures";

test.use({ permissions: ["clipboard-read", "clipboard-write"] });

test("a share link shows the whole play read-only, both teams, and opens back in the designer", async ({ page }) => {
  await seed(page, { plays: [COVER_TWO] });
  const d = new Designer(page);
  await d.goto("?open=fx-cover-two");
  // the designer opens on the offense only
  await expect(d.field.getByRole("button")).toHaveCount(5);
  await expect(d.routes).toHaveCount(2);

  await d.clickTool("Copy share link");
  await expect(d.toast).toHaveText("Link copied");
  const url = await page.evaluate(() => navigator.clipboard.readText());
  expect(url).toMatch(/\/p\/[A-Za-z0-9_-]+$/);

  await page.goto(url);
  await expect(page).toHaveTitle("Otter Cover Two · Flag Football Play Designer");
  await expect(page.getByRole("heading", { name: "Otter Cover Two" })).toBeVisible();
  const shared = page.getByRole("img", { name: "Play diagram" });
  // everyone who opens the link sees both teams and every route, and can move nothing
  await expect(shared.getByRole("img")).toHaveCount(10);
  await expect(shared.getByRole("button")).toHaveCount(0);
  await expect(shared.locator("path[stroke-linecap='round']")).toHaveCount(6);
  await expect(shared.locator("path[stroke='#c2261a']")).toHaveCount(1);

  await page.getByRole("link", { name: "Open in designer ›" }).click();
  await expect(d.field).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
  await d.tools();
  await expect(d.nameInput).toHaveValue("Otter Cover Two");
  await expect(d.routes).toHaveCount(2);
});

test("a link that is not a play is a 404, not a blank field", async ({ page }) => {
  const res = await page.goto("/p/not-a-play");
  expect(res?.status()).toBe(404);
});
