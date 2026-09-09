import { expect, test } from "@playwright/test";
import { Designer } from "../support/designer";
import { WHEEL_RIGHT, seed } from "../support/fixtures";

/**
 * A smoke check that ▶ runs and comes back. Deterministic playback assertions (who gets
 * the ball, where everyone ends) are added with issue #35.
 */
test("▶ runs the play, shows the ball, and returns to the whiteboard with nothing moved", async ({ page }) => {
  await seed(page, { plays: [WHEEL_RIGHT] });
  const d = new Designer(page);
  await d.goto("?open=fx-wheel-right");
  const run = page.getByRole("button", { name: "Run the play" });
  await run.click();
  await expect(page.getByRole("button", { name: "Stop the play" })).toHaveAttribute("aria-pressed", "true");
  await expect(d.field.locator("image")).toBeVisible();
  await expect(run).toBeVisible({ timeout: 20_000 });
  await expect(d.field.locator("image")).toHaveCount(0);
  expect(await d.playerX("Z")).toBe(19);
  expect(await d.playerX("Y")).toBe(27);
});
