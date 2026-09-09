import { expect, test } from "@playwright/test";
import { Designer } from "../support/designer";
import { storedDraft } from "../support/fixtures";

test.use({ permissions: ["clipboard-read", "clipboard-write"] });

const routeOf = async (page: Parameters<typeof storedDraft>[0]) => (await storedDraft(page))?.players.find((p) => p.id === "o3")?.route;

test("a custom route keeps its primary read through Mirror and Flip, all the way to the share page", async ({ page }) => {
  const d = new Designer(page);
  await d.goto();
  await d.select("X");
  await d.pick("Custom");
  await expect(page.locator("#route-sidebar")).toContainText("Tap waypoints on the field · double-tap to finish");

  // three waypoints up the left sideline; the double tap finishes the route
  await d.tapField(4, -3);
  await d.tapField(4.5, -8);
  await d.doubleTapField(4.5, -14);
  await expect(d.routes).toHaveCount(1);
  expect(await routeOf(page)).toEqual({ type: "custom", pts: [[4, -3], [4.5, -8], [4.5, -14]] });

  await d.palette();
  await expect(d.primaryButton).toHaveText("☆ Mark primary");
  await d.primaryButton.click();
  await expect(d.primaryButton).toHaveText("★ Primary read");
  await expect(d.primaryRoutes).toHaveCount(1);

  // Mirror rebuilds the geometry about the player and keeps the read
  await d.mirrorButton.click();
  await expect(d.primaryButton).toHaveAttribute("aria-pressed", "true");
  await expect(d.primaryRoutes).toHaveCount(1);
  expect(await routeOf(page)).toEqual({ type: "custom", primary: true, pts: [[2, -3], [1.5, -8], [1.5, -14]] });

  // Flip moves the whole play to the other side and keeps the read
  await d.clickTool("Flip play");
  expect(await d.playerX("X")).toBe(27);
  await expect(d.primaryRoutes).toHaveCount(1);
  expect(await routeOf(page)).toEqual({ type: "custom", primary: true, pts: [[28, -3], [28.5, -8], [28.5, -14]] });

  // whoever opens the link sees the same read
  await d.clickTool("Copy share link");
  await expect(d.toast).toHaveText("Link copied");
  const url = await page.evaluate(() => navigator.clipboard.readText());
  await page.goto(url);
  await expect(page.getByRole("img", { name: "Play diagram" }).locator("path[stroke='#c2261a']")).toHaveCount(1);
});
