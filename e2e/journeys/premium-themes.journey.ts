import { writeFileSync } from "node:fs";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { PREMIUM_THEMES } from "../../lib/theme";
import { Designer } from "../support/designer";
import { COVER_TWO, OTTERS, SLANT_LEFT, WHEEL_RIGHT, playbook, seed } from "../support/fixtures";

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
 * The fold (test 5): the gallery opens when it shouldn't, or stays shut; a shut gallery still
 * takes focus or spills sideways; the row doesn't name the theme in use; a reload or a drawer
 * fold forgets an open gallery, or a new tab inherits it; the field switch hides behind the fold.
 * Cost (test 6): opening, closing or switching themes runs a long task, or a theme's restyle is slow.
 * The "Themed field" option (test 4):
 *  - it can be switched on without a premium theme, or doesn't survive a reload
 *  - the turf changes but a route, a player or the primary read keeps the standard colour
 *  - a route ink, a player's letters or the selection ring become hard to read on the new turf
 *  - it leaks into the pictures exports are drawn from, or into print
 *  - it stays painted after switching back to Light
 */

const THEME_KEY = "ffpd.theme.v1";
const INK = "rgb(27, 26, 23)";
const html = (page: Page) => page.locator("html");
const picker = (page: Page) => page.getByRole("radiogroup", { name: "Theme" });
/** The row that folds the premium gallery open and shut. */
const gallery = (scope: Page | Locator) => scope.getByRole("button", { name: /^Premium themes/ });
async function unfold(scope: Page | Locator): Promise<void> {
  const row = gallery(scope);
  if ((await row.getAttribute("aria-expanded")) !== "true") await row.click();
  await expect(row).toHaveAttribute("aria-expanded", "true");
}
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

const STANDARD_TURF = "rgb(193, 240, 193)";
const FIELD_INKS = ["route", "primary", "deep", "flat", "curl", "mid", "blitz", "cover"] as const;

/** Every --field-* token as the browser resolves it right now. */
const fieldTokens = (page: Page) => page.evaluate((names) => {
  const probe = document.createElement("span");
  document.body.append(probe);
  const out: Record<string, string> = {};
  for (const n of names) {
    probe.style.color = `var(--field-${n})`;
    out[n] = getComputedStyle(probe).color;
  }
  probe.remove();
  return out;
}, ["turf", "endzone", "line", "outline", "label", "offense", "defense", "waypoint", "ring", ...FIELD_INKS]);

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
  await expect(gallery(dialog)).toHaveAccessibleName("Premium themes, locked");
  await expect(gallery(dialog)).toContainText(`${String(PREMIUM_THEMES.length)} premium themes`);
  await expect(dialog.getByText("Make a playbook to unlock them.")).toBeVisible();
  await dialog.getByRole("radiogroup", { name: "Theme" }).screenshot({ path: `test-results/premium-theme-${testInfo.project.name}-locked-shut.png` });
  await unfold(dialog);
  for (const t of PREMIUM_THEMES) await expect(dialog.getByRole("radio", { name: t.name })).toBeDisabled();
  // a locked swatch still shows its own colours, not the page's
  await expect(dialog.locator('[data-theme="nord"] > span').first()).toHaveCSS("background-color", "rgb(46, 52, 64)");
  await dialog.getByRole("radiogroup", { name: "Theme" }).screenshot({ path: `test-results/premium-theme-${testInfo.project.name}-locked.png` });
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();

  await page.getByRole("button", { name: "+ New playbook" }).click();
  await expect(page).toHaveURL(/\/playbooks\?book=/);
  await page.getByRole("link", { name: "‹ All playbooks" }).click();
  await settings.click();
  await expect(gallery(dialog)).toHaveAccessibleName("Premium themes");
  await unfold(dialog);
  const tokyo = dialog.getByRole("radio", { name: "Tokyo Night" });
  await expect(tokyo).toBeEnabled();
  await expect(dialog.getByText("Unlocked by your playbook.")).toBeVisible();
  await tokyo.check();
  await expect(html(page)).toHaveAttribute("data-theme", "tokyo-night");
  await expect(gallery(dialog)).toHaveAccessibleName("Premium themes: Tokyo Night");
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
  await unfold(picker(page));
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
  await expect(gallery(picker(page))).toHaveAccessibleName("Premium themes: Gruvbox");
  await expect(picker(page).getByText("Make a playbook to unlock the others.")).toBeVisible();
  await expect(picker(page).getByRole("link", { name: "Make a playbook ›" })).toHaveAttribute("href", "/playbooks");
  await unfold(picker(page));
  await expect(picker(page).getByRole("radio", { name: "Gruvbox" })).toBeChecked();
  await expect(picker(page).getByRole("radio", { name: "Gruvbox" })).toBeEnabled();
  await expect(picker(page).getByRole("radio", { name: "Nord" })).toBeDisabled();

  await page.emulateMedia({ media: "print" });
  await expect(page.locator("body")).toHaveCSS("color", INK);
  await expect(page.locator("body")).toHaveCSS("background-color", "rgb(255, 255, 255)");

  await page.emulateMedia({ media: "screen" });
  await picker(page).getByRole("radio", { name: "Light" }).check();
  await expect(html(page)).toHaveAttribute("data-theme", "light");
  await expect(picker(page).getByRole("radio", { name: "Gruvbox" })).toBeDisabled();
});

test("a themed field is an option under a premium theme: it repaints the live field, keeps every ink readable, and never reaches exports or print", async ({ page }, testInfo) => {
  await seed(page, {
    plays: [WHEEL_RIGHT], playbooks: [playbook("fx-field-book", "Otter Field Book", [WHEEL_RIGHT])], team: OTTERS,
    draft: { name: WHEEL_RIGHT.name, players: WHEEL_RIGHT.players, side: "offense" },
  });
  const d = new Designer(page);
  await d.goto();
  await d.tools();
  await unfold(picker(page));
  const themed = page.getByRole("switch", { name: /Themed field/ });
  const svg = d.field;
  const primary = d.primaryRoutes.first();
  const offenseToken = page.getByRole("button", { name: /^Offense Z/ }).locator("circle[r='23']");

  // not a premium theme yet: the option waits, and the field is the standard green
  await expect(themed).toBeDisabled();
  await expect(svg).toHaveCSS("background-color", STANDARD_TURF);

  await picker(page).getByRole("radio", { name: "Tokyo Night" }).check();
  await expect(themed).toBeEnabled();
  await expect(themed).not.toBeChecked();
  await expect(svg).toHaveCSS("background-color", STANDARD_TURF);
  await themed.check();
  await expect(html(page)).toHaveAttribute("data-field", "themed");
  await expect(svg).toHaveCSS("background-color", "rgb(28, 43, 45)");
  await page.reload();
  await expect(html(page)).toHaveAttribute("data-field", "themed");
  await expect(svg).toHaveCSS("background-color", "rgb(28, 43, 45)");
  await d.tools();
  await unfold(picker(page));
  await expect(themed).toBeChecked();

  const report: Record<string, Record<string, number>> = {};
  for (const t of PREMIUM_THEMES) {
    await picker(page).getByRole("radio", { name: t.name }).check();
    await expect(html(page)).toHaveAttribute("data-theme", t.id);
    const f = await fieldTokens(page);
    expect(f.turf, `${t.name} paints its own turf`).not.toBe(STANDARD_TURF);
    // what the coach sees is the theme's paint, the primary read and the players included
    await expect(svg).toHaveCSS("background-color", f.turf ?? "");
    await expect(primary).toHaveCSS("stroke", f.primary ?? "");
    await expect(offenseToken).toHaveCSS("fill", f.offense ?? "");

    const pairs: Record<string, [string, string, number]> = {};
    for (const ink of FIELD_INKS) {
      pairs[`${ink} on turf`] = [f[ink] ?? "", f.turf ?? "", 4.5];
      pairs[`${ink} on end zone`] = [f[ink] ?? "", f.endzone ?? "", 3];
    }
    pairs["letters on offense"] = [f.label ?? "", f.offense ?? "", 4.5];
    pairs["letters on defense"] = [f.label ?? "", f.defense ?? "", 4.5];
    pairs["selection ring on turf"] = [f.ring ?? "", f.turf ?? "", 3];
    pairs["waypoint ring"] = [f.waypoint ?? "", f.outline ?? "", 3];
    const offenseSeen = Math.max(contrast(f.offense ?? "", f.turf ?? ""), contrast(f.outline ?? "", f.turf ?? ""));
    const defenseSeen = Math.max(contrast(f.defense ?? "", f.turf ?? ""), contrast(f.outline ?? "", f.turf ?? ""));
    const ratios: Record<string, number> = {
      ...Object.fromEntries(Object.entries(pairs).map(([k, [fg, bg]]) => [k, Math.round(contrast(fg, bg) * 100) / 100])),
      "offense token on turf": Math.round(offenseSeen * 100) / 100,
      "defense token on turf": Math.round(defenseSeen * 100) / 100,
    };
    report[t.id] = ratios;
    for (const [pair, [, , min]] of Object.entries(pairs)) expect(ratios[pair], `${t.name}: ${pair}`).toBeGreaterThanOrEqual(min);
    expect(offenseSeen, `${t.name}: offense token`).toBeGreaterThanOrEqual(3);
    expect(defenseSeen, `${t.name}: defense token`).toBeGreaterThanOrEqual(3);

    await svg.screenshot({ path: `test-results/premium-field-${testInfo.project.name}-${t.id}.png` });
  }
  const file = `test-results/premium-fields-contrast-${testInfo.project.name}.json`;
  writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`);
  await testInfo.attach("field contrast report", { path: file, contentType: "application/json" });

  // printing the designer puts the standard field on paper
  await picker(page).getByRole("radio", { name: "Gruvbox" }).check();
  await expect(svg).not.toHaveCSS("background-color", STANDARD_TURF);
  await page.emulateMedia({ media: "print" });
  await expect(svg).toHaveCSS("background-color", STANDARD_TURF);
  await expect(primary).toHaveCSS("stroke", "rgb(194, 38, 26)");
  await page.emulateMedia({ media: "screen" });

  // Light has no field of its own: the option waits, still remembered, and the field is green again
  await picker(page).getByRole("radio", { name: "Light" }).check();
  await expect(themed).toBeDisabled();
  await expect(themed).toBeChecked();
  await expect(svg).toHaveCSS("background-color", STANDARD_TURF);

  // exports are drawn by the same renderer as these cards: still the standard field under a themed one
  await picker(page).getByRole("radio", { name: "Kanagawa" }).check();
  await page.goto("/playbooks");
  await expect(html(page)).toHaveAttribute("data-field", "themed");
  const thumb = page.getByRole("img", { name: WHEEL_RIGHT.name }).first();
  await expect(thumb.locator("rect").first()).toHaveCSS("fill", STANDARD_TURF);
  await expect(thumb.locator("circle[r='23']").first()).toHaveCSS("fill", "rgb(229, 103, 94)");
});

test("the premium gallery folds: shut by default with the theme in use on the row, open in place in Dark and Light groups, remembered for the tab, never in the way of the field switch", async ({ page, context }, testInfo) => {
  await seed(page, { plays: [SLANT_LEFT], playbooks: [BOOK], team: OTTERS });
  await page.evaluate((k) => { localStorage.setItem(k, "tokyo-night"); }, THEME_KEY);
  const d = new Designer(page);
  await d.goto();
  await d.tools();
  const row = gallery(picker(page));
  const nord = picker(page).getByRole("radio", { name: "Nord" });
  const themed = page.getByRole("switch", { name: /Themed field/ });

  // shut: the row names the theme in use, the tiles are out of reach, the switch is not
  await expect(row).toHaveAccessibleName("Premium themes: Tokyo Night");
  await expect(row).toHaveAttribute("aria-expanded", "false");
  await expect(row).toContainText("Change");
  await expect(nord).toBeHidden();
  await expect(themed).toBeVisible();
  await row.focus();
  await page.keyboard.press("Tab");
  await expect(themed).toBeFocused();
  await picker(page).screenshot({ path: `test-results/premium-fold-${testInfo.project.name}-shut.png` });

  // open: two groups holding every tile; picking one renames the row and leaves the gallery open
  await row.click();
  await expect(row).toHaveAttribute("aria-expanded", "true");
  await expect(row).toContainText("Done");
  await expect(nord).toBeVisible();
  const dark = picker(page).getByRole("group", { name: "Dark themes" });
  const light = picker(page).getByRole("group", { name: "Light themes" });
  await expect(dark.getByRole("radio")).toHaveCount(PREMIUM_THEMES.filter((t) => t.tone === "dark").length);
  await expect(light.getByRole("radio")).toHaveCount(PREMIUM_THEMES.filter((t) => t.tone === "light").length);
  await nord.check();
  await expect(html(page)).toHaveAttribute("data-theme", "nord");
  await expect(row).toHaveAccessibleName("Premium themes: Nord");
  await expect(row).toHaveAttribute("aria-expanded", "true");
  // nothing spills sideways, on a phone drawer least of all
  const pane = page.locator("#play-sidebar > div");
  expect(await pane.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0);
  await picker(page).screenshot({ path: `test-results/premium-fold-${testInfo.project.name}-open.png` });

  // an open gallery survives a reload and the drawer folding; a fresh tab starts shut
  await page.reload();
  await d.tools();
  await expect(row).toHaveAttribute("aria-expanded", "true");
  await expect(nord).toBeVisible();
  await d.closeSidebars();
  await d.tools();
  await expect(row).toHaveAttribute("aria-expanded", "true");
  const fresh = await context.newPage();
  const f = new Designer(fresh);
  await f.goto();
  await f.tools();
  await expect(gallery(picker(fresh))).toHaveAttribute("aria-expanded", "false");
  await fresh.close();

  await row.click();
  await expect(row).toHaveAttribute("aria-expanded", "false");
  await expect(nord).toBeHidden();
  await page.reload();
  await d.tools();
  await expect(row).toHaveAttribute("aria-expanded", "false");
});

/** Frame-to-frame gaps for the next `ms` of animation frames, so a stutter shows as a long gap. */
const frameGaps = (page: Page, ms: number) => page.evaluate((ms) => new Promise<number[]>((resolve) => {
  const gaps: number[] = [];
  const start = performance.now();
  let last = start;
  const tick = (t: number): void => {
    gaps.push(Math.round((t - last) * 10) / 10);
    last = t;
    if (t - start < ms) requestAnimationFrame(tick); else resolve(gaps);
  };
  requestAnimationFrame(tick);
}), ms);

test("the gallery is cheap: opening, closing and switching through every theme run without a long task, and each theme's restyle is measured", async ({ page }, testInfo) => {
  await seed(page, {
    plays: [COVER_TWO], playbooks: [BOOK], team: OTTERS,
    draft: { name: COVER_TWO.name, players: COVER_TWO.players, side: "defense" },
  });
  await page.evaluate((k) => { localStorage.setItem(k, "themed"); }, "ffpd.field.v1");
  await page.evaluate((k) => { localStorage.setItem(k, "tokyo-night"); }, THEME_KEY);
  // the suite runs with reduced motion; this test wants the real animation
  await page.emulateMedia({ reducedMotion: "no-preference" });
  const d = new Designer(page);
  await d.goto();
  await d.tools();
  const row = gallery(picker(page));
  await page.evaluate(() => {
    const w = window as unknown as { __longTasks: number[] };
    w.__longTasks = [];
    new PerformanceObserver((list) => { for (const e of list.getEntries()) w.__longTasks.push(Math.round(e.duration)); }).observe({ type: "longtask" });
  });

  const opening = frameGaps(page, 350);
  await row.click();
  const openGaps = await opening;
  await expect(row).toHaveAttribute("aria-expanded", "true");

  // switching through the real picker, every tile a live restyle of the whole app and the field
  for (const t of PREMIUM_THEMES) {
    await picker(page).getByRole("radio", { name: t.name }).check();
    await expect(html(page)).toHaveAttribute("data-theme", t.id);
  }
  // the restyle alone, forced synchronously: what a theme change costs the main thread
  const restyle: Record<string, number> = {};
  for (const t of PREMIUM_THEMES) {
    restyle[t.id] = await page.evaluate((id) => {
      const t0 = performance.now();
      document.documentElement.dataset.theme = id;
      // reading a computed colour and a layout size forces the restyle and relayout to happen now
      const forced = getComputedStyle(document.body).backgroundColor.length + document.body.offsetHeight;
      return Math.round((performance.now() - t0) * 100) / 100 + forced * 0;
    }, t.id);
  }

  const closing = frameGaps(page, 350);
  await row.click();
  const closeGaps = await closing;
  await expect(row).toHaveAttribute("aria-expanded", "false");

  const longTasks = await page.evaluate(() => (window as unknown as { __longTasks: number[] }).__longTasks);
  const nodes = await picker(page).evaluate((el) => el.querySelectorAll("*").length);
  const report = {
    device: testInfo.project.name,
    longTasksMs: longTasks,
    restyleMs: restyle,
    foldOpen: { frames: openGaps.length, maxGapMs: Math.max(...openGaps) },
    foldShut: { frames: closeGaps.length, maxGapMs: Math.max(...closeGaps) },
    pickerNodes: nodes,
  };
  const file = `test-results/premium-themes-perf-${testInfo.project.name}.json`;
  writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`);
  await testInfo.attach("perf report", { path: file, contentType: "application/json" });

  // budgets are loose on purpose (a shared CI runner), several times what a laptop measures
  expect(longTasks.filter((ms) => ms >= 100), "long tasks").toEqual([]);
  for (const [id, ms] of Object.entries(restyle)) expect(ms, `${id} restyle`).toBeLessThan(60);
  expect(Math.max(...openGaps), "a frame while opening").toBeLessThan(120);
  expect(Math.max(...closeGaps), "a frame while closing").toBeLessThan(120);
});
