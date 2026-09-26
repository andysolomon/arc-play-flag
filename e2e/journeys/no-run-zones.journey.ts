import { expect, test, type Locator } from "@playwright/test";
import { Designer } from "../support/designer";
import { KEYS, OTTERS, SLANT_LEFT, playbook, seed } from "../support/fixtures";

test.use({ permissions: ["clipboard-read", "clipboard-write"] });

/** The hatched no-run bands: the only rects on a field filled with a pattern. */
const bands = (field: Locator) => field.locator('rect[fill^="url(#"]');
const noRunLabel = (field: Locator) => field.locator("text", { hasText: "NO-RUN" });

test("a league without no-run zones turns them off once, and the field, reload and share link follow", async ({ page }, testInfo) => {
  const d = new Designer(page);
  await d.goto();
  // every team starts with them, as the field always had
  await expect(bands(d.field)).not.toHaveCount(0);
  await expect(noRunLabel(d.field)).not.toHaveCount(0);
  await d.closeSidebars();
  await d.field.screenshot({ path: `test-results/no-run-zones-${testInfo.project.name}-on.png` });

  await d.tools();
  const toggle = page.locator("#play-sidebar").getByRole("checkbox", { name: "No-run zones" });
  await expect(toggle).toBeChecked();
  await toggle.uncheck();
  await expect(bands(d.field)).toHaveCount(0);
  await expect(noRunLabel(d.field)).toHaveCount(0);
  // the rest of the field is untouched: the LOS and the yard numbers stay
  await expect(d.field.locator("text", { hasText: "LOS" })).toHaveCount(1);
  const team = await page.evaluate((key) => localStorage.getItem(key), KEYS.team);
  expect(JSON.parse(team ?? "{}")).toMatchObject({ noRunZones: false });
  await d.closeSidebars();
  await d.field.screenshot({ path: `test-results/no-run-zones-${testInfo.project.name}-off.png` });

  // a new play and a reload keep the team's field
  await d.newPlay("Defense");
  await expect(bands(d.field)).toHaveCount(0);
  await page.reload();
  await expect(d.field).toBeVisible();
  await expect(bands(d.field)).toHaveCount(0);
  await d.tools();
  await expect(page.locator("#play-sidebar").getByRole("checkbox", { name: "No-run zones" })).not.toBeChecked();

  // the snapshot shows the field the coach saw, even to a device that has the zones on
  await d.clickTool("Copy share link");
  const dialog = page.getByRole("dialog", { name: "Share snapshot" });
  await expect(bands(dialog.getByRole("img", { name: "Defense snapshot preview" }))).toHaveCount(0);
  await dialog.getByRole("button", { name: "Copy snapshot link" }).click();
  await expect(d.toast).toHaveText("Link copied");
  const url = await page.evaluate(() => navigator.clipboard.readText());
  await page.evaluate((key) => { localStorage.removeItem(key); }, KEYS.team);
  await page.goto(url);
  const shared = page.getByRole("img", { name: "Play diagram" });
  await expect(shared).toBeVisible();
  await expect(bands(shared)).toHaveCount(0);

  // turning them back on brings them back, and a link made then carries them
  await d.goto();
  await expect(bands(d.field)).not.toHaveCount(0);
  await d.clickTool("Copy share link");
  await dialog.getByRole("button", { name: "Copy snapshot link" }).click();
  await page.goto(await page.evaluate(() => navigator.clipboard.readText()));
  await expect(bands(page.getByRole("img", { name: "Play diagram" }))).not.toHaveCount(0);
});

test("playbook settings turn them off for every picture and printout preview on the device", async ({ page }) => {
  await seed(page, { plays: [SLANT_LEFT], playbooks: [playbook("fx-nrz", "Otter No-Run Book", [SLANT_LEFT])], team: OTTERS });
  await page.goto("/playbooks?book=fx-nrz");
  const preview = page.getByRole("img", { name: "Playbook PDF preview" });
  await expect(preview).toBeVisible();
  await expect(bands(preview)).not.toHaveCount(0);

  await page.goto("/playbooks");
  const thumb = page.getByRole("img", { name: "Otter Slant Left" }).first();
  await expect(thumb).toBeVisible();
  await expect(bands(thumb)).not.toHaveCount(0);

  await page.getByRole("button", { name: /Riverside Otters · team, theme & backup settings/ }).click();
  const settings = page.getByRole("dialog", { name: "Team, theme & backup" });
  const toggle = settings.getByRole("checkbox", { name: "No-run zones" });
  await expect(toggle).toBeChecked();
  await toggle.uncheck();
  await expect(toggle).not.toBeChecked();
  await expect(bands(thumb)).toHaveCount(0);
  // the rest of the team is kept as it was
  const team = await page.evaluate((key) => localStorage.getItem(key), KEYS.team);
  expect(JSON.parse(team ?? "{}")).toEqual({ ...OTTERS, noRunZones: false });

  await page.goto("/playbooks?book=fx-nrz");
  await expect(preview).toBeVisible();
  await expect(bands(preview)).toHaveCount(0);

  // the designer reads the same setting
  const d = new Designer(page);
  await d.goto();
  await expect(bands(d.field)).toHaveCount(0);
});
