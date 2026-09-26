import { writeFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { PREMIUM_THEMES } from "../../lib/theme";
import { Designer } from "../support/designer";
import { OTTERS, SLANT_LEFT, playbook, seed } from "../support/fixtures";

/*
 * Premium themes: locked until this device holds a playbook, then each one redraws the whole app.
 * What could go wrong, and where each is caught:
 *  - a premium theme can be picked with no playbook, or stays locked after one is made   → test 1
 *  - the pick doesn't reach <html>, the browser chrome, or doesn't survive a reload       → test 1, 2
 *  - a swatch previews the page's theme instead of its own                                → test 1
 *  - a dark theme keeps the ink stickers, which vanish on its board                        → test 2
 *  - words drop below WCAG AA: ink, muted ink, links, the dark pill, the highlighter's ink → test 2 (a JSON report + a screenshot per theme)
 *  - printing from a premium theme prints its colours                                      → test 3
 *  - deleting every playbook takes away the theme in use                                   → test 3
 */

const THEME_KEY = "ffpd.theme.v1";
const INK = "rgb(27, 26, 23)";
const html = (page: Page) => page.locator("html");
const picker = (page: Page) => page.getByRole("radiogroup", { name: "Theme" });
const BOOK = playbook("fx-otter-book", "Otter Game Plan", [SLANT_LEFT]);

/** WCAG relative-luminance contrast of two opaque colours as the browser reports them, rgb(). */
function contrast(a: string, b: string): number {
  const rgb = (c: string): number[] => {
    const parts = /rgba?\(([^)]+)\)/.exec(c)?.[1]?.split(/[\s,/]+/).filter(Boolean).slice(0, 3).map(Number);
    if (parts?.length !== 3) throw new Error(`not a colour: ${c}`);
    return parts;
  };
  const lum = (c: string): number => {
    const [r = 0, g = 0, b2 = 0] = rgb(c).map((v) => v / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b2;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const toHex = (rgb: string): string =>
  "#" + (/rgba?\(([^)]+)\)/.exec(rgb)?.[1] ?? "").split(/[\s,]+/).slice(0, 3).map((n) => Number(n).toString(16).padStart(2, "0")).join("");

test("premium themes stay locked until a coach makes a playbook, then one redraws the app and outlasts a reload", async ({ page }, testInfo) => {
  await seed(page, { plays: [SLANT_LEFT], team: OTTERS });
  await page.goto("/playbooks");
  const settings = page.getByRole("button", { name: /team, theme & backup settings/ });
  const dialog = page.getByRole("dialog", { name: "Team, theme & backup" });
  // the first tap after a navigation can land before React has hydrated; tap again if it did
  await expect(async () => {
    await settings.click();
    await expect(dialog).toBeVisible({ timeout: 1_000 });
  }).toPass();
  for (const t of PREMIUM_THEMES) await expect(dialog.getByRole("radio", { name: t.name })).toBeDisabled();
  await expect(dialog.getByText("Make a playbook to unlock eight hand-tuned palettes")).toBeVisible();
  // a locked swatch still shows its own colours, not the page's
  await expect(dialog.locator('[data-theme="nord"] > span').first()).toHaveCSS("background-color", "rgb(46, 52, 64)");
  await dialog.getByRole("radiogroup", { name: "Theme" }).screenshot({ path: `test-results/premium-theme-${testInfo.project.name}-locked.png` });
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();

  await page.getByRole("button", { name: "+ New playbook" }).click();
  await expect(page).toHaveURL(/\/playbooks\?book=/);
  await page.getByRole("link", { name: "‹ All playbooks" }).click();
  await settings.click();
  const tokyo = dialog.getByRole("radio", { name: "Tokyo Night" });
  await expect(tokyo).toBeEnabled();
  await expect(dialog.getByText("Unlocked by your playbook.")).toBeVisible();
  await tokyo.check();
  await expect(html(page)).toHaveAttribute("data-theme", "tokyo-night");
  expect(await page.evaluate((k) => localStorage.getItem(k), THEME_KEY)).toBe("tokyo-night");
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute("content", "#1f2335");
  await expect(page.locator("body")).toHaveCSS("background-color", "rgb(26, 27, 38)");

  await page.reload();
  await expect(html(page)).toHaveAttribute("data-theme", "tokyo-night");
  await expect(page.locator("body")).toHaveCSS("background-color", "rgb(26, 27, 38)");
});

test("every premium theme keeps its words readable, with a contrast report and a picture of each", async ({ page }, testInfo) => {
  await seed(page, { plays: [SLANT_LEFT], playbooks: [BOOK], team: OTTERS });
  const d = new Designer(page);
  await d.goto();
  await d.tools();
  const tools = page.locator("#play-sidebar");
  const save = tools.getByRole("button", { name: "Save", exact: true });
  const report: Record<string, Record<string, number>> = {};

  for (const t of PREMIUM_THEMES) {
    await picker(page).getByRole("radio", { name: t.name }).check();
    await expect(html(page)).toHaveAttribute("data-theme", t.id);

    // the browser chrome is tinted with the header the coach actually sees
    const header = await page.locator("header").first().evaluate((el) => getComputedStyle(el).backgroundColor);
    await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute("content", toHex(header));
    expect(toHex(header)).toBe(t.color);

    await expect(save.locator("img:visible")).toHaveCount(1);
    await expect(save.locator("img:visible")).toHaveAttribute("src", t.tone === "dark" ? /save-dark\.png/ : /save\.png/);

    // each token as the browser resolves it, through a probe the page never shows
    const tokens = await page.evaluate(() => {
      const probe = document.createElement("span");
      document.body.append(probe);
      const v = (name: string): string => {
        probe.style.color = `var(${name})`;
        return getComputedStyle(probe).color;
      };
      const out = {
        paper: v("--color-paper"), cream: v("--color-cream"), white: v("--color-white"), ink: v("--color-ink"),
        ink2: v("--color-ink-2"), muted: v("--color-ink-muted"), yellow: v("--color-yellow"), accentInk: v("--color-accent-ink"),
        yellowSoft: v("--color-yellow-soft"), roseSoft: v("--color-rose-soft"), link: v("--color-link"), linkHover: v("--color-link-hover"),
      };
      probe.remove();
      return out;
    });
    // the open Play tools toggle is a yellow fill: what a coach reads on the highlighter
    const toggle = await page.getByRole("button", { name: "Play tools" }).evaluate((el) => {
      const s = getComputedStyle(el);
      return { fg: s.color, bg: s.backgroundColor };
    });
    const pairs: Record<string, [string, string]> = {
      "ink on paper": [tokens.ink, tokens.paper],
      "ink on cream": [tokens.ink, tokens.cream],
      "ink on controls": [tokens.ink, tokens.white],
      "muted on paper": [tokens.muted, tokens.paper],
      "muted on cream": [tokens.muted, tokens.cream],
      "muted on controls": [tokens.muted, tokens.white],
      "link on paper": [tokens.link, tokens.paper],
      "link on cream": [tokens.link, tokens.cream],
      "link hover on cream": [tokens.linkHover, tokens.cream],
      "dark pill": [tokens.cream, tokens.ink],
      "dark pill hover": [tokens.cream, tokens.ink2],
      "ink on hover": [tokens.ink, tokens.yellowSoft],
      "ink on primary-read": [tokens.ink, tokens.roseSoft],
      "accent ink on highlighter": [tokens.accentInk, tokens.yellow],
      "highlighted toggle": [toggle.fg, toggle.bg],
    };
    const ratios = Object.fromEntries(Object.entries(pairs).map(([k, [fg, bg]]) => [k, Math.round(contrast(fg, bg) * 100) / 100]));
    report[t.id] = ratios;
    for (const [pair, ratio] of Object.entries(ratios)) expect(ratio, `${t.name}: ${pair}`).toBeGreaterThanOrEqual(4.5);
    expect(toggle.bg).not.toBe(INK);

    await page.screenshot({ path: `test-results/premium-theme-${testInfo.project.name}-${t.id}.png` });
  }

  const file = `test-results/premium-themes-contrast-${testInfo.project.name}.json`;
  writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`);
  await testInfo.attach("contrast report", { path: file, contentType: "application/json" });

  await page.reload();
  await expect(html(page)).toHaveAttribute("data-theme", PREMIUM_THEMES.at(-1)?.id ?? "");
});

test("a premium theme prints ink on paper, and stays in use after its playbooks are gone while the rest lock again", async ({ page }) => {
  await seed(page, { plays: [SLANT_LEFT], team: OTTERS });
  // the coach picked Gruvbox back when they had a playbook, and has since deleted it
  await page.evaluate((k) => { localStorage.setItem(k, "gruvbox"); }, THEME_KEY);
  const d = new Designer(page);
  await d.goto();
  await expect(html(page)).toHaveAttribute("data-theme", "gruvbox");
  await d.tools();
  await expect(picker(page).getByRole("radio", { name: "Gruvbox" })).toBeChecked();
  await expect(picker(page).getByRole("radio", { name: "Gruvbox" })).toBeEnabled();
  await expect(picker(page).getByRole("radio", { name: "Nord" })).toBeDisabled();
  await expect(picker(page).getByRole("link", { name: "Make a playbook ›" })).toHaveAttribute("href", "/playbooks");

  await page.emulateMedia({ media: "print" });
  await expect(page.locator("body")).toHaveCSS("color", INK);
  await expect(page.locator("body")).toHaveCSS("background-color", "rgb(255, 255, 255)");

  await page.emulateMedia({ media: "screen" });
  await picker(page).getByRole("radio", { name: "Light" }).check();
  await expect(html(page)).toHaveAttribute("data-theme", "light");
  await expect(picker(page).getByRole("radio", { name: "Gruvbox" })).toBeDisabled();
});
