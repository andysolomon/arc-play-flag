import { writeFile } from "node:fs/promises";
import { expect, test, type Locator } from "@playwright/test";
import { Designer } from "../support/designer";
import { KEYS, OTTERS, seed } from "../support/fixtures";

/* A coach's pick must be tappable on a small screen, survive a reload, reach both places
 * the team is edited, and keep the name and league setting. A saved custom color must never
 * silently become a preset. Hex entry must reject invalid/partial codes without changing
 * the saved color, normalize shorthand and uppercase codes, and reach both editing surfaces.
 * Native OS color-wheel chrome is outside Chromium's page DOM; the second journey verifies
 * its real input's change path, synchronization with the hex field and keyboard target instead.
 * Each project leaves light/dark palette pictures and a manifest of the durable result.
 */
async function targets(palette: Locator) {
  return palette.getByRole("radio").evaluateAll(inputs => inputs.map(input => {
    const box = input.getBoundingClientRect();
    const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
    return { color: input.getAttribute("value"), width: box.width, height: box.height, hit: hit === input };
  }));
}

test("a preset is one tap, readable in both themes, kept across reload and shared by team settings", async ({ page }, info) => {
  await seed(page, { team: { ...OTTERS, noRunZones: false } });
  const d = new Designer(page);
  await d.goto();
  await d.tools();
  const palette = page.locator("#play-sidebar").getByRole("group", { name: "Team color", exact: true });
  await expect(palette.getByRole("radio", { name: "Teal", exact: true })).toBeChecked();
  await expect(palette.getByRole("radio")).toHaveCount(12);
  await expect(palette.getByRole("textbox", { name: "Hex color", exact: true })).toHaveCount(0);
  await palette.scrollIntoViewIfNeeded();
  const boxes = await targets(palette);
  for (const box of boxes) {
    expect(box.width, box.color ?? "color target").toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.hit).toBe(true);
  }
  await palette.getByRole("radio", { name: "Blue", exact: true }).click();
  await expect(palette.getByRole("radio", { name: "Blue", exact: true })).toBeChecked();
  await expect(palette).toContainText("Blue");
  await palette.screenshot({ path: info.outputPath("team-colors-light.png") });
  const viewport = page.viewportSize();
  let smallBoxes: Awaited<ReturnType<typeof targets>> | null = null;
  if (viewport && viewport.width < 500) {
    await page.setViewportSize({ width: 320, height: 568 });
    await palette.scrollIntoViewIfNeeded();
    smallBoxes = await targets(palette);
    for (const box of smallBoxes) {
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.hit).toBe(true);
    }
    await palette.screenshot({ path: info.outputPath("team-colors-320px.png") });
    await page.setViewportSize(viewport);
  }

  await page.reload();
  await d.tools();
  await expect(palette.getByRole("radio", { name: "Blue", exact: true })).toBeChecked();
  await expect(page.getByRole("textbox", { name: "Team name" })).toHaveValue(OTTERS.name);
  await expect(page.getByRole("checkbox", { name: "No-run zones", exact: true })).not.toBeChecked();

  await page.goto("/playbooks");
  await expect(async () => {
    await page.getByRole("button", { name: /team, theme & backup settings/ }).click();
    await expect(page.getByRole("dialog", { name: "Team, theme & backup" })).toBeVisible({ timeout: 1000 });
  }).toPass();
  const dialog = page.getByRole("dialog", { name: "Team, theme & backup" });
  const settingsPalette = dialog.getByRole("group", { name: "Team color", exact: true });
  const blue = settingsPalette.getByRole("radio", { name: "Blue", exact: true });
  await expect(blue).toBeChecked();
  await blue.focus();
  await page.keyboard.press("ArrowRight");
  await expect(settingsPalette.getByRole("radio", { name: "Navy", exact: true })).toBeChecked();
  await dialog.getByRole("radio", { name: "Dark", exact: true }).check();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.getByRole("status").filter({ hasText: "Switching to Dark" })).toHaveCount(0);
  await settingsPalette.screenshot({ path: info.outputPath("team-colors-dark.png") });
  const stored = await page.evaluate(key => JSON.parse(localStorage.getItem(key) ?? "null") as unknown, KEYS.team);
  expect(stored).toEqual({ ...OTTERS, color: "#183153", noRunZones: false });
  await writeFile(info.outputPath("team-colors.json"), JSON.stringify({ boxes, smallBoxes, stored }, null, 2));
  await d.goto();
  await d.tools();
  await expect(palette.getByRole("radio", { name: "Navy", exact: true })).toBeChecked();
});

test("an existing custom color stays selected and the optional color wheel can set another", async ({ page }, info) => {
  await seed(page, { team: { ...OTTERS, color: "#123456" } });
  const d = new Designer(page);
  await d.goto();
  await d.tools();
  const palette = page.locator("#play-sidebar").getByRole("group", { name: "Team color", exact: true });
  await expect(palette).toContainText("Custom · #123456");
  await expect(palette.locator("input[type='radio']:checked")).toHaveCount(0);
  await palette.getByRole("button", { name: "Custom color…", exact: true }).click();
  const hex = palette.getByRole("textbox", { name: "Hex color", exact: true });
  await expect(hex).toHaveValue("#123456");
  const wheel = palette.getByLabel("Custom color wheel", { exact: true });
  await expect(wheel).toHaveAttribute("type", "color");
  await expect(wheel).toHaveValue("#123456");
  await wheel.scrollIntoViewIfNeeded();
  const box = await wheel.boundingBox();
  expect(box?.width).toBeGreaterThanOrEqual(44);
  expect(box?.height).toBeGreaterThanOrEqual(44);
  await wheel.focus();
  await expect(wheel).toBeFocused();
  // Set the actual input and deliver the same bubbling event the native picker emits.
  await wheel.evaluate((node: HTMLInputElement) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(node, "#654321");
    node.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await expect(palette).toContainText("Custom · #654321");
  await expect(hex).toHaveValue("#654321");
  await page.reload();
  await d.tools();
  await palette.getByRole("button", { name: "Custom color…", exact: true }).click();
  await expect(wheel).toHaveValue("#654321");
  await expect(hex).toHaveValue("#654321");
  await expect(palette).toContainText("Custom · #654321");
  await palette.screenshot({ path: info.outputPath("team-colors-custom.png") });
  await palette.getByRole("radio", { name: "Gold", exact: true }).check();
  await expect(palette.getByRole("radio", { name: "Gold", exact: true })).toBeChecked();
  await expect(hex).toHaveCount(0);
  const stored = await page.evaluate(key => JSON.parse(localStorage.getItem(key) ?? "null") as unknown, KEYS.team);
  expect(stored).toEqual({ ...OTTERS, color: "#f2b705" });
  await writeFile(info.outputPath("team-colors-custom.json"), JSON.stringify({ wheel: box, stored }, null, 2));
});

test("hex entry rejects invalid codes, accepts shorthand and uppercase, and persists through both team editors", async ({ page }, info) => {
  const team = { ...OTTERS, noRunZones: false };
  await seed(page, { team });
  const d = new Designer(page);
  await d.goto();
  await d.tools();
  const palette = page.locator("#play-sidebar").getByRole("group", { name: "Team color", exact: true });
  await palette.getByRole("button", { name: "Custom color…", exact: true }).click();
  const hex = palette.getByRole("textbox", { name: "Hex color", exact: true });
  const wheel = palette.getByLabel("Custom color wheel", { exact: true });
  const storedTeam = async (): Promise<unknown> => page.evaluate(key => JSON.parse(localStorage.getItem(key) ?? "null") as unknown, KEYS.team);

  await hex.fill("12GG44");
  await palette.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(hex).toHaveAttribute("aria-invalid", "true");
  await expect(palette.getByRole("alert")).toContainText("Use 3 or 6 hex digits");
  expect(await storedTeam()).toEqual(team);
  await expect(wheel).toHaveValue(team.color);
  await hex.fill("#12");
  await hex.press("Enter");
  await expect(hex).toHaveAttribute("aria-invalid", "true");
  expect(await storedTeam()).toEqual(team);
  await hex.fill("#ABC");
  await hex.press("Enter");
  await expect(hex).toHaveValue("#aabbcc");
  await expect(wheel).toHaveValue("#aabbcc");
  await expect(palette.getByRole("alert")).toHaveCount(0);
  expect(await storedTeam()).toEqual({ ...team, color: "#aabbcc" });
  await hex.fill("1A73E8");
  await palette.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(hex).toHaveValue("#1a73e8");
  await expect(wheel).toHaveValue("#1a73e8");
  expect(await storedTeam()).toEqual({ ...team, color: "#1a73e8" });
  await hex.scrollIntoViewIfNeeded();
  await palette.screenshot({ path: info.outputPath("team-colors-hex-light.png") });

  await page.goto("/playbooks");
  await expect(async () => {
    await page.getByRole("button", { name: /team, theme & backup settings/ }).click();
    await expect(page.getByRole("dialog", { name: "Team, theme & backup" })).toBeVisible({ timeout: 1000 });
  }).toPass();
  const dialog = page.getByRole("dialog", { name: "Team, theme & backup" });
  const settingsPalette = dialog.getByRole("group", { name: "Team color", exact: true });
  await settingsPalette.getByRole("button", { name: "Custom color…", exact: true }).click();
  const settingsHex = settingsPalette.getByRole("textbox", { name: "Hex color", exact: true });
  await expect(settingsHex).toHaveValue("#1a73e8");
  await settingsHex.fill("#00FF88");
  await settingsPalette.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(settingsHex).toHaveValue("#00ff88");
  await expect(settingsPalette.getByLabel("Custom color wheel", { exact: true })).toHaveValue("#00ff88");
  await dialog.getByRole("radio", { name: "Dark", exact: true }).check();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.getByRole("status").filter({ hasText: "Switching to Dark" })).toHaveCount(0);
  await settingsPalette.screenshot({ path: info.outputPath("team-colors-hex-dark.png") });
  const stored = await storedTeam();
  expect(stored).toEqual({ ...team, color: "#00ff88" });
  await d.goto();
  await d.tools();
  await palette.getByRole("button", { name: "Custom color…", exact: true }).click();
  await expect(hex).toHaveValue("#00ff88");
  await writeFile(info.outputPath("team-colors-hex.json"), JSON.stringify({ invalid: ["12GG44", "#12"], accepted: ["#ABC", "1A73E8", "#00FF88"], stored }, null, 2));
});
