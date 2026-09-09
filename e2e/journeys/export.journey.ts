import { expect, test } from "@playwright/test";
import { Designer, armSabotage, downloadBytes, sabotage } from "../support/designer";
import { WHEEL_RIGHT, seed } from "../support/fixtures";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

test("the picture card saves as a PNG and says so", async ({ page }) => {
  await seed(page, { plays: [WHEEL_RIGHT] });
  const d = new Designer(page);
  await d.goto("?open=fx-wheel-right");
  await d.clickTool("Export");
  const panel = page.locator("[aria-label='Export play']");
  const status = panel.getByRole("status");
  await expect(status).toHaveText("Portrait clip: formation, run, then a final hold.");

  const [download] = await Promise.all([page.waitForEvent("download"), panel.getByRole("button", { name: "Save picture card" }).click()]);
  expect(download.suggestedFilename()).toBe("otter-wheel-right.png");
  expect((await downloadBytes(download)).subarray(0, 8)).toEqual(PNG);
  await expect(status).toHaveText("Card saved");
  await expect(panel.getByRole("button", { name: "Save picture card" })).toBeEnabled();
});

test("a card that cannot be drawn reports the failure instead of a save", async ({ page }) => {
  await armSabotage(page);
  await seed(page, { plays: [WHEEL_RIGHT] });
  const d = new Designer(page);
  await d.goto("?open=fx-wheel-right");
  await d.clickTool("Export");
  const panel = page.locator("[aria-label='Export play']");
  let downloaded = false;
  page.on("download", () => { downloaded = true; });

  await sabotage(page, "noCanvas", true);
  await panel.getByRole("button", { name: "Save picture card" }).click();
  await expect(panel.getByRole("status")).toHaveText("No canvas.");
  await expect(panel.getByRole("button", { name: "Save picture card" })).toBeEnabled();
  expect(downloaded).toBe(false);
});
