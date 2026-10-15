import { writeFileSync } from "node:fs";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { Designer, downloadText } from "../support/designer";
import { CURRENT_BOOK_KEY } from "../../lib/play/current-book";
import {
  COVER_TWO, OTTERS, SLANT_LEFT, WHEEL_RIGHT, jsonUpload, playbook, playbookFile, seed, storedCurrentBook, storedPlaybooks, storedPlays,
} from "../support/fixtures";

/**
 * The playbook switcher (docs/adr/009-playbook-switcher.md): the play name drops the current
 * playbook's plays down, the Playbooks tile drops every playbook down, and a switch opens the new
 * book's primary play or clears the board. How this could break, and the test that catches each:
 *  - the play name's list shows another book's plays, or numbers them differently from the book → "the play name"
 *  - picking a play from it doesn't open that play, or opens it without its routes and read      → "the play name"
 *  - the list doesn't say which play is on the board, or which is the primary                   → "the play name"
 *  - the arrow keys and Enter can't pick, or Escape doesn't give focus back                      → "the play name"
 *  - a play picked in roster mode opens hidden behind the roster, routes and name out of sight    → "the play name"
 *  - a switch opens the wrong play (the first instead of the primary), or leaves the old board   → "switching"
 *  - a switch to an empty book leaves the old play on the board instead of clearing it           → "switching"
 *  - a switch to the book already current clears the board, or the switch doesn't outlast reload → "switching"
 *  - "Open in designer" from inside a book leaves the designer in another book                   → "switching", "primary"
 *  - the first play added isn't the primary, a reorder moves it, or a removal leaves none        → "primary"
 *  - the primary doesn't reach the playbook file, or another device after an import              → "primary"
 *  - a saved play can't be added to the current book from the play name; a bare device says nothing → "adding"
 *  - an empty menu can't be closed with Escape, since nothing in it takes focus                  → "switching"
 *  - a pick whose write the device refused is lost on the next write to the books (C3)           → "a refused pick"
 *  - a file whose book differs here only in its primary is taken as already here, and dropped    → "a different primary"
 * Leaves `playbook-switch-<device>-<test>.json` (each step's rows, what was on the board and what the
 * device stored) and a picture of each menu in test-results/, uploaded as `playbook-switch`.
 */

const GAME = playbook("fx-game", "Otter Game Plan", [SLANT_LEFT, WHEEL_RIGHT]);
// a book whose coach picked a primary that isn't its first play
const ROAD = playbook("fx-road", "Otter Road Book", [WHEEL_RIGHT, COVER_TWO], COVER_TWO);
const SCOUT = playbook("fx-scout", "Otter Scout Book", []);

interface Row { name: string; checked: string | null; text: string }
interface Step { step: string; menu?: Row[]; board: string; current: string | null; stored?: unknown }

const tools = (page: Page): Locator => page.locator("#play-sidebar");
const playsButton = (page: Page): Locator => tools(page).getByRole("button", { name: "Plays in this playbook" });
const playsMenu = (page: Page): Locator => page.getByRole("menu", { name: "Plays in this playbook" });
const booksTile = (page: Page): Locator => tools(page).getByRole("button", { name: "Playbooks" });
const booksMenu = (page: Page): Locator => page.getByRole("menu", { name: "Playbooks" });
const items = (page: Page) => page.getByRole("list").getByRole("listitem");

async function rows(menu: Locator): Promise<Row[]> {
  return menu.getByRole("menuitemradio").evaluateAll((els) => els.map((el) => ({
    name: el.getAttribute("aria-label") ?? "", checked: el.getAttribute("aria-checked"), text: el.textContent?.trim() ?? "",
  })));
}

/** What a coach sees on the board and what the device stored, after a step. */
async function read(d: Designer, step: string, menu?: Locator): Promise<Step> {
  const board = await d.page.locator("#field-title").textContent();
  return { step, ...(menu ? { menu: await rows(menu) } : {}), board: board?.trim() ?? "", current: await storedCurrentBook(d.page) };
}

function save(name: string, steps: Step[]): void {
  writeFileSync(`test-results/playbook-switch-${name}.json`, `${JSON.stringify({ steps }, null, 2)}\n`);
}

test("the play name drops the playbook's plays down, numbered as the book is, and picking one opens it", async ({ page }, testInfo) => {
  await seed(page, { plays: [SLANT_LEFT, WHEEL_RIGHT, COVER_TWO], playbooks: [GAME, ROAD, SCOUT], team: OTTERS });
  const d = new Designer(page);
  const steps: Step[] = [];
  await d.goto();
  await d.tools();
  await expect(d.nameInput).toHaveValue("New play");

  // the first playbook on the device stands in until one is picked here
  await playsButton(page).click();
  await expect(playsMenu(page)).toBeVisible();
  await expect(playsMenu(page)).toContainText("IN “Otter Game Plan”");
  const first = await rows(playsMenu(page));
  expect(first.map((r) => r.name)).toEqual(["Otter Slant Left", "Otter Wheel Right"]);
  expect(first.map((r) => r.checked)).toEqual(["false", "false"]);
  // numbered as the book numbers them, the first play added marked as the primary
  expect(first[0]?.text).toMatch(/^1\.\s*Otter Slant LeftPrimary$/);
  expect(first[1]?.text).toMatch(/^2\.\s*Otter Wheel Right$/);
  await expect(playsMenu(page).getByRole("menuitemradio", { name: "Otter Slant Left" })).toBeFocused();
  await tools(page).screenshot({ path: `test-results/playbook-switch-${testInfo.project.name}-plays.png` });
  steps.push(await read(d, "opened the list on a new play", playsMenu(page)));

  // the keyboard: down to the second play, Enter opens it
  await page.keyboard.press("ArrowDown");
  await expect(playsMenu(page).getByRole("menuitemradio", { name: "Otter Wheel Right" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(playsMenu(page)).toBeHidden();
  await expect(d.toast).toHaveText("Opened “Otter Wheel Right”");
  await expect(page.getByRole("heading", { name: "Otter Wheel Right" })).toBeVisible();
  await expect(d.nameInput).toHaveValue("Otter Wheel Right");
  await expect(d.routes).toHaveCount(2);
  await expect(d.primaryRoutes).toHaveCount(1);
  steps.push(await read(d, "Enter on Otter Wheel Right"));

  // the play on the board is checked; Escape closes the list and gives focus back
  await playsButton(page).click();
  const second = await rows(playsMenu(page));
  expect(second.map((r) => r.checked)).toEqual(["false", "true"]);
  await expect(playsMenu(page).getByRole("menuitemradio", { name: "Otter Wheel Right" })).toBeFocused();
  steps.push(await read(d, "opened the list again", playsMenu(page)));
  await page.keyboard.press("Escape");
  await expect(playsMenu(page)).toBeHidden();
  await expect(playsButton(page)).toBeFocused();
  await expect(playsButton(page)).toHaveAttribute("aria-expanded", "false");

  // a tap opens a play too
  await playsButton(page).click();
  await playsMenu(page).getByRole("menuitemradio", { name: "Otter Slant Left" }).click();
  await expect(d.toast).toHaveText("Opened “Otter Slant Left”");
  await expect(page.getByRole("heading", { name: "Otter Slant Left" })).toBeVisible();
  await expect(d.routes).toHaveCount(2);
  await expect(d.primaryRoutes).toHaveCount(0);
  steps.push(await read(d, "tapped Otter Slant Left"));

  // roster mode hides the routes and titles the field "Roster" (ADR 008): a play picked there is shown in play mode
  await d.roster();
  await expect(page.getByRole("heading", { name: "Roster", level: 1 })).toBeVisible();
  await expect(d.routes).toHaveCount(0);
  await d.tools();
  await playsButton(page).click();
  await playsMenu(page).getByRole("menuitemradio", { name: "Otter Wheel Right" }).click();
  await expect(d.toast).toHaveText("Opened “Otter Wheel Right”");
  await expect(page.getByRole("heading", { name: "Otter Wheel Right", level: 1 })).toBeVisible();
  await expect(page.getByRole("button", { name: "Route palette" })).toBeVisible();
  await expect(d.routes).toHaveCount(2);
  steps.push(await read(d, "picked Otter Wheel Right from roster mode"));
  save(`${testInfo.project.name}-the-play-name`, steps);
});

test("switching playbooks opens the new book's primary play, clears the board for an empty one, and outlasts a reload", async ({ page }, testInfo) => {
  await seed(page, { plays: [SLANT_LEFT, WHEEL_RIGHT, COVER_TWO], playbooks: [GAME, ROAD, SCOUT], team: OTTERS });
  const d = new Designer(page);
  const steps: Step[] = [];
  await d.goto();
  await d.tools();

  await booksTile(page).click();
  await expect(booksTile(page)).toHaveAttribute("aria-expanded", "true");
  await expect(booksMenu(page)).toBeVisible();
  const books = await rows(booksMenu(page));
  expect(books).toEqual([
    { name: "Otter Game Plan", checked: "true", text: "Otter Game Plan2 plays" },
    { name: "Otter Road Book", checked: "false", text: "Otter Road Book2 plays" },
    { name: "Otter Scout Book", checked: "false", text: "Otter Scout BookEmpty" },
  ]);
  await expect(booksMenu(page).getByRole("menuitem")).toHaveText(["Edit “Otter Game Plan” ›", "All playbooks ›"]);
  await tools(page).screenshot({ path: `test-results/playbook-switch-${testInfo.project.name}-books.png` });
  steps.push(await read(d, "opened the Playbooks menu", booksMenu(page)));

  // the road book's primary is its second play, and that is what opens
  await booksMenu(page).getByRole("menuitemradio", { name: "Otter Road Book" }).click();
  await expect(booksMenu(page)).toBeHidden();
  await expect(d.toast).toHaveText("Switched to “Otter Road Book” · opened “Otter Cover Two”");
  await expect(page.getByRole("heading", { name: "Otter Cover Two" })).toBeVisible();
  await expect(d.nameInput).toHaveValue("Otter Cover Two");
  expect(await storedCurrentBook(page)).toBe("fx-road");
  await playsButton(page).click();
  await expect(playsMenu(page)).toContainText("IN “Otter Road Book”");
  const road = await rows(playsMenu(page));
  expect(road.map((r) => [r.name, r.checked])).toEqual([["Otter Wheel Right", "false"], ["Otter Cover Two", "true"]]);
  expect(road[1]?.text).toContain("Primary");
  steps.push(await read(d, "switched to Otter Road Book", playsMenu(page)));
  await page.keyboard.press("Escape");

  // an empty book clears the board
  await booksTile(page).click();
  await booksMenu(page).getByRole("menuitemradio", { name: "Otter Scout Book" }).click();
  await expect(d.toast).toHaveText("Switched to “Otter Scout Book” · board cleared");
  await expect(d.nameInput).toHaveValue("New play");
  await expect(d.routes).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "New play" })).toBeVisible();
  expect(await storedCurrentBook(page)).toBe("fx-scout");
  await playsButton(page).click();
  await expect(playsMenu(page)).toContainText("IN “Otter Scout Book”");
  await expect(playsMenu(page)).toContainText("No plays in this playbook yet.");
  await expect(playsMenu(page)).toContainText("Save the play on the board to add it to “Otter Scout Book”.");
  await expect(playsMenu(page).getByRole("menuitemradio")).toHaveCount(0);
  steps.push(await read(d, "switched to the empty Otter Scout Book", playsMenu(page)));
  // nothing to pick, so the menu takes focus itself and Escape still closes it (review of #137)
  await expect(playsMenu(page)).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(playsMenu(page)).toBeHidden();
  await expect(playsButton(page)).toHaveAttribute("aria-expanded", "false");
  await expect(playsButton(page)).toBeFocused();

  // the book already current is left as it is: a drawn route stays
  await d.select("X");
  await d.pick("Slant");
  await expect(d.routes).toHaveCount(1);
  await d.tools();
  await booksTile(page).click();
  await booksMenu(page).getByRole("menuitemradio", { name: "Otter Scout Book" }).click();
  await expect(d.toast).toHaveText("Already in “Otter Scout Book”");
  await expect(d.routes).toHaveCount(1);
  steps.push(await read(d, "picked Otter Scout Book again"));

  // the pick outlasts a reload
  await d.goto();
  await d.tools();
  await booksTile(page).click();
  expect((await rows(booksMenu(page))).map((r) => [r.name, r.checked])).toEqual([["Otter Game Plan", "false"], ["Otter Road Book", "false"], ["Otter Scout Book", "true"]]);
  steps.push(await read(d, "reloaded", booksMenu(page)));

  // a book that never had a primary picked opens on its first play
  await booksMenu(page).getByRole("menuitemradio", { name: "Otter Game Plan" }).click();
  await expect(d.toast).toHaveText("Switched to “Otter Game Plan” · opened “Otter Slant Left”");
  await expect(page.getByRole("heading", { name: "Otter Slant Left" })).toBeVisible();
  await expect(d.routes).toHaveCount(2);
  steps.push(await read(d, "switched to Otter Game Plan"));

  // the way on to the playbooks screen, and back into the designer from inside a book
  await booksTile(page).click();
  await booksMenu(page).getByRole("menuitem", { name: "Edit “Otter Game Plan” ›" }).click();
  await expect(page).toHaveURL(/\/playbooks\?book=fx-game$/);
  await expect(page.getByRole("textbox", { name: "Playbook name" })).toHaveValue("Otter Game Plan");
  await page.goto("/playbooks?book=fx-road");
  await items(page).nth(0).getByRole("link", { name: "Open in designer" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { name: "Otter Wheel Right" })).toBeVisible();
  expect(await storedCurrentBook(page)).toBe("fx-road");
  await d.tools();
  await playsButton(page).click();
  await expect(playsMenu(page)).toContainText("IN “Otter Road Book”");
  expect((await rows(playsMenu(page))).map((r) => [r.name, r.checked])).toEqual([["Otter Wheel Right", "true"], ["Otter Cover Two", "false"]]);
  steps.push(await read(d, "Open in designer from Otter Road Book", playsMenu(page)));
  await page.keyboard.press("Escape");
  await booksTile(page).click();
  await booksMenu(page).getByRole("menuitem", { name: "All playbooks ›" }).click();
  await expect(page).toHaveURL(/\/playbooks$/);
  await expect(page.getByRole("heading", { name: "Playbooks" })).toBeVisible();
  save(`${testInfo.project.name}-switching`, steps);
});

test("the first play added is the primary until the coach picks another; it survives a reorder, follows a removal and travels in the file", async ({ page, browser }, testInfo) => {
  await seed(page, { plays: [SLANT_LEFT, WHEEL_RIGHT, COVER_TWO], playbooks: [GAME], team: OTTERS });
  const steps: { step: string; cards: string[]; stored: unknown }[] = [];
  const cards = async (): Promise<string[]> => items(page).evaluateAll((els) => els.map((el) => {
    const name = el.querySelector("[title]")?.getAttribute("title") ?? "";
    const primary = el.textContent?.includes("Primary") ? "primary" : "";
    return `${name}${primary ? ` (${primary})` : ""}`;
  }));
  const note = async (step: string) => { steps.push({ step, cards: await cards(), stored: (await storedPlaybooks(page))["fx-game"] }); };
  await page.goto("/playbooks?book=fx-game");
  await expect(items(page)).toHaveCount(2);

  // a book from before the choice: its first play stands in
  await expect(items(page).nth(0).getByText("Primary")).toBeVisible();
  await expect(items(page).nth(1).getByRole("button", { name: "Make Otter Wheel Right the primary play" })).toBeVisible();
  await note("opened the book");

  // a reorder leaves it: the first play added stays primary from the second row
  await items(page).nth(0).getByRole("button", { name: "Move down" }).click();
  await expect(items(page)).toHaveText([/Otter Wheel Right/, /Otter Slant Left/]);
  await expect(items(page).nth(1).getByText("Primary")).toBeVisible();
  await expect(items(page).nth(0).getByRole("button", { name: "Make Otter Wheel Right the primary play" })).toBeVisible();
  expect((await storedPlaybooks(page))["fx-game"]).toEqual({ id: "fx-game", name: "Otter Game Plan", plays: ["fx-wheel-right", "fx-slant-left"], primary: "fx-slant-left" });
  await note("moved Otter Slant Left down");

  // the coach picks another
  await items(page).nth(0).getByRole("button", { name: "Make Otter Wheel Right the primary play" }).click();
  await expect(items(page).nth(0).getByText("Primary")).toBeVisible();
  await expect(items(page).nth(1).getByRole("button", { name: "Make Otter Slant Left the primary play" })).toBeVisible();
  expect((await storedPlaybooks(page))["fx-game"]?.primary).toBe("fx-wheel-right");
  await note("made Otter Wheel Right primary");

  // taking the primary out hands the choice to the first play left
  await page.getByRole("button", { name: "Remove Otter Wheel Right" }).click();
  await expect(items(page)).toHaveText([/Otter Slant Left/]);
  await expect(items(page).nth(0).getByText("Primary")).toBeVisible();
  expect((await storedPlaybooks(page))["fx-game"]).toEqual({ id: "fx-game", name: "Otter Game Plan", plays: ["fx-slant-left"], primary: "fx-slant-left" });
  await note("removed Otter Wheel Right");

  // a play added later is not the primary
  await page.getByRole("button", { name: "+ Add plays" }).click();
  const picker = page.getByRole("dialog", { name: "Add plays to “Otter Game Plan”" });
  await picker.getByTitle("Add Otter Cover Two").click();
  await picker.getByRole("button", { name: "Done" }).click();
  await expect(items(page)).toHaveText([/Otter Slant Left/, /Otter Cover Two/]);
  await expect(items(page).nth(0).getByText("Primary")).toBeVisible();
  await expect(items(page).nth(1).getByRole("button", { name: "Make Otter Cover Two the primary play" })).toBeVisible();
  await note("added Otter Cover Two");

  // the file carries it, and another device reads it back the same
  const [file] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download playbook file" }).click()]);
  const text = await downloadText(file);
  const parsed = JSON.parse(text) as { playbook: { plays: string[]; primary?: string } };
  expect(parsed.playbook).toEqual({ id: "fx-game", name: "Otter Game Plan", plays: ["fx-slant-left", "fx-cover-two"], primary: "fx-slant-left" });
  const other = await browser.newContext();
  const page2 = await other.newPage();
  await page2.goto("/playbooks");
  await page2.getByLabel("Import a playbook file").setInputFiles(jsonUpload("otter-game-plan.playbook.json", text));
  await page2.getByRole("button", { name: "Import playbook", exact: true }).click();
  await expect(page2.getByRole("list").getByRole("listitem")).toHaveText([/Otter Slant Left/, /Otter Cover Two/]);
  await expect(page2.getByRole("list").getByRole("listitem").nth(0).getByText("Primary")).toBeVisible();
  expect(await storedPlaybooks(page2)).toEqual(await storedPlaybooks(page));
  expect(await storedPlays(page2)).toEqual(Object.fromEntries(Object.entries(await storedPlays(page)).filter(([id]) => id !== "fx-wheel-right")));
  await other.close();

  // into the designer from the book: the book is current there, and the list marks the primary and the play opened
  await items(page).nth(1).getByRole("link", { name: "Open in designer" }).click();
  const d = new Designer(page);
  await expect(page.getByRole("heading", { name: "Otter Cover Two" })).toBeVisible();
  expect(await storedCurrentBook(page)).toBe("fx-game");
  await d.tools();
  await playsButton(page).click();
  const listed = await rows(playsMenu(page));
  expect(listed.map((r) => [r.name, r.checked])).toEqual([["Otter Slant Left", "false"], ["Otter Cover Two", "true"]]);
  expect(listed[0]?.text).toContain("Primary");
  expect(listed[1]?.text).not.toContain("Primary");
  steps.push({ step: "opened Otter Cover Two in the designer", cards: listed.map((r) => r.text), stored: await storedCurrentBook(page) });
  writeFileSync(`test-results/playbook-switch-${testInfo.project.name}-primary.json`, `${JSON.stringify({ steps, file: parsed.playbook }, null, 2)}\n`);
});

test("a saved play is added to the current playbook from the play name, and a device with no playbooks says so", async ({ page, browser }, testInfo) => {
  await seed(page, { plays: [SLANT_LEFT], playbooks: [playbook("fx-game", "Otter Game Plan", [SLANT_LEFT])], team: OTTERS });
  const d = new Designer(page);
  const steps: Step[] = [];
  await d.goto();
  await d.setName("Otter Scratch");
  await d.select("X");
  await d.pick("Slant");
  await expect(d.routes).toHaveCount(1);

  // not saved yet: nothing to add
  await d.tools();
  await playsButton(page).click();
  await expect(playsMenu(page)).toContainText("Save the play on the board to add it to “Otter Game Plan”.");
  await expect(playsMenu(page).getByRole("menuitem")).toHaveCount(0);
  steps.push(await read(d, "an unsaved play", playsMenu(page)));
  await page.keyboard.press("Escape");

  await d.save();
  await expect(d.toast).toHaveText("Saved");
  await d.tools();
  await playsButton(page).click();
  await playsMenu(page).getByRole("menuitem", { name: "+ Add “Otter Scratch” to this playbook" }).click();
  await expect(d.toast).toHaveText("Added to “Otter Game Plan”");
  await playsButton(page).click();
  const added = await rows(playsMenu(page));
  expect(added.map((r) => [r.name, r.checked])).toEqual([["Otter Slant Left", "false"], ["Otter Scratch", "true"]]);
  expect(added[0]?.text).toContain("Primary");
  await expect(playsMenu(page).getByRole("menuitem")).toHaveCount(0);
  const book = (await storedPlaybooks(page))["fx-game"];
  expect(book?.plays).toHaveLength(2);
  expect(book?.primary).toBe("fx-slant-left");
  steps.push({ ...(await read(d, "added the saved play", playsMenu(page))), stored: book });
  await page.keyboard.press("Escape");

  // a device with no playbooks: both menus say so and lead to the playbooks screen
  const bare = await browser.newContext();
  const page2 = await bare.newPage();
  const d2 = new Designer(page2);
  await d2.goto();
  await d2.tools();
  await playsButton(page2).click();
  await expect(playsMenu(page2)).toContainText("No playbook on this device yet.");
  await expect(playsMenu(page2).getByRole("menuitemradio")).toHaveCount(0);
  await expect(playsMenu(page2).getByRole("menuitem", { name: "All playbooks ›" })).toBeFocused();
  steps.push(await read(d2, "a bare device: the play name's list", playsMenu(page2)));
  await page2.keyboard.press("Escape");
  await booksTile(page2).click();
  await expect(booksMenu(page2)).toContainText("No playbooks yet.");
  await expect(booksMenu(page2).getByRole("menuitemradio")).toHaveCount(0);
  await expect(booksMenu(page2).getByRole("menuitem")).toHaveText(["All playbooks ›"]);
  steps.push(await read(d2, "a bare device: the Playbooks menu", booksMenu(page2)));
  await booksMenu(page2).getByRole("menuitem", { name: "All playbooks ›" }).click();
  await expect(page2).toHaveURL(/\/playbooks$/);
  await expect(page2.getByText("No playbooks yet.")).toBeVisible();
  await bare.close();
  save(`${testInfo.project.name}-adding`, steps);
});

test("a refused pick holds for the visit: adding a play to that book keeps it current, and a reload falls back", async ({ page }, testInfo) => {
  // the device refuses only the designer's pick (C3); every other write lands
  await page.addInitScript((key) => {
    // eslint-disable-next-line @typescript-eslint/unbound-method -- re-bound with .call below
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (this: Storage, k: string, v: string) {
      if (k === key) throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
      setItem.call(this, k, v);
    };
  }, CURRENT_BOOK_KEY);
  await seed(page, { plays: [SLANT_LEFT, WHEEL_RIGHT, COVER_TWO], playbooks: [GAME, ROAD], team: OTTERS });
  const d = new Designer(page);
  const steps: Step[] = [];
  await d.goto();
  await d.tools();
  await booksTile(page).click();
  await booksMenu(page).getByRole("menuitemradio", { name: "Otter Road Book" }).click();
  await expect(d.toast).toHaveText("Switched to “Otter Road Book” · opened “Otter Cover Two”");
  expect(await storedCurrentBook(page)).toBeNull();
  steps.push(await read(d, "switched to Otter Road Book; the device refused the pick"));

  // a new play, saved and added to the book: a write to the books must not drop the pick
  await d.newPlay();
  await d.setName("Otter Scratch");
  await d.select("X");
  await d.pick("Slant");
  await d.save();
  await expect(d.toast).toHaveText("Saved");
  await d.tools();
  await playsButton(page).click();
  await expect(playsMenu(page)).toContainText("IN “Otter Road Book”");
  await playsMenu(page).getByRole("menuitem", { name: "+ Add “Otter Scratch” to this playbook" }).click();
  await expect(d.toast).toHaveText("Added to “Otter Road Book”");
  await playsButton(page).click();
  await expect(playsMenu(page)).toContainText("IN “Otter Road Book”");
  expect((await rows(playsMenu(page))).map((r) => [r.name, r.checked])).toEqual([
    ["Otter Wheel Right", "false"], ["Otter Cover Two", "false"], ["Otter Scratch", "true"],
  ]);
  steps.push({ ...(await read(d, "added Otter Scratch to Otter Road Book", playsMenu(page))), stored: (await storedPlaybooks(page))["fx-road"] });
  await page.keyboard.press("Escape");
  await booksTile(page).click();
  expect((await rows(booksMenu(page))).map((r) => [r.name, r.checked])).toEqual([["Otter Game Plan", "false"], ["Otter Road Book", "true"]]);
  await page.keyboard.press("Escape");

  // the refused pick is gone past the visit: the first book stands in
  await d.goto();
  await d.tools();
  await booksTile(page).click();
  expect((await rows(booksMenu(page))).map((r) => [r.name, r.checked])).toEqual([["Otter Game Plan", "true"], ["Otter Road Book", "false"]]);
  steps.push(await read(d, "reloaded", booksMenu(page)));
  save(`${testInfo.project.name}-a-refused-pick`, steps);
});

test("a file whose book differs here only in its primary lands as a copy with the file's primary", async ({ page }, testInfo) => {
  // here, the coach kept the first play as primary; the file's coach picked the second
  const mine = playbook("fx-game", "Otter Game Plan", [SLANT_LEFT, WHEEL_RIGHT], SLANT_LEFT);
  await seed(page, { plays: [SLANT_LEFT, WHEEL_RIGHT], playbooks: [mine], team: OTTERS });
  const theirs = playbookFile(playbook("fx-game", "Otter Game Plan", [SLANT_LEFT, WHEEL_RIGHT], WHEEL_RIGHT), [SLANT_LEFT, WHEEL_RIGHT], OTTERS);
  const steps: { step: string; url: string; stored: unknown }[] = [];
  const importFile = async (): Promise<void> => {
    await page.goto("/playbooks");
    await page.getByLabel("Import a playbook file").setInputFiles(jsonUpload("otter-game-plan.playbook.json", theirs));
    await page.getByRole("button", { name: "Import playbook", exact: true }).click();
    await expect(page.locator("div[role='status']")).toHaveText("Imported “Otter Game Plan” · 2 plays already here");
    await expect(page).toHaveURL(/book=/);
  };

  await importFile();
  await expect(page).not.toHaveURL(/book=fx-game$/);
  await expect(page.getByRole("textbox", { name: "Playbook name" })).toHaveValue("Otter Game Plan (imported)");
  await expect(items(page)).toHaveText([/Otter Slant Left/, /Otter Wheel Right/]);
  await expect(items(page).nth(1).getByText("Primary")).toBeVisible();
  await expect(items(page).nth(0).getByRole("button", { name: "Make Otter Slant Left the primary play" })).toBeVisible();
  let books = await storedPlaybooks(page);
  // the coach's own book keeps its own primary; the copy carries the file's
  expect(books["fx-game"]).toEqual({ id: "fx-game", name: "Otter Game Plan", plays: ["fx-slant-left", "fx-wheel-right"], primary: "fx-slant-left" });
  const copy = Object.values(books).find((b) => b.id !== "fx-game");
  expect(copy).toEqual({ id: copy?.id, name: "Otter Game Plan (imported)", plays: ["fx-slant-left", "fx-wheel-right"], primary: "fx-wheel-right" });
  steps.push({ step: "imported a file with another primary", url: page.url(), stored: books });

  // the same file again finds that copy, and makes no third book
  await importFile();
  await expect(page).toHaveURL(new RegExp(`book=${copy?.id ?? "missing"}$`));
  books = await storedPlaybooks(page);
  expect(Object.keys(books)).toHaveLength(2);
  steps.push({ step: "imported the same file again", url: page.url(), stored: books });
  writeFileSync(`test-results/playbook-switch-${testInfo.project.name}-a-different-primary.json`, `${JSON.stringify({ steps }, null, 2)}\n`);
});
