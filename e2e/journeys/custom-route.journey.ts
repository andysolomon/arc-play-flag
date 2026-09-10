import { expect, test } from "@playwright/test";
import { Designer } from "../support/designer";
import { storedDraft } from "../support/fixtures";

test.use({ permissions: ["clipboard-read", "clipboard-write"] });

const routeOf = async (page: Parameters<typeof storedDraft>[0]) => (await storedDraft(page))?.players.find((p) => p.id === "o3")?.route;

test("explicit custom-route controls finish without dropping a waypoint and cancel without replacing the route", async ({ page }) => {
  const d = new Designer(page);
  await d.goto();
  await d.select("X");
  await d.pick("Custom");

  const finish = page.getByRole("button", { name: "Finish", exact: true });
  const removeLast = page.getByRole("button", { name: "Remove last", exact: true });
  const cancel = page.getByRole("button", { name: "Cancel", exact: true });
  await expect(finish).toBeDisabled();
  await expect(removeLast).toBeDisabled();
  await expect(finish).toHaveAttribute("title", "Finish route (Enter)");
  await expect(cancel).toHaveAttribute("title", "Cancel route (Esc)");

  await d.tapField(4, -3);
  await expect(finish).toBeEnabled();
  await finish.click();
  await expect.poll(() => routeOf(page)).toEqual({ type: "custom", pts: [[4, -3]] });

  await d.palette();
  await d.pick("Custom");
  await d.tapField(8, -8);
  await cancel.click();
  await expect.poll(() => routeOf(page)).toEqual({ type: "custom", pts: [[4, -3]] });

  await d.palette();
  await d.pick("Custom");
  await d.tapField(6, -5);
  await expect(d.field).toBeFocused();
  await page.keyboard.press("Enter");
  await expect.poll(() => routeOf(page)).toEqual({ type: "custom", pts: [[6, -5]] });

  await d.palette();
  await d.pick("Custom");
  await d.tapField(9, -9);
  await page.keyboard.press("Escape");
  await expect.poll(() => routeOf(page)).toEqual({ type: "custom", pts: [[6, -5]] });
});

test("custom waypoints can be selected, moved, added, removed, undone, and redone from accessible controls", async ({ page }) => {
  const d = new Designer(page);
  await d.goto();
  await d.select("X");
  await d.pick("Custom");
  await d.tapField(5, -3);
  await d.tapField(8, -6);
  await page.getByRole("button", { name: "Finish", exact: true }).click();

  const first = page.getByRole("button", { name: /Waypoint 1 of 2 for Offense X/ });
  await first.focus();
  await expect(first).toBeFocused();
  await first.press("ArrowRight");
  await expect.poll(() => routeOf(page)).toEqual({ type: "custom", pts: [[5.5, -3], [8, -6]] });

  await page.getByRole("button", { name: "Add waypoint" }).click();
  await expect(d.field.getByRole("button", { name: /^Waypoint/ })).toHaveCount(3);
  await expect(page.getByRole("button", { name: /Waypoint 3 of 3 for Offense X/ })).toBeFocused();
  await page.getByRole("button", { name: "Remove waypoint" }).click();
  await expect(d.field.getByRole("button", { name: /^Waypoint/ })).toHaveCount(2);

  await d.undo.click();
  await expect.poll(async () => (await routeOf(page))?.pts).toHaveLength(3);
  await d.redo.click();
  await expect.poll(async () => (await routeOf(page))?.pts).toHaveLength(2);
});

test("man targets are announced and work by keyboard while pointer targeting remains available", async ({ page }) => {
  const d = new Designer(page);
  await d.goto();
  // Defense-only remains useful while assigning Man: valid offense targets become
  // temporarily visible and focusable until the coverage is committed.
  await d.clickTool("Defense");
  await d.select("d1", "Defense");
  await d.pick("Man");

  const firstTarget = d.field.getByRole("button", { name: "Offense C, man coverage target" });
  await expect(firstTarget).toBeFocused();
  await expect(page.getByText(/Targeting for Defense d1\. Focus an offense player/)).toBeAttached();
  await firstTarget.press("Enter");
  await expect.poll(async () => (await storedDraft(page))?.players.find((p) => p.id === "d1")?.route).toEqual({ type: "man", target: "o1" });

  await d.select("d2", "Defense");
  await d.pick("Man");
  await d.field.getByRole("button", { name: "Offense X, man coverage target" }).click();
  await expect.poll(async () => (await storedDraft(page))?.players.find((p) => p.id === "d2")?.route).toEqual({ type: "man", target: "o3" });
});

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
  await page.getByRole("dialog", { name: "Share snapshot" }).getByRole("button", { name: "Copy snapshot link" }).click();
  await expect(d.toast).toHaveText("Link copied");
  const url = await page.evaluate(() => navigator.clipboard.readText());
  await page.goto(url);
  await expect(page.getByRole("img", { name: "Play diagram" }).locator("path[stroke='#c2261a']")).toHaveCount(1);
});
