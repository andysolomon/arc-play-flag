import { expect, test } from "@playwright/test";
import { Designer } from "../support/designer";
import { COVER_TWO, seed } from "../support/fixtures";

test.use({ permissions: ["clipboard-read", "clipboard-write"] });

test("a share snapshot shows the play, keeps the other team, and opens it as a shadow", async ({ page }) => {
  await seed(page, { plays: [COVER_TWO] });
  const d = new Designer(page);
  await d.goto("?open=fx-cover-two");
  // the designer opens on the offense only
  await expect(d.field.getByRole("button")).toHaveCount(5);
  await expect(d.routes).toHaveCount(2);

  await d.clickTool("Copy share link");
  const dialog = page.getByRole("dialog", { name: "Share snapshot" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(/snapshot of this play now, not a live view/)).toBeVisible();
  await expect(dialog.getByRole("radio")).toHaveCount(0);
  const preview = dialog.getByRole("img", { name: "Offense snapshot preview" });
  await expect(preview.locator('circle[fill="#e5675e"]')).toHaveCount(5);
  await expect(preview.locator('circle[fill="#4a8fe0"]')).toHaveCount(0);
  await dialog.getByRole("button", { name: "Copy snapshot link" }).click();
  await expect(d.toast).toHaveText("Link copied");
  const url = await page.evaluate(() => navigator.clipboard.readText());
  expect(url).toMatch(/\/p\/[A-Za-z0-9_-]+$/);

  await page.goto(url);
  await expect(page).toHaveTitle("Otter Cover Two · Flag Football Play Designer");
  await expect(page.getByRole("heading", { name: "Otter Cover Two" })).toBeVisible();
  const shared = page.getByRole("img", { name: "Play diagram" });
  await expect(page.getByText(/This link is a snapshot, not a live view/)).toBeVisible();
  await expect(page.getByText("Offensive play · Snapshot")).toBeVisible();
  // the snapshot draws the offense; the defense stays in the link
  await expect(shared.getByRole("img", { name: /^Offense / })).toHaveCount(5);
  await expect(shared.getByRole("img", { name: /^Defense / })).toHaveCount(0);
  await expect(shared.getByRole("button")).toHaveCount(0);
  await expect(shared.locator("path[stroke-linecap='round']")).toHaveCount(2);
  await expect(shared.locator("path[stroke='#c2261a']")).toHaveCount(1);

  await page.getByRole("link", { name: "Open in designer ›" }).click();
  await expect(d.field).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
  await d.tools();
  await expect(d.nameInput).toHaveValue("Otter Cover Two");
  await expect(d.field.getByRole("button")).toHaveCount(10);
  await expect(d.player("X")).toHaveCSS("opacity", "1");
  await expect(d.player("d1", "Defense")).toBeVisible();
  await expect(d.player("d1", "Defense")).toHaveCSS("opacity", "0.4");
  await expect(d.routes).toHaveCount(6);
});

test("a defensive snapshot shows the call, then opens with the shadow offense", async ({ page }) => {
  const d = new Designer(page);
  await d.goto();
  await d.newPlay("Defense");
  await d.setName("Otter Cover Two");
  await expect(d.field.getByRole("button")).toHaveCount(10);

  await d.clickTool("Copy share link");
  const dialog = page.getByRole("dialog", { name: "Share snapshot" });
  const preview = dialog.getByRole("img", { name: "Defense snapshot preview" });
  await expect(preview.locator('circle[fill="#4a8fe0"]')).toHaveCount(5);
  await expect(preview.locator('circle[fill="#e5675e"]')).toHaveCount(0);
  await dialog.getByRole("button", { name: "Copy snapshot link" }).click();
  await expect(d.toast).toHaveText("Link copied");
  const url = await page.evaluate(() => navigator.clipboard.readText());

  await page.goto(url);
  const shared = page.getByRole("img", { name: "Play diagram" });
  await expect(page.getByText("Defensive call · Snapshot")).toBeVisible();
  await expect(shared.getByRole("img", { name: /^Defense / })).toHaveCount(5);
  await expect(shared.getByRole("img", { name: /^Offense / })).toHaveCount(0);

  await page.getByRole("link", { name: "Open in designer ›" }).click();
  await expect(d.field).toBeVisible();
  await expect(d.field.getByRole("button")).toHaveCount(10);
  await expect(d.player("X")).toHaveCSS("opacity", "0.4");
  await expect(d.player("d1", "Defense")).toHaveCSS("opacity", "1");
});

test("a link that is not a play is a 404, not a blank field", async ({ page }) => {
  const res = await page.goto("/p/not-a-play");
  expect(res?.status()).toBe(404);
});
