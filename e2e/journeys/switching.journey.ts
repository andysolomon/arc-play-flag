import { writeFileSync } from "node:fs";
import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";
import { ENDZONE_KEY } from "../../lib/endzone";
import { FIELD_KEY, THEME_KEY } from "../../lib/theme";
import { Designer } from "../support/designer";
import { GOAL_LINE_FADE, OTTERS, playbook, seed } from "../support/fixtures";

/*
 * Switching the look: a theme, an end zone or the themed field redraws the whole page, which can
 * hold a phone for a moment. Each pick puts up a "Switching to …" interstitial first, makes the
 * change once that is on screen, and takes it down once the new look is. What could go wrong, and
 * the test (by the start of its title) that catches each:
 *
 *  - the page redraws before the interstitial is up, so the tap still looks ignored → "a theme pick"
 *  - the interstitial never comes down, or the pick never lands, or lands wrong → "a theme pick", "an end zone"
 *  - the interstitial comes down before the new look is in place → "a theme pick", "an end zone"
 *  - it names the wrong thing, or isn't announced (no status) → "a theme pick", "an end zone"
 *  - the picker reads unchecked until the switch lands, so the tap (or a screen reader) says it
 *    didn't take → "a theme pick", "an end zone"
 *  - a tap lands on the page underneath mid-switch (no scrim) → "a theme pick"
 *  - an end zone pick or the Themed field switch skips it → "an end zone"
 *  - picks made while one is up (arrow keys along a picker) land out of order, or the first one
 *    wins; or the interstitial takes focus off the picker → "arrow keys"
 *  - the spinner spins under reduced motion, or stands still with motion allowed → "a theme pick", "arrow keys"
 *  - in playbook settings (a modal dialog) it is drawn under the dialog → "playbook settings"
 * Keeping it quick: the end zone picker's previews (about half the page's nodes) are left for the
 * browser to skip while off screen, so a theme pick restyles only what is in view first.
 *  - a preview changes size as it is drawn in, so the picker jumps under the coach's thumb, or a
 *    preview scrolled into view after a theme pick is left blank → "end zone previews"
 *
 * The field is spotted near their goal (GOAL_LINE_FADE), so its end zone is on every screen.
 * The clock is paused around each pick, so the interstitial holds still to be looked at: nothing
 * but the interstitial may have changed until the clock runs. Artifacts, in test-results/:
 * switching-<device>-<test>.json (each switch: what the interstitial said, and the theme, field and
 * end zone before the pick, while it was up and after it came down), a picture of it up over the
 * designer and over playbook settings, and switching-<device>-previews.json with a picture of the
 * end zone picker after a theme pick (each preview's box before and after, and whether it drew).
 */

const BOOK = playbook("fx-book", "Otter Book", [GOAL_LINE_FADE]);

const overlay = (page: Page): Locator => page.locator("[data-repainting]");
const status = (page: Page): Locator => overlay(page).getByRole("status");

interface Look { theme: string | null; field: string | null; endZone: string | null }
interface Switch { pick: string; said: string; before: Look; during: Look; checkedDuring: boolean; after: Look }

/** Each test's switches, in the order made: test-results/switching-<device>-<name>.json. */
function keep(testInfo: TestInfo, name: string, switches: readonly Switch[]): void {
  writeFileSync(`test-results/switching-${testInfo.project.name}-${name}.json`, `${JSON.stringify({ switches }, null, 2)}\n`);
}

const look = (page: Page): Promise<Look> =>
  page.evaluate(() => ({
    theme: document.documentElement.dataset.theme ?? null,
    field: document.documentElement.dataset.field ?? null,
    endZone: document.querySelector("[aria-label='Play diagram'] [data-ez-art]")?.getAttribute("data-ez-art") ?? null,
  }));

/** Stops the page's clock (timers and animation frames), so a switch stays at its first step until run(). */
async function pause(page: Page): Promise<void> {
  const now = await page.evaluate(() => Date.now());
  await page.clock.pauseAt(now + 1_000);
}

/** Makes a pick with the clock paused and checks the interstitial is up with nothing yet changed, then lets it finish. */
async function pickAndWatch(page: Page, pick: string, picked: Locator, act: () => Promise<void>, said: string, shot?: string): Promise<Switch> {
  const before = await look(page);
  await pause(page);
  await act();
  await expect(status(page)).toHaveText(said);
  const during = await look(page);
  expect(during).toEqual(before);
  const checkedDuring = await picked.isChecked();
  if (shot) await page.screenshot({ path: shot, animations: "disabled" });
  await page.clock.resume();
  await expect(overlay(page)).toHaveCount(0);
  const after = await look(page);
  await expect(picked).toBeChecked();
  return { pick, said, before, during, checkedDuring, after };
}

test.beforeEach(async ({ page }) => {
  await page.clock.install();
  await seed(page, { plays: [GOAL_LINE_FADE], playbooks: [BOOK], team: OTTERS });
});

test("a theme pick puts up the interstitial before the page redraws, and takes it down once the new theme is drawn", async ({ page }, testInfo) => {
  const d = new Designer(page);
  await d.openSaved(GOAL_LINE_FADE.name);
  await d.tools();
  const theme = page.getByRole("radiogroup", { name: "Theme" });
  const shot = `test-results/switching-${testInfo.project.name}-designer.png`;

  const tokyo = theme.getByRole("radio", { name: "Tokyo Night" });
  const s = await pickAndWatch(page, "theme tokyo-night", tokyo, () => tokyo.click(), "Switching to Tokyo Night…", shot);
  expect(s.before.theme).toBe("light");
  expect(s.checkedDuring).toBe(true);
  expect(s.after.theme).toBe("tokyo-night");
  expect(await page.evaluate((k) => localStorage.getItem(k), THEME_KEY)).toBe("tokyo-night");

  // mid-switch: a scrim over the whole page takes the taps, and (reduced motion here) the spinner holds still
  await pause(page);
  await theme.getByRole("radio", { name: "Dark" }).click();
  await expect(overlay(page)).toBeVisible();
  const box = await overlay(page).boundingBox();
  expect(box).toEqual({ x: 0, y: 0, ...page.viewportSize() });
  expect(await overlay(page).evaluate((el) => {
    const r = el.getBoundingClientRect();
    return document.elementFromPoint(r.width / 2, 8)?.closest("[data-repainting]") === el;
  })).toBe(true);
  expect(await status(page).locator("[aria-hidden]").evaluate((el) => getComputedStyle(el).animationName)).toBe("none");
  await page.clock.resume();
  await expect(overlay(page)).toHaveCount(0);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  // with motion allowed it spins
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await pause(page);
  await theme.getByRole("radio", { name: "Light" }).click();
  expect(await status(page).locator("[aria-hidden]").evaluate((el) => getComputedStyle(el).animationName)).toBe("spin");
  await page.clock.resume();
  await expect(overlay(page)).toHaveCount(0);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  keep(testInfo, "theme", [s]);
});

test("an end zone pick and the Themed field switch go through the interstitial too", async ({ page }, testInfo) => {
  await page.evaluate((k) => { localStorage.setItem(k, "gruvbox"); }, THEME_KEY);
  const d = new Designer(page);
  await d.openSaved(GOAL_LINE_FADE.name);
  await d.tools();
  const zones = page.getByRole("radiogroup", { name: "End zone" });

  const synthwave = zones.locator("input[value='synthwave']");
  const z = await pickAndWatch(page, "end zone synthwave", synthwave, () => synthwave.click(), "Switching to the Synthwave '84 end zone…");
  expect(z.checkedDuring).toBe(true);
  expect(z.before.endZone).toBeNull(); // the classic band is the field's own, not a design
  expect(z.after.endZone).toBe("synthwave");
  expect(await page.evaluate((k) => localStorage.getItem(k), ENDZONE_KEY)).toBe("synthwave");

  const themed = page.getByRole("switch", { name: /Themed field/ });
  const on = await pickAndWatch(page, "field themed", themed, () => themed.click(), "Switching to the themed field…");
  expect(on.checkedDuring).toBe(true);
  expect([on.before.field, on.after.field]).toEqual(["standard", "themed"]);
  expect(await page.evaluate((k) => localStorage.getItem(k), FIELD_KEY)).toBe("themed");

  await pause(page);
  await themed.click();
  await expect(status(page)).toHaveText("Switching to the green field…");
  await expect(themed).not.toBeChecked();
  await page.clock.resume();
  await expect(overlay(page)).toHaveCount(0);
  await expect(page.locator("html")).toHaveAttribute("data-field", "standard");
  expect(await page.evaluate((k) => localStorage.getItem(k), FIELD_KEY)).toBeNull();
  keep(testInfo, "end-zone-and-field", [z, on]);
});

test("arrow keys along the picker while it is up: the last pick lands, and focus stays on the picker", async ({ page }, testInfo) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  const d = new Designer(page);
  await d.goto();
  await d.tools();
  const theme = page.getByRole("radiogroup", { name: "Theme" });
  await theme.getByRole("radio", { name: "Dark" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(overlay(page)).toHaveCount(0);

  const before = await look(page);
  await pause(page);
  await theme.getByRole("radio", { name: "Dark" }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(status(page)).toHaveText("Switching to Tokyo Night…");
  await page.keyboard.press("ArrowRight");
  await expect(status(page)).toHaveText("Switching to Catppuccin…");
  await expect(theme.getByRole("radio", { name: "Catppuccin" })).toBeChecked();
  expect(await look(page)).toEqual(before);
  await expect(status(page).locator("[aria-hidden]")).toHaveCSS("animation-name", "spin");
  await page.clock.resume();
  await expect(overlay(page)).toHaveCount(0);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "catppuccin");
  expect(await page.evaluate((k) => localStorage.getItem(k), THEME_KEY)).toBe("catppuccin");
  await expect(theme.getByRole("radio", { name: "Catppuccin" })).toBeFocused();
  await expect(theme.getByRole("radio", { name: "Catppuccin" })).toBeChecked();
  keep(testInfo, "keys", [{ pick: "theme catppuccin by keys", said: "Switching to Catppuccin…", before, during: before, checkedDuring: true, after: await look(page) }]);
});

test("playbook settings: the interstitial is drawn over the dialog, not under it", async ({ page }, testInfo) => {
  await page.goto("/playbooks");
  const settings = page.getByRole("dialog", { name: "Team, theme & backup" });
  await expect(async () => {
    await page.getByRole("button", { name: /team, theme & backup settings/ }).click();
    await expect(settings).toBeVisible({ timeout: 1_000 });
  }).toPass();
  const theme = settings.getByRole("radiogroup", { name: "Theme" });
  const shot = `test-results/switching-${testInfo.project.name}-settings.png`;

  const nord = theme.getByRole("radio", { name: "Nord" });
  const s = await pickAndWatch(page, "settings theme nord", nord, async () => {
    await nord.click();
    await expect(settings.locator("[data-repainting]")).toBeVisible();
    // what is at the middle of the screen is the interstitial, above the dialog
    expect(await page.evaluate(() => !!document.elementFromPoint(innerWidth / 2, innerHeight / 2)?.closest("[data-repainting]"))).toBe(true);
  }, "Switching to Nord…", shot);
  expect(s.after.theme).toBe("nord");
  await expect(settings).toBeVisible();
  keep(testInfo, "settings", [s]);
});

test("end zone previews keep their size while the browser draws them in, and each draws its design once in view", async ({ page }, testInfo) => {
  await page.evaluate(() => { localStorage.setItem("ffpd.touchdowns.v1", "9"); });
  const d = new Designer(page);
  await d.openSaved(GOAL_LINE_FADE.name);
  await d.tools();
  const zones = page.getByRole("radiogroup", { name: "End zone" });
  const previews = zones.locator("label > span.relative");
  await expect(previews).toHaveCount(8);
  const boxes = (): Promise<{ id: string; w: number; h: number; drawn: boolean }[]> =>
    previews.evaluateAll((els) => els.map((el) => {
      const r = el.getBoundingClientRect();
      return {
        id: el.querySelector("[data-ez-art]")?.getAttribute("data-ez-art") ?? "",
        w: Math.round(r.width * 10) / 10,
        h: Math.round(r.height * 10) / 10,
        drawn: el.checkVisibility({ contentVisibilityAuto: true }),
      };
    }));

  // picking a theme with the previews below it, as a coach does
  await page.getByRole("radiogroup", { name: "Theme" }).scrollIntoViewIfNeeded();
  const before = await boxes();
  for (const b of before) expect(Math.abs(b.h - (b.w * 84) / 300), `${b.id} keeps the preview's shape`).toBeLessThan(1);
  await page.getByRole("radiogroup", { name: "Theme" }).getByRole("radio", { name: "Tokyo Night" }).click();
  await expect(overlay(page)).toHaveCount(0);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "tokyo-night");

  // each one, scrolled to, is drawn at the size it held, with its design in it
  const after: Awaited<ReturnType<typeof boxes>> = [];
  for (let i = 0; i < 8; i++) {
    const preview = previews.nth(i);
    await preview.scrollIntoViewIfNeeded();
    await expect.poll(() => preview.evaluate((el) => el.checkVisibility({ contentVisibilityAuto: true }))).toBe(true);
    const art = await preview.locator("[data-ez-art]").evaluate((g) => {
      const b = (g as SVGGraphicsElement).getBBox();
      return { w: b.width, h: b.height };
    });
    expect(art.w, `preview ${String(i)} has its design drawn`).toBeGreaterThan(0);
    expect(art.h).toBeGreaterThan(0);
    const now = (await boxes())[i];
    if (now) after.push(now);
  }
  expect(after.map(({ id, w, h }) => ({ id, w, h }))).toEqual(before.map(({ id, w, h }) => ({ id, w, h })));
  expect(after.every((a) => a.drawn)).toBe(true);

  await zones.screenshot({ path: `test-results/switching-${testInfo.project.name}-previews.png`, animations: "disabled" });
  writeFileSync(`test-results/switching-${testInfo.project.name}-previews.json`, `${JSON.stringify({ theme: "tokyo-night", before, after }, null, 2)}\n`);
});
