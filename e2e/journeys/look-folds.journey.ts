import { writeFileSync } from "node:fs";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { END_ZONES } from "../../lib/endzone";
import { Designer } from "../support/designer";

/**
 * Theme and End zone fold away in Play tools, so the swatches don't sit between a coach and the
 * play. How this could break, and the test that catches each:
 *  - a section starts open, so the swatches are in the way on every visit              → "start folded"
 *  - a folded section still draws its swatches (and fetches every end zone's design)    → "start folded"
 *  - the header doesn't say what is picked, so a coach must open it to find out         → "start folded", "a pick"
 *  - the header isn't a button, or doesn't say whether it is open (aria-expanded)       → "start folded"
 *  - a tap or the keyboard doesn't open it, or it can't be closed again                 → "start folded"
 *  - the header still names the old look after a pick                                   → "a pick"
 *  - folding Play tools away, or a reload, loses the pick, or a reload leaves it open   → "a pick"
 *  - playbook settings, opened to change the look, fold it away too                     → "playbook settings"
 * Leaves `look-folds-<device>.json` (each step's folds and what their headers said) and a picture
 * of Play tools folded and unfolded in test-results/.
 */

interface Step { step: string; theme: Fold; endZone: Fold }
interface Fold { expanded: string | null; says: string; drawn: number }

const tools = (page: Page): Locator => page.locator("#play-sidebar");
const themeFold = (page: Page): Locator => tools(page).getByRole("button", { name: /^Theme\b/i });
const endZoneFold = (page: Page): Locator => tools(page).getByRole("button", { name: /^End zone\b/i });
const themes = (page: Page): Locator => tools(page).getByRole("radiogroup", { name: "Theme" });
const endZones = (page: Page): Locator => tools(page).getByRole("radiogroup", { name: "End zone" });

async function read(page: Page, step: string): Promise<Step> {
  const fold = async (button: Locator, group: Locator): Promise<Fold> => ({
    expanded: await button.getAttribute("aria-expanded"),
    says: (await button.innerText()).replace(/\s+/g, " ").trim(),
    drawn: await group.getByRole("radio").count(),
  });
  return { step, theme: await fold(themeFold(page), themes(page)), endZone: await fold(endZoneFold(page), endZones(page)) };
}

test("Theme and End zone start folded in Play tools, say what is picked, and open and close on a tap or a key", async ({ page }, testInfo) => {
  const steps: Step[] = [];
  const d = new Designer(page);
  await d.goto();
  await d.tools();

  // folded: a button that says so and names the look, and nothing of the pickers drawn
  for (const [fold, says] of [[themeFold(page), "Auto"], [endZoneFold(page), "Classic"]] as const) {
    await expect(fold).toHaveAttribute("aria-expanded", "false");
    await expect(fold).toContainText(says);
    const region = await fold.getAttribute("aria-controls");
    expect(region, "the header names the section it folds").toBeTruthy();
  }
  await expect(themes(page)).toHaveCount(0);
  await expect(endZones(page)).toHaveCount(0);
  await expect(tools(page).getByRole("switch", { name: /Themed field/ })).toHaveCount(0);
  await expect(tools(page).locator("[data-ez-art]")).toHaveCount(0);
  steps.push(await read(page, "fresh"));
  await endZoneFold(page).scrollIntoViewIfNeeded();
  await tools(page).screenshot({ path: `test-results/look-folds-${testInfo.project.name}-folded.png` });

  // a tap opens each, into the section the header names
  await themeFold(page).click();
  await expect(themeFold(page)).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator(`#${String(await themeFold(page).getAttribute("aria-controls"))}`).getByRole("radiogroup", { name: "Theme" })).toBeVisible();
  await expect(tools(page).getByRole("switch", { name: /Themed field/ })).toBeVisible();
  await endZoneFold(page).click();
  await expect(endZoneFold(page)).toHaveAttribute("aria-expanded", "true");
  const swatches = endZones(page).locator("[data-ez-art]");
  await expect(swatches).toHaveCount(END_ZONES.length);
  steps.push(await read(page, "unfolded"));
  await themeFold(page).evaluate((el) => { el.scrollIntoView({ block: "start" }); });
  await tools(page).screenshot({ path: `test-results/look-folds-${testInfo.project.name}-unfolded.png` });

  // the keyboard folds it away again, and focus stays on the header
  await themeFold(page).focus();
  await page.keyboard.press("Enter");
  await expect(themeFold(page)).toHaveAttribute("aria-expanded", "false");
  await expect(themes(page)).toHaveCount(0);
  await expect(themeFold(page)).toBeFocused();
  await page.keyboard.press("Space");
  await expect(themeFold(page)).toHaveAttribute("aria-expanded", "true");
  await expect(themes(page)).toBeVisible();
  steps.push(await read(page, "keyboard"));

  writeFileSync(`test-results/look-folds-${testInfo.project.name}.json`, `${JSON.stringify({ test: "start folded", steps }, null, 2)}\n`);
});

test("a pick shows in the folded header, outlasts folding Play tools and a reload, and a reload folds the sections again", async ({ page }, testInfo) => {
  const steps: Step[] = [];
  const d = new Designer(page);
  await d.goto();
  await d.tools();

  await themeFold(page).click();
  await themes(page).getByRole("radio", { name: "Light" }).check();
  await expect(page.locator("[data-repainting]")).toHaveCount(0);
  await expect(themeFold(page)).toContainText("Light");
  await endZoneFold(page).click();
  await endZones(page).getByRole("radio", { name: "Synthwave '84", exact: true }).check();
  await expect(page.locator("[data-repainting]")).toHaveCount(0);
  await expect(endZoneFold(page)).toContainText("Synthwave '84");
  steps.push(await read(page, "picked"));

  // folded, the header still says it
  await themeFold(page).click();
  await expect(themeFold(page)).toHaveAttribute("aria-expanded", "false");
  await expect(themeFold(page)).toContainText("Light");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");

  // Play tools folded away and back: each section is as it was left
  await d.closeSidebars();
  await d.tools();
  await expect(themeFold(page)).toHaveAttribute("aria-expanded", "false");
  await expect(endZoneFold(page)).toHaveAttribute("aria-expanded", "true");
  await expect(endZones(page).getByRole("radio", { name: "Synthwave '84", exact: true })).toBeChecked();
  steps.push(await read(page, "tools reopened"));

  // a reload keeps the picks and folds both away again
  await page.reload();
  await expect(d.field).toBeVisible();
  await d.tools();
  await expect(themeFold(page)).toHaveAttribute("aria-expanded", "false");
  await expect(endZoneFold(page)).toHaveAttribute("aria-expanded", "false");
  await expect(themeFold(page)).toContainText("Light");
  await expect(endZoneFold(page)).toContainText("Synthwave '84");
  await expect(tools(page).locator("[data-ez-art]")).toHaveCount(0);
  steps.push(await read(page, "reloaded"));

  writeFileSync(`test-results/look-folds-${testInfo.project.name}-picks.json`, `${JSON.stringify({ test: "a pick", steps }, null, 2)}\n`);
});

test("playbook settings, opened to change the look, show both pickers without a fold", async ({ page }) => {
  await page.goto("/playbooks");
  const settings = page.getByRole("dialog", { name: "Team, theme & backup" });
  await expect(async () => {
    await page.getByRole("button", { name: /team, theme & backup settings/ }).click();
    await expect(settings).toBeVisible({ timeout: 1_000 });
  }).toPass();
  await expect(settings.getByRole("radiogroup", { name: "Theme" })).toBeVisible();
  await expect(settings.getByRole("radiogroup", { name: "End zone" })).toBeVisible();
  await expect(settings.getByRole("button", { name: /^(Theme|End zone)\b/i })).toHaveCount(0);
});
