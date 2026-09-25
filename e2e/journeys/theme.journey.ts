import { expect, test, type Page } from "@playwright/test";
import { Designer } from "../support/designer";

const THEME_KEY = "ffpd.theme.v1";
const INK = "rgb(27, 26, 23)";
const CHALK = "rgb(244, 239, 226)";

const html = (page: Page) => page.locator("html");
const picker = (page: Page) => page.getByRole("radiogroup", { name: "Theme" });
const stored = (page: Page) => page.evaluate((key) => localStorage.getItem(key), THEME_KEY);

// every test starts on a device set to dark
test.use({ colorScheme: "dark" });

test("a dark device gets the dark board; a coach's pick outlasts a reload, and Auto follows the device again", async ({ page }) => {
  const d = new Designer(page);
  await d.goto();
  await expect(html(page)).toHaveAttribute("data-theme", "dark");
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute("content", "#24221d");

  await d.tools();
  await expect(picker(page).getByRole("radio", { name: "Auto" })).toBeChecked();
  await picker(page).getByRole("radio", { name: "Light" }).check();
  await expect(html(page)).toHaveAttribute("data-theme", "light");
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute("content", "#fffdf6");
  expect(await stored(page)).toBe("light");

  await page.reload();
  await expect(html(page)).toHaveAttribute("data-theme", "light");
  await d.tools();
  await expect(picker(page).getByRole("radio", { name: "Light" })).toBeChecked();

  await picker(page).getByRole("radio", { name: "Auto" }).check();
  await expect(html(page)).toHaveAttribute("data-theme", "dark");
  expect(await stored(page)).toBeNull();
  // Auto keeps following the device while the page is open
  await page.emulateMedia({ colorScheme: "light" });
  await expect(html(page)).toHaveAttribute("data-theme", "light");
});

test("yellow highlights keep dark ink on the dark board, and printing still puts ink on paper", async ({ page }) => {
  const d = new Designer(page);
  await d.goto();
  await d.tools();
  // the open Play tools toggle and the chosen theme are yellow; the Routes toggle is not
  await expect(page.getByRole("button", { name: "Play tools" })).toHaveCSS("color", INK);
  await expect(picker(page).locator("label").filter({ hasText: "Auto" })).toHaveCSS("color", INK);
  await expect(page.getByRole("button", { name: "Route palette" })).toHaveCSS("color", CHALK);

  await page.emulateMedia({ media: "print" });
  await expect(page.locator("body")).toHaveCSS("color", INK);
  await expect(page.locator("body")).toHaveCSS("background-color", "rgb(255, 255, 255)");
});

test("a theme picked in playbook settings redraws the designer open in another tab", async ({ page, context }) => {
  const d = new Designer(page);
  await d.goto();
  await expect(html(page)).toHaveAttribute("data-theme", "dark");

  const books = await context.newPage();
  await books.goto("/playbooks");
  // the first tap after a navigation can land before React has hydrated; tap again if it did
  await expect(async () => {
    await books.getByRole("button", { name: /team, theme & backup settings/ }).click();
    await expect(books.getByRole("dialog", { name: "Team, theme & backup" })).toBeVisible({ timeout: 1_000 });
  }).toPass();
  await books.getByRole("dialog").getByRole("radio", { name: "Light" }).check();
  await expect(html(books)).toHaveAttribute("data-theme", "light");
  await expect(html(page)).toHaveAttribute("data-theme", "light");
});
