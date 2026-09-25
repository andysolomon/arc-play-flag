import { expect, test } from "@playwright/test";
import { Designer } from "../support/designer";
import { formation, play, playbook, seed, storedDraft, storedPlaybooks, storedPlays } from "../support/fixtures";
import type { SavedPlay } from "../../lib/play/types";

test("a 100-play library searches notes, filters, sorts, and explains an empty result", async ({ page }) => {
  const plays: SavedPlay[] = Array.from({ length: 100 }, (_, index) => ({
    id: `large-${String(index)}`,
    name: `${index % 2 ? "Pass" : "Run"} ${String(index).padStart(3, "0")}`,
    notes: index === 42 ? "red-zone lighthouse call" : "",
    side: "offense",
    players: formation({ o3: { type: index % 2 ? "go" : "handoff" } }),
  }));
  const books = Array.from({ length: 20 }, (_, index) => playbook(`book-${String(index)}`, `Book ${String(index + 1)}`, []));
  await seed(page, { plays, playbooks: books });
  await page.goto("/playbooks");

  await page.getByRole("textbox", { name: "Search saved plays" }).fill("lighthouse");
  await expect(page.getByText("Run 042", { exact: true })).toBeVisible();
  await page.getByRole("radiogroup", { name: "Filter saved plays" }).getByRole("radio", { name: "Pass" }).check();
  await expect(page.getByText("No plays match. Try another search or filter.")).toBeVisible();
  await page.getByRole("textbox", { name: "Search saved plays" }).fill("");
  await page.getByRole("combobox", { name: "Sort saved plays" }).selectOption("name");
  await expect(page.getByText("Pass 001", { exact: true })).toBeVisible();
});

test("a playbook fits a 320px viewport without horizontal document overflow", async ({ page }) => {
  const alpha = play("alpha", "Alpha Slant", { o3: { type: "slant" } }, "find the seam");
  const source = playbook("source", "Source Book", [alpha]);
  await page.setViewportSize({ width: 320, height: 800 });
  await seed(page, { plays: [alpha], playbooks: [source] });
  await page.goto("/playbooks?book=source");
  await expect(page.getByText("Alpha Slant", { exact: true })).toBeVisible();

  const widths = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(widths.scrollWidth).toBeLessThanOrEqual(widths.clientWidth);
});

test("a playbook entry opens in the designer and can be added to another book from Playbooks", async ({ page }) => {
  const alpha = play("alpha", "Alpha Slant", { o3: { type: "slant" } }, "find the seam");
  const source = playbook("source", "Source Book", [alpha]);
  const target = playbook("target", "Target Book", []);
  await seed(page, { plays: [alpha], playbooks: [source, target] });
  await page.goto("/playbooks?book=source");
  await page.getByRole("link", { name: "Open in designer" }).click();
  await expect(page).toHaveURL("/");

  const designer = new Designer(page);
  await designer.tools();
  await expect(designer.nameInput).toHaveValue("Alpha Slant");
  await expect(designer.routes).toHaveCount(1);
  expect(Object.keys(await storedPlays(page))).toEqual(["alpha"]);
  await expect.poll(async () => (await storedDraft(page))?.id).toBe("alpha");

  // add from the playbooks list without opening the book (saved-play library no longer lives in Play tools)
  await page.goto("/playbooks");
  await page.getByRole("button", { name: "More actions for Alpha Slant" }).click();
  await page.getByRole("button", { name: "Add to playbook…" }).click();
  const picker = page.getByRole("dialog", { name: "Add “Alpha Slant” to a playbook" });
  await expect(picker.getByRole("button", { name: "Source Book" })).toHaveAttribute("aria-pressed", "true");
  await picker.getByRole("button", { name: "Target Book" }).click();
  await expect(picker.getByRole("button", { name: "Target Book" })).toHaveAttribute("aria-pressed", "true");
  await picker.getByRole("button", { name: "Done" }).click();
  await expect(page.getByRole("link", { name: /Target Book/ }).first()).toContainText("1 play");
  expect((await storedPlaybooks(page)).target?.plays).toEqual(["alpha"]);

  // or from the book's card: the same picker the playbook editor opens
  await page.getByRole("button", { name: "More actions for Target Book" }).click();
  await page.getByRole("button", { name: "Add plays…" }).click();
  const books = page.getByRole("dialog", { name: "Add plays to “Target Book”" });
  await books.getByTitle("Remove Alpha Slant").click();
  await books.getByRole("button", { name: "Done" }).click();
  expect((await storedPlaybooks(page)).target?.plays).toEqual([]);

  await page.goto("/playbooks?book=target");
  await page.getByRole("button", { name: "+ Add plays" }).click();
  await page.getByRole("dialog").getByTitle("Add Alpha Slant").click();
  await page.getByRole("button", { name: "Done" }).click();
  expect((await storedPlaybooks(page)).target?.plays).toEqual(["alpha"]);
  await expect(page.getByText("Alpha Slant", { exact: true })).toBeVisible();
});
